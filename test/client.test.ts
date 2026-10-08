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
const { parseState, sampleOf, sparkPath, viewInference } = await import('../lib/glance.cjs')

test('address: adds http://, drops trailing slashes, keeps https and paths', () => {
  assert.equal(parseAddress(' spark-scope.local:8787/ '), 'http://spark-scope.local:8787')
  assert.equal(parseAddress('https://pi.example.ts.net'), 'https://pi.example.ts.net')
  assert.equal(parseAddress('http://10.0.0.5:8787/scope/'), 'http://10.0.0.5:8787/scope')
  assert.equal(parseAddress(''), '')
  assert.equal(parseAddress('ftp://pi'), undefined)
  assert.equal(parseAddress('http://'), undefined)
})

test('prefill counts only when new prefills completed since the previous sample', () => {
  const v = {
    ok: true,
    outputTokensPerSecond: 60,
    promptComputeTokensPerSecond: 1800,
    promptTokensPerSecond: 47000,
    prefillUpdatedAt: '2026-10-07T00:00:10.000Z',
  }
  const at = Date.parse('2026-10-07T00:00:11.000Z')
  assert.deepEqual(sampleOf(v, at, at - 2000), { at, decode: 60, prefill: 1800 })
  // The held rate after the prefill finished is not a new prefill.
  assert.equal(sampleOf(v, at + 2000, at).prefill, 0)
  // Without a previous sample, only a prefill in the last 3 seconds counts.
  assert.equal(sampleOf(v, at, null).prefill, 1800)
  assert.equal(sampleOf(v, at + 5000, null).prefill, 0)
  assert.deepEqual(sampleOf({ ok: false }, at, null), { at, decode: 0, prefill: 0 })
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
    nodes: { a: { ok: true, gpu: { temperature: '60' }, memory: null } },
    inference: { ok: true, modelName: { evil: true }, outputTokensPerSecond: 'fast' },
    servers: [null, null],
    history: [null, { at: 'x' }, { at: 1, outputTokensPerSecond: 2 }],
  })
  assert.deepEqual(state.order, [{ id: 'a', name: 'a' }])
  assert.deepEqual(state.nodes.a.gpu, { utilization: null, temperature: null, powerWatts: null })
  assert.equal(state.inference.modelName, null)
  assert.equal(state.inference.outputTokensPerSecond, null)
  assert.deepEqual(state.history, [{ at: 1, outputTokensPerSecond: 2 }])
  assert.equal(viewInference(state), state.inference)
  // A huge history is cut, and the sparkline does not spread it into Math.max.
  assert.equal(parseState({ history: Array.from({ length: 10_000 }, (_, at) => ({ at })) }).history.length, 2000)
  const many = Array.from({ length: 150_000 }, (_, i) => ({ at: i, decode: i, prefill: 0 }))
  assert.ok(sparkPath(many, 'decode', 150_000, 300_000).startsWith('M'))
})
