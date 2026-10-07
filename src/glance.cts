// Reading Spark Scope's /api/state for the Glance card. The response is external input, so parseState keeps only
// fields of the expected type and everything after it works on that checked shape.

export interface Inference {
  ok: boolean
  modelName: string | null
  outputTokensPerSecond: number | null
  promptTokensPerSecond: number | null
  promptComputeTokensPerSecond: number | null
  runningRequests: number | null
  waitingRequests: number | null
  kvCachePercent: number | null
  prefixCacheHitPercent: number | null
  ttftP95RecentSeconds: number | null
  tpotP95RecentSeconds: number | null
  prefillUpdatedAt: string | null
}

export interface NodeReading {
  ok: boolean
  gpu: { utilization: number | null, temperature: number | null, powerWatts: number | null }
  memory: { usedBytes: number | null, totalBytes: number | null }
}

export interface State {
  status: string | null
  updatedAt: string | null
  inference: Inference | null
  servers: { name: string | null, inference: Inference | null }[]
  nodes: Record<string, NodeReading>
  /** Node ids and names in display order. */
  order: { id: string, name: string }[]
  history: { at: number, outputTokensPerSecond: number | null }[]
}

export interface Sample { at: number, decode: number, prefill: number }

/** Spark Scope keeps six hours of samples; 15 minutes are about 450 at its 2-second poll. */
const MAX_HISTORY = 2000
const MAX_NODES = 64
const MAX_SERVERS = 16

export const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const num = (value: unknown): number | null => finite(value) ? value : null
const str = (value: unknown): string | null => typeof value === 'string' ? value : null
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const list = (value: unknown, max: number): unknown[] => Array.isArray(value) ? value.slice(-max) : []

function parseInference(value: unknown): Inference | null {
  const v = record(value)
  if (v === null) return null
  return {
    ok: v.ok === true,
    modelName: str(v.modelName),
    outputTokensPerSecond: num(v.outputTokensPerSecond),
    promptTokensPerSecond: num(v.promptTokensPerSecond),
    promptComputeTokensPerSecond: num(v.promptComputeTokensPerSecond),
    runningRequests: num(v.runningRequests),
    waitingRequests: num(v.waitingRequests),
    kvCachePercent: num(v.kvCachePercent),
    prefixCacheHitPercent: num(v.prefixCacheHitPercent),
    ttftP95RecentSeconds: num(v.ttftP95RecentSeconds),
    tpotP95RecentSeconds: num(v.tpotP95RecentSeconds),
    prefillUpdatedAt: str(v.prefillUpdatedAt),
  }
}

function parseNode(value: unknown): NodeReading {
  const node = record(value) ?? {}
  const gpu = record(node.gpu) ?? {}
  const memory = record(node.memory) ?? {}
  return {
    ok: node.ok === true,
    gpu: { utilization: num(gpu.utilization), temperature: num(gpu.temperature), powerWatts: num(gpu.powerWatts) },
    memory: { usedBytes: num(memory.usedBytes), totalBytes: num(memory.totalBytes) },
  }
}

/** The checked state, or null when the response is not a Spark Scope state object. */
export function parseState(value: unknown): State | null {
  const raw = record(value)
  if (raw === null) return null
  const rawNodes = Object.entries(record(raw.nodes) ?? {}).slice(0, MAX_NODES)
  const nodes: Record<string, NodeReading> = {}
  for (const [id, node] of rawNodes) nodes[id] = parseNode(node)
  // Topology order when given, otherwise the order the readings arrived in.
  const topology = list(record(raw.topology)?.nodes, MAX_NODES).map(record)
    .filter((meta): meta is Record<string, unknown> => typeof meta?.id === 'string')
    .map(meta => ({ id: meta.id as string, name: str(meta.name) ?? meta.id as string }))
  const order = topology.length > 0
    ? topology
    : rawNodes.map(([id, node]) => ({ id, name: str(record(node)?.name) ?? str(record(node)?.host) ?? id }))
  return {
    status: str(raw.status),
    updatedAt: str(raw.updatedAt),
    inference: parseInference(raw.inference),
    servers: list(raw.servers, MAX_SERVERS).map(record).filter(server => server !== null)
      .map(server => ({ name: str(server.name), inference: parseInference(server.inference) })),
    nodes,
    order,
    history: list(raw.history, MAX_HISTORY).map(record)
      .filter((point): point is Record<string, unknown> => finite(point?.at))
      .map(point => ({ at: point.at as number, outputTokensPerSecond: num(point.outputTokensPerSecond) })),
  }
}

