import assert from 'node:assert/strict'
import { test } from 'node:test'

// lib/client.js registers a factory with the dsh module loader; capture it to reach the exports.
type Factory = (require: (id: string) => unknown) => { parseAddress: (text: string) => string | undefined }
let factory: Factory | undefined
Object.assign(globalThis, {
  window: {
    __ModuleLoader__: {
      load: (row: { factory: Factory }) => {
        factory = row.factory
      },
    },
  },
})
await import('../lib/client.js')
const { parseAddress } = factory!(() => ({}))
const {
  combinedInference,
  engineMetric,
  gpuMemory,
  gpuPowerWatts,
  hasNodeTemperature,
  memoryWording,
  parseState,
  metricValue,
  rateCoverage,
  sampleOf,
  sparkPath,
  viewInference,
} = await import('../lib/glance.cjs')

test('address: adds http://, drops trailing slashes, keeps https and paths', () => {
  assert.equal(parseAddress(' spark-scope.local:8787/ '), 'http://spark-scope.local:8787')
  assert.equal(parseAddress('https://pi.example.ts.net'), 'https://pi.example.ts.net')
  assert.equal(parseAddress('http://10.0.0.5:8787/scope/'), 'http://10.0.0.5:8787/scope')
  assert.equal(parseAddress(''), '')
  assert.equal(parseAddress('ftp://pi'), undefined)
  assert.equal(parseAddress('http://'), undefined)
})

test('prefill counts only when new prefills completed since the previous sample', () => {
  const v = parseState({
    inference: {
      ok: true,
      outputTokensPerSecond: 60,
      promptComputeTokensPerSecond: 1800,
      promptTokensPerSecond: 47000,
      prefillUpdatedAt: '2026-10-07T00:00:10.000Z',
    },
  }).inference
  const at = Date.parse('2026-10-07T00:00:11.000Z')
  assert.deepEqual(sampleOf(v, at, at - 2000), { at, decode: 60, prefill: 1800 })
  // The held rate after the prefill finished is not a new prefill.
  assert.equal(sampleOf(v, at + 2000, at).prefill, 0)
  // Without a previous sample, only a prefill in the last 3 seconds counts.
  assert.equal(sampleOf(v, at, null).prefill, 1800)
  assert.equal(sampleOf(v, at + 5000, null).prefill, 0)
  assert.deepEqual(sampleOf({ ok: false }, at, null), { at, decode: 0, prefill: 0 })
})

// Made-up readings shaped like Spark Scope's engines: oMLX reports session averages only, llama.cpp mean decode time
// and context use, a Spark Scope 0.1.3 reading has no `reported` at all.
const omlx = {
  ok: true,
  engine: 'oMLX',
  averageOutputTokensPerSecond: 42,
  averagePromptTokensPerSecond: 900,
  runningRequests: 1,
  reported: {
    outputTokensPerSecond: false,
    averageOutputTokensPerSecond: true,
    averagePromptTokensPerSecond: true,
    promptTokensPerSecond: false,
    promptComputeTokensPerSecond: false,
    kvCachePercent: false,
    ttftP95RecentSeconds: false,
    tpotP95RecentSeconds: false,
  },
  metricKinds: {
    averageOutputTokensPerSecond: 'sessionMean',
    averagePromptTokensPerSecond: 'sessionMean',
    prefixCacheHitPercent: 'sinceStart',
  },
}
const llama = {
  ok: true,
  outputTokensPerSecond: 30,
  runningRequests: 0,
  reported: { meanDecodeSeconds: true, tpotP95RecentSeconds: false },
  metricKinds: { kvCachePercent: 'context' },
}
const vllm = { ok: true, outputTokensPerSecond: 50, promptTokensPerSecond: 700, kvCachePercent: 20 }
const reading = (inference) => parseState({ inference }).inference
const pick = ({ key, label, shown }) => ({ key, label, shown })

test('engine metrics: averages stand in for unreported rates, kinds change labels, 0.1.3 shows everything', () => {
  const o = reading(omlx)
  assert.deepEqual(engineMetric(o, 'outputTokensPerSecond'), {
    key: 'averageOutputTokensPerSecond',
    label: 'decodeMean',
    help: 'helpDecodeMean',
    shown: true,
    average: true,
    idle: false,
  })
  assert.equal(metricValue(o, engineMetric(o, 'outputTokensPerSecond')), 42)
  assert.deepEqual(pick(engineMetric(o, 'promptComputeTokensPerSecond')), {
    key: 'averagePromptTokensPerSecond',
    label: 'prefillMean',
    shown: true,
  })
  assert.equal(metricValue(o, engineMetric(o, 'promptComputeTokensPerSecond', false)), null)
  assert.equal(sampleOf(o, 1, null).decode, 0)
  assert.equal(engineMetric(o, 'ttftP95RecentSeconds').shown, false)
  assert.equal(engineMetric(o, 'prefixCacheHitPercent').label, 'cacheHitSinceStart')

  const l = reading(llama)
  assert.deepEqual(pick(engineMetric(l, 'tpotP95RecentSeconds')), {
    key: 'meanDecodeSeconds',
    label: 'meanDecode',
    shown: true,
  })
  assert.deepEqual(engineMetric(l, 'kvCachePercent'), {
    key: 'kvCachePercent',
    label: 'contextUsed',
    help: 'helpContextUsed',
    shown: true,
    average: false,
    idle: true,
  })

  const old = reading(vllm)
  for (const field of ['outputTokensPerSecond', 'promptComputeTokensPerSecond', 'tpotP95RecentSeconds'])
    assert.deepEqual(engineMetric(old, field).key, field)
  assert.equal(metricValue(old, engineMetric(old, 'promptComputeTokensPerSecond')), 700)
  const oldServers = parseState({
    servers: [{ inference: vllm }, { inference: { ...vllm, promptTokensPerSecond: 100 } }],
  })
  const oldTotal = combinedInference(oldServers.servers)
  assert.equal(metricValue(oldTotal, engineMetric(oldTotal, 'promptComputeTokensPerSecond')), 800)
  const newer = reading({ ...vllm, reported: { outputTokensPerSecond: true } })
  assert.equal(metricValue(newer, engineMetric(newer, 'promptComputeTokensPerSecond')), null)
})

test('several servers: a field shows when any server reports it, mixed meanings and partial latencies hide', () => {
  const state = parseState({
    servers: [
      { id: 'v', nodes: ['a'], inference: vllm },
      { id: 'o', inference: omlx },
      { id: 'l', inference: llama },
      { id: 'x', inferenceState: 'stopped', inference: { ok: false, error: 'oMLX needs an API key' } },
    ],
  })
  const v = combinedInference(state.servers)
  assert.equal(v.modelName, 'v | o | l')
  assert.equal(v.outputTokensPerSecond, 80)
  assert.equal(engineMetric(v, 'outputTokensPerSecond').label, 'decode')
  assert.equal(v.reported.averageOutputTokensPerSecond, false)
  assert.equal(v.averageOutputTokensPerSecond, null)
  assert.equal(engineMetric(v, 'kvCachePercent').shown, false)
  assert.equal(engineMetric(v, 'ttftP95RecentSeconds').shown, false)
  assert.equal(engineMetric(v, 'tpotP95RecentSeconds').label, 'tpot')
  assert.equal(engineMetric(v, 'prefixCacheHitPercent').shown, false)
  assert.deepEqual(rateCoverage(state.servers, 'outputTokensPerSecond'), { reporting: 2, count: 4 })
  assert.equal(combinedInference([state.servers[3]]).error, 'oMLX needs an API key')
})

test('gpu memory: system memory only for a state without any gpu.memory; Macs have no temperature or power', () => {
  const old = parseState({ nodes: { a: { ok: true, memory: { usedBytes: 1, totalBytes: 4 } } } })
  assert.deepEqual(gpuMemory(old.nodes.a), { kind: 'unified', used: 1, total: 4 })
  const now = parseState({
    nodes: {
      a: { ok: true, memory: { usedBytes: 1, totalBytes: 4 } },
      mac: { ok: true, platform: 'darwin', gpu: { memory: { kind: 'unified', usedBytes: 2, totalBytes: 8 } } },
      card: { ok: true, gpu: { powerWatts: 300, memory: { kind: 'discrete', usedBytes: 3, totalBytes: 24 } } },
      gone: { ok: false, gpu: { powerWatts: 1, memory: { kind: 'discrete', usedBytes: 3, totalBytes: 24 } } },
    },
  })
  assert.deepEqual(gpuMemory(now.nodes.a), { kind: null, used: null, total: null })
  assert.deepEqual(gpuMemory(now.nodes.gone), { kind: 'discrete', used: null, total: null })
  assert.equal(memoryWording(['unified', null]), 'unified')
  assert.equal(memoryWording(['unified', 'discrete']), 'gpu')
  assert.equal(hasNodeTemperature(now.nodes.mac), false)
  assert.equal(hasNodeTemperature(now.nodes.card), true)
  assert.equal(gpuPowerWatts(Object.values(now.nodes)), 300)
  assert.equal(gpuPowerWatts([now.nodes.a, now.nodes.mac]), null)
})