/** One fixed number format, as on Spark Scope's pages; '—' for a value that was not observed. */
export function fixed(value: number | null, digits = 1, suffix = ''): string {
  return finite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + suffix : '—'
}
export const rate = (value: number | null): string => fixed(value, finite(value) && value >= 100 ? 0 : 1)
export function duration(seconds: number | null): string {
  if (!finite(seconds)) return '—'
  return Math.round(seconds * 1000) < 1000 ? fixed(seconds * 1000, 0, ' ms') : fixed(seconds, 2, ' s')
}
export const gib = (bytes: number | null, digits = 1): string => fixed(finite(bytes) ? bytes / 2 ** 30 : null, digits)

/** Prefill as Spark Scope counts it: new prompt tokens computed, falling back to all prompt tokens. */
export const prefillRate = (v: Inference | null): number | null => v?.promptComputeTokensPerSecond ?? v?.promptTokensPerSecond ?? null

/**
 * The reading the card shows: the only server's own, or with several servers all of them together, as Spark Scope's
 * mini window does in "all at once": rates and requests added up, the highest KV cache and the slowest latencies.
 */
export function viewInference(state: State | null): Inference | null {
  const servers = state?.servers ?? []
  if (servers.length < 2) return state?.inference ?? null
  const live = servers.filter(server => server.inference?.ok)
  const readings = live.map(server => server.inference!)
  const values = (key: keyof Inference) => readings.map(v => v[key]).filter(finite)
  const sum = (key: keyof Inference) => { const all = values(key); return all.length > 0 ? all.reduce((a, b) => a + b, 0) : null }
  const max = (key: keyof Inference) => { const all = values(key); return all.length > 0 ? Math.max(...all) : null }
  return {
    ok: live.length > 0,
    modelName: live.map(server => server.name || server.inference!.modelName).filter(Boolean).join(' | ') || null,
    outputTokensPerSecond: sum('outputTokensPerSecond'),
    promptTokensPerSecond: sum('promptTokensPerSecond'),
    promptComputeTokensPerSecond: sum('promptComputeTokensPerSecond'),
    runningRequests: sum('runningRequests'),
    waitingRequests: sum('waitingRequests'),
    kvCachePercent: max('kvCachePercent'),
    prefixCacheHitPercent: null,
    ttftP95RecentSeconds: max('ttftP95RecentSeconds'),
    tpotP95RecentSeconds: max('tpotP95RecentSeconds'),
    prefillUpdatedAt: readings.map(v => v.prefillUpdatedAt).filter(Boolean).sort().at(-1) ?? null,
  }
}

/**
 * A sparkline sample from one response. Spark Scope holds the prefill rate between prefills, so a sample counts
 * prefill only when new prefills completed since the previous sample (prefillUpdatedAt moved on).
 */
export function sampleOf(v: Inference | null, at: number, previousAt: number | null): Sample {
  const live = v?.ok ? v : null
  const prefillAt = Date.parse(live?.prefillUpdatedAt ?? '')
  const fresh = Number.isFinite(prefillAt) && (previousAt === null ? at - prefillAt < 3000 : prefillAt > previousAt)
  return { at, decode: live?.outputTokensPerSecond ?? 0, prefill: fresh ? prefillRate(live) ?? 0 : 0 }
}

/** The samples seeded from the chart history. It keeps no prefill timing, so those samples carry decode only. */
export const historySamples = (state: State, from: number): Sample[] =>
  state.history.filter(point => point.at >= from).map(point => ({ at: point.at, decode: point.outputTokensPerSecond ?? 0, prefill: 0 }))

/** SVG path of one sparkline over `span` milliseconds up to `now`, in a 300 x 30 box; '' with fewer than two points. */
export function sparkPath(samples: Sample[], key: 'decode' | 'prefill', now: number, span: number): string {
  const from = now - span
  const points = samples.filter(sample => sample.at >= from)
  if (points.length < 2) return ''
  const top = points.reduce((most, point) => Math.max(most, point[key]), 1)
  return points.map((point, i) => `${i === 0 ? 'M' : 'L'}${((point.at - from) / span * 300).toFixed(1)} ${(28 - 26 * point[key] / top).toFixed(1)}`).join('')
}