test('several servers add up rates and take the worst latency', () => {
  const v = viewInference(
    parseState({
      inference: { ok: true, modelName: 'a' },
      servers: [
        {
          name: 'one',
          inference: {
            ok: true,
            outputTokensPerSecond: 10,
            runningRequests: 1,
            kvCachePercent: 20,
            ttftP95RecentSeconds: 0.5,
            prefixCacheHitPercent: 90,
          },
        },
        {
          name: null,
          inference: {
            ok: true,
            modelName: 'b',
            outputTokensPerSecond: 5,
            runningRequests: 2,
            kvCachePercent: 40,
            ttftP95RecentSeconds: 1.5,
          },
        },
        { name: 'off', inference: { ok: false } },
        null,
      ],
    }),
  )
  assert.equal(v.modelName, 'one | b')
  assert.equal(v.outputTokensPerSecond, 15)
  assert.equal(v.runningRequests, 3)
  assert.equal(v.kvCachePercent, 40)
  assert.equal(v.ttftP95RecentSeconds, 1.5)
  assert.equal(v.prefixCacheHitPercent, null)
  assert.equal(v.waitingRequests, null)
})

test('malformed state keeps only fields of the expected type', () => {
  assert.equal(parseState(null), null)
  assert.equal(parseState([1, 2]), null)
  const state = parseState({
    topology: { nodes: [null, { id: 7 }, { id: 'a', name: { x: 1 } }] },
    nodes: {
      a: { ok: true, platform: 3, gpu: { temperature: '60', memory: { kind: 'weird', usedBytes: '5' } }, memory: null },
    },
    inference: {
      ok: true,
      modelName: { evil: true },
      outputTokensPerSecond: 'fast',
      reported: { outputTokensPerSecond: 'no', kvCachePercent: false, bogus: false },
      metricKinds: { kvCachePercent: 7, ttftP95RecentSeconds: 'queueExcluded' },
    },
    servers: [null, { id: 5, nodes: [1, 'a'], inference: [] }],
    history: [null, { at: 'x' }, { at: 1, outputTokensPerSecond: 2 }],
  })
  assert.deepEqual(state.order, [{ id: 'a', name: 'a' }])
  assert.deepEqual(state.nodes.a, {
    ok: true,
    platform: null,
    gpu: {
      utilization: null,
      temperature: null,
      powerWatts: null,
      memory: { kind: null, totalBytes: null, usedBytes: null, availableBytes: null },
    },
  })
  assert.equal(state.inference.modelName, null)
  assert.equal(state.inference.outputTokensPerSecond, null)
  assert.deepEqual(state.inference.reported, { kvCachePercent: false })
  assert.deepEqual(state.inference.metricKinds, { ttftP95RecentSeconds: 'queueExcluded' })
  assert.deepEqual(state.servers, [{ id: null, name: null, nodes: ['a'], inferenceState: null, inference: null }])
  assert.deepEqual(state.history, [{ at: 1, outputTokensPerSecond: 2 }])
  assert.equal(viewInference(state), state.inference)
  // A huge history is cut, and the sparkline does not spread it into Math.max.
  assert.equal(parseState({ history: Array.from({ length: 10_000 }, (_, at) => ({ at })) }).history.length, 2000)
  const many = Array.from({ length: 150_000 }, (_, i) => ({ at: i, decode: i, prefill: 0 }))
  assert.ok(sparkPath(many, 'decode', 150_000, 300_000).startsWith('M'))
})
