// Reading Spark Scope's /api/state for the Glance card. The response is external input, so parseState keeps only
// fields of the expected type and everything after it works on that checked shape.

export type MetricKey =
  | 'outputTokensPerSecond'
  | 'averageOutputTokensPerSecond'
  | 'averagePromptTokensPerSecond'
  | 'promptTokensPerSecond'
  | 'promptComputeTokensPerSecond'
  | 'prefixCacheHitPercent'
  | 'kvCachePercent'
  | 'ttftP95RecentSeconds'
  | 'tpotP95RecentSeconds'
  | 'meanDecodeSeconds'

export type Inference = { [key in MetricKey]: number | null } & {
  ok: boolean
  engine: string | null
  modelName: string | null
  error: string | null
  /** false hides a field the engine does not report; an absent key means reported (Spark Scope 0.1.3 sends none). */
  reported: Partial<Record<MetricKey, boolean>>
  /** Spark Scope 0.1.3: the reading (or every reading behind a combined one) came without `reported`. */
  legacy: boolean
  metricKinds: Partial<Record<MetricKey, string>>
  runningRequests: number | null
  waitingRequests: number | null
  prefillUpdatedAt: string | null
}

export interface GpuMemory {
  kind: 'unified' | 'discrete' | null
  totalBytes: number | null
  usedBytes: number | null
  availableBytes: number | null
}

export interface NodeReading {
  ok: boolean
  platform: string | null
  gpu: { utilization: number | null; temperature: number | null; powerWatts: number | null; memory: GpuMemory | null }
}

export interface Server {
  id: string | null
  name: string | null
  nodes: string[]
  inferenceState: string | null
  inference: Inference | null
}

export interface State {
  status: string | null
  updatedAt: string | null
  inference: Inference | null
  servers: Server[]
  nodes: Record<string, NodeReading>
  /** Node ids and names in display order. */
  order: { id: string; name: string }[]
  history: { at: number; outputTokensPerSecond: number | null }[]
}

export interface Sample {
  at: number
  decode: number
  prefill: number
}

/** Spark Scope keeps six hours of samples; 15 minutes are about 450 at its 2-second poll. */
const MAX_HISTORY = 2000
const MAX_NODES = 64
const MAX_SERVERS = 16

/** Label and help locale keys per field, as Spark Scope's ENGINE_LABELS. */
const LABELS = {
  outputTokensPerSecond: 'decode',
  averageOutputTokensPerSecond: 'decodeMean',
  averagePromptTokensPerSecond: 'prefillMean',
  promptTokensPerSecond: 'prefill',
  promptComputeTokensPerSecond: 'prefill',
  prefixCacheHitPercent: 'cacheHit',
  kvCachePercent: 'kv',
  ttftP95RecentSeconds: 'ttft',
  tpotP95RecentSeconds: 'tpot',
  meanDecodeSeconds: 'meanDecode',
} as const
const METRIC_KEYS = Object.keys(LABELS) as MetricKey[]
const LATENCIES = new Set<MetricKey>(['ttftP95RecentSeconds', 'tpotP95RecentSeconds'])

export type MetricLabel = (typeof LABELS)[MetricKey] | 'decode2s' | 'prefill2s' | 'contextUsed' | 'cacheHitSinceStart'
export type MetricHelp =
  | 'helpCacheHit'
  | 'helpTtft'
  | 'helpTpot'
  | 'helpMeanDecode'
  | 'helpCacheHitSinceStart'
  | 'helpContextUsed'
  | 'helpPrefill2s'
  | 'helpDecode2s'
  | 'helpPrefillMean'
  | 'helpDecodeMean'
  | 'helpStrataPrefill'
  | 'helpTtftQueueExcluded'
  | 'helpTpotTokenWeighted'
  | 'helpTpotRequestMean'

export const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const num = (value: unknown): number | null => (finite(value) ? value : null)
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
const list = (value: unknown, max: number): unknown[] => (Array.isArray(value) ? value.slice(-max) : [])
function metricMap<T>(value: unknown, type: 'boolean' | 'string'): Partial<Record<MetricKey, T>> {
  const map = record(value) ?? {}
  return Object.fromEntries(METRIC_KEYS.filter((key) => typeof map[key] === type).map((key) => [key, map[key]]))
}

function parseInference(value: unknown): Inference | null {
  const v = record(value)
  if (v === null) return null
  return {
    ...(Object.fromEntries(METRIC_KEYS.map((key) => [key, num(v[key])])) as Record<MetricKey, number | null>),
    ok: v.ok === true,
    engine: str(v.engine),
    modelName: str(v.modelName),
    error: str(v.error),
    reported: metricMap(v.reported, 'boolean'),
    legacy: record(v.reported) === null,
    metricKinds: metricMap(v.metricKinds, 'string'),
    runningRequests: num(v.runningRequests),
    waitingRequests: num(v.waitingRequests),
    prefillUpdatedAt: str(v.prefillUpdatedAt),
  }
}

function parseMemory(value: unknown, kind: unknown): GpuMemory | null {
  const memory = record(value)
  if (memory === null) return null
  return {
    kind: kind === 'unified' || kind === 'discrete' ? kind : null,
    totalBytes: num(memory.totalBytes),
    usedBytes: num(memory.usedBytes),
    availableBytes: num(memory.availableBytes),
  }
}

/**
 * Spark Scope 0.1.3 has no gpu.memory and shows system memory (GB10 unified memory) in its place. Later versions
 * never fall back to system memory, so the card uses node.memory only when no node in the state has gpu.memory.
 */
function parseNode(value: unknown, legacy: boolean): NodeReading {
  const node = record(value) ?? {}
  const gpu = record(node.gpu) ?? {}
  return {
    ok: node.ok === true,
    platform: str(node.platform),
    gpu: {
      utilization: num(gpu.utilization),
      temperature: num(gpu.temperature),
      powerWatts: num(gpu.powerWatts),
      memory: legacy ? parseMemory(node.memory, 'unified') : parseMemory(gpu.memory, record(gpu.memory)?.kind),
    },
  }
}

/** The checked state, or null when the response is not a Spark Scope state object. */
export function parseState(value: unknown): State | null {
  const raw = record(value)
  if (raw === null) return null
  const rawNodes = Object.entries(record(raw.nodes) ?? {}).slice(0, MAX_NODES)
  const legacy = !rawNodes.some(([, node]) => record(record(record(node)?.gpu)?.memory) !== null)
  const nodes: Record<string, NodeReading> = {}
  for (const [id, node] of rawNodes) nodes[id] = parseNode(node, legacy)
  // Topology order when given, otherwise the order the readings arrived in.
  const topology = list(record(raw.topology)?.nodes, MAX_NODES)
    .map(record)
    .filter((meta): meta is Record<string, unknown> => typeof meta?.id === 'string')
    .map((meta) => ({ id: meta.id as string, name: str(meta.name) ?? (meta.id as string) }))
  const order =
    topology.length > 0
      ? topology
      : rawNodes.map(([id, node]) => ({ id, name: str(record(node)?.name) ?? str(record(node)?.host) ?? id }))
  return {
    status: str(raw.status),
    updatedAt: str(raw.updatedAt),
    inference: parseInference(raw.inference),
    servers: list(raw.servers, MAX_SERVERS)
      .map(record)
      .filter((server) => server !== null)
      .map((server) => ({
        id: str(server.id),
        name: str(server.name),
        nodes: list(server.nodes, MAX_NODES).filter((id) => typeof id === 'string'),
        inferenceState: str(server.inferenceState),
        inference: parseInference(server.inference),
      })),
    nodes,
    order,
    history: list(raw.history, MAX_HISTORY)
      .map(record)
      .filter((point): point is Record<string, unknown> => finite(point?.at))
      .map((point) => ({ at: point.at as number, outputTokensPerSecond: num(point.outputTokensPerSecond) })),
  }
}

/** One fixed number format, as on Spark Scope's pages; '—' for a value that was not observed. */
export function fixed(value: number | null, digits = 1, suffix = ''): string {
  return finite(value)
    ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + suffix
    : '—'
}
export const rate = (value: number | null): string => fixed(value, finite(value) && value >= 100 ? 0 : 1)
export function duration(seconds: number | null): string {
  if (!finite(seconds)) return '—'
  return Math.round(seconds * 1000) < 1000 ? fixed(seconds * 1000, 0, ' ms') : fixed(seconds, 2, ' s')
}
export const gib = (bytes: number | null, digits = 1): string => fixed(finite(bytes) ? bytes / 2 ** 30 : null, digits)

export interface Metric {
  key: MetricKey
  label: MetricLabel
  help: MetricHelp | undefined
  shown: boolean
  /** A session average in place of a live rate: no sparkline. */
  average: boolean
  /** A context reading while the engine runs no requests: the card shows "no requests". */
  idle: boolean
}

const DEFAULT_HELP: Partial<Record<MetricKey, MetricHelp>> = {
  prefixCacheHitPercent: 'helpCacheHit',
  ttftP95RecentSeconds: 'helpTtft',
  tpotP95RecentSeconds: 'helpTpot',
}
const isPrompt = (key: MetricKey) => key === 'promptTokensPerSecond' || key === 'promptComputeTokensPerSecond'

function metricLabel(key: MetricKey, kind: string | undefined): MetricLabel {
  if (kind === 'context') return 'contextUsed'
  if (kind === 'twoSecond') return key === 'outputTokensPerSecond' ? 'decode2s' : 'prefill2s'
  if (kind === 'sessionMean') return key === 'averageOutputTokensPerSecond' ? 'decodeMean' : 'prefillMean'
  if (kind === 'sinceStart') return 'cacheHitSinceStart'
  return LABELS[key]
}

function metricHelp(key: MetricKey, kind: string | undefined, engine: string | null): MetricHelp | undefined {
  if (kind === 'sessionMean') return key === 'averageOutputTokensPerSecond' ? 'helpDecodeMean' : 'helpPrefillMean'
  if (key === 'meanDecodeSeconds') return 'helpMeanDecode'
  if (kind === 'sinceStart') return 'helpCacheHitSinceStart'
  if (kind === 'context') return 'helpContextUsed'
  if (kind === 'twoSecond') return key === 'outputTokensPerSecond' ? 'helpDecode2s' : 'helpPrefill2s'
  if (engine === 'Strata' && isPrompt(key)) return 'helpStrataPrefill'
  if (kind === 'queueExcluded') return 'helpTtftQueueExcluded'
  if (kind === 'tokenWeightedMean') return 'helpTpotTokenWeighted'
  if (kind === 'requestMean') return 'helpTpotRequestMean'
  return DEFAULT_HELP[key]
}

/**
 * Which field the card shows for a metric, with its label and help, as Spark Scope's engineMetric: mean decode time
 * in place of TPOT, the session averages in place of unreported live rates (unless `averages` is false), and the
 * label a metric kind gives (context, two-second, session mean, since start).
 */
export function engineMetric(v: Inference | null, field: MetricKey, averages = true): Metric {
  const reported = v?.reported ?? {}
  let key = field
  if (field === 'tpotP95RecentSeconds' && reported.meanDecodeSeconds) key = 'meanDecodeSeconds'
  if (
    averages &&
    field === 'outputTokensPerSecond' &&
    reported[field] === false &&
    reported.averageOutputTokensPerSecond
  )
    key = 'averageOutputTokensPerSecond'
  if (field === 'promptComputeTokensPerSecond' && reported[field] === false && reported.promptTokensPerSecond)
    key = 'promptTokensPerSecond'
  if (averages && isPrompt(field) && reported[key] === false && reported.averagePromptTokensPerSecond)
    key = 'averagePromptTokensPerSecond'
  const kind = v?.metricKinds[key]
  return {
    key,
    label: metricLabel(key, kind),
    help: metricHelp(key, kind, v?.engine ?? null),
    shown: reported[key] !== false,
    average: key === 'averageOutputTokensPerSecond' || key === 'averagePromptTokensPerSecond',
    idle: kind === 'context' && v?.ok === true && v.runningRequests === 0,
  }
}

/**
 * The figure a metric shows from a live reading, null when hidden. A Spark Scope 0.1.3 reading falls back from
 * computed prompt tokens to all prompt tokens, as the card did before.
 */
export function metricValue(v: Inference | null, metric: Metric): number | null {
  if (!v?.ok || !metric.shown) return null
  const value = v[metric.key]
  return value === null && v.legacy && metric.key === 'promptComputeTokensPerSecond' ? v.promptTokensPerSecond : value
}

export const engineNeedsKey = (v: Inference | null): boolean => v?.error === 'oMLX needs an API key'

export const serverName = (server: Server): string =>
  server.name || (server.inference?.ok && server.inference.modelName) || server.id || ''
export const serverState = (server: Server): 'checking' | 'serving' | 'idle' | 'down' =>
  !server.inference
    ? 'checking'
    : server.inference.ok
      ? 'serving'
      : server.inferenceState === 'stopped'
        ? 'idle'
        : 'down'

export function rateCoverage(servers: Server[], field: MetricKey): { reporting: number; count: number } | null {
  const reporting = servers.filter(
    (server) => server.inference?.ok && server.inference.reported[field] !== false && finite(server.inference[field]),
  ).length
  return reporting > 0 && reporting < servers.length ? { reporting, count: servers.length } : null
}

/**
 * All servers as one reading, as Spark Scope's combinedInference ("all at once"): rates and requests added up over
 * the servers that answer, the highest KV cache and the slowest latencies. A field counts as reported when any
 * server reports it, except figures that do not add up (cache hit), averages (only with a single reading), mean
 * decode time (every reading), mixed KV meanings and latencies not reported by every server.
 */
export function combinedInference(servers: Server[]): Inference | null {
  const readings = servers.map((server) => server.inference).filter((v) => v !== null)
  const live = readings.filter((v) => v.ok)
  const reported: Partial<Record<MetricKey, boolean>> = {}
  for (const key of new Set(readings.flatMap((v) => Object.keys(v.reported) as MetricKey[])))
    reported[key] = readings.some((v) => v.reported[key] !== false)
  reported.prefixCacheHitPercent = false
  reported.meanDecodeSeconds = readings.length > 0 && readings.every((v) => v.reported.meanDecodeSeconds === true)
  for (const key of ['averageOutputTokensPerSecond', 'averagePromptTokensPerSecond'] as const)
    reported[key] = readings.length === 1 && readings[0]!.reported[key] === true
  const metricKinds: Partial<Record<MetricKey, string>> = {}
  for (const key of METRIC_KEYS) {
    const kinds = new Set(readings.filter((v) => v.reported[key] !== false).map((v) => v.metricKinds[key] ?? ''))
    if (kinds.size === 1 && !kinds.has('')) metricKinds[key] = [...kinds][0]!
    if (key === 'kvCachePercent' && kinds.size > 1) reported[key] = false
    if (LATENCIES.has(key))
      reported[key] =
        readings.length === servers.length &&
        readings.length > 0 &&
        kinds.size === 1 &&
        readings.every((v) => v.reported[key] !== false)
  }
  if (readings.length === 0) return null
  const values = (key: MetricKey | 'runningRequests' | 'waitingRequests') =>
    live
      .filter((v) => v.reported[key as MetricKey] !== false)
      .map((v) => v[key])
      .filter(finite)
  const sum = (key: Parameters<typeof values>[0]) => {
    const all = values(key)
    return all.length > 0 ? all.reduce((a, b) => a + b, 0) : null
  }
  const max = (key: MetricKey) => {
    const all = values(key)
    return all.length > 0 ? Math.max(...all) : null
  }
  const ok = live.length > 0
  return {
    ok,
    engine: [...new Set(live.map((v) => v.engine).filter(Boolean))].join(' + ') || null,
    modelName:
      servers
        .filter((server) => server.inference?.ok)
        .map(serverName)
        .join(' | ') || null,
    error: ok ? null : (readings.find((v) => v.error)?.error ?? null),
    reported,
    legacy: readings.every((v) => v.legacy),
    metricKinds,
    outputTokensPerSecond: sum('outputTokensPerSecond'),
    averageOutputTokensPerSecond: reported.averageOutputTokensPerSecond ? sum('averageOutputTokensPerSecond') : null,
    averagePromptTokensPerSecond: reported.averagePromptTokensPerSecond ? sum('averagePromptTokensPerSecond') : null,
    promptTokensPerSecond: sum('promptTokensPerSecond'),
    promptComputeTokensPerSecond: sum('promptComputeTokensPerSecond'),
    runningRequests: sum('runningRequests'),
    waitingRequests: sum('waitingRequests'),
    kvCachePercent: reported.kvCachePercent === false ? null : max('kvCachePercent'),
    prefixCacheHitPercent: null,
    ttftP95RecentSeconds: max('ttftP95RecentSeconds'),
    tpotP95RecentSeconds: max('tpotP95RecentSeconds'),
    meanDecodeSeconds: max('meanDecodeSeconds'),
    prefillUpdatedAt:
      live
        .map((v) => v.prefillUpdatedAt)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null,
  }
}

export const viewInference = (state: State | null): Inference | null =>
  (state?.servers.length ?? 0) < 2 ? (state?.inference ?? null) : combinedInference(state!.servers)

/** GPU memory of a node that answered; kind still names the label of a node that did not. */
export function gpuMemory(node: NodeReading | undefined): {
  kind: GpuMemory['kind']
  used: number | null
  total: number | null
} {
  const memory = node?.gpu.memory
  const kind = memory?.kind ?? null
  const shown = node?.ok === true && kind !== null
  return { kind, used: shown ? memory!.usedBytes : null, total: shown ? memory!.totalBytes : null }
}
export function memoryWording(kinds: GpuMemory['kind'][]): 'unified' | 'gpu' {
  const known = kinds.filter((kind) => kind !== null)
  return known.length > 0 && known.every((kind) => kind === 'unified') ? 'unified' : 'gpu'
}
/** Mac nodes report no GPU temperature or power. */
export const hasNodeTemperature = (node: NodeReading | undefined): boolean => node?.platform !== 'darwin'
export function gpuPowerWatts(nodes: (NodeReading | undefined)[]): number | null {
  const watts = nodes
    .filter((node) => node?.ok)
    .map((node) => node!.gpu.powerWatts)
    .filter(finite)
  return watts.length > 0 ? watts.reduce((a, b) => a + b, 0) : null
}

/**
 * A sparkline sample from one response. Spark Scope holds the prefill rate between prefills, so a sample counts
 * prefill only when new prefills completed since the previous sample (prefillUpdatedAt moved on).
 */
export function sampleOf(v: Inference | null, at: number, previousAt: number | null): Sample {
  const live = v?.ok ? v : null
  const prefillAt = Date.parse(live?.prefillUpdatedAt ?? '')
  const fresh = Number.isFinite(prefillAt) && (previousAt === null ? at - prefillAt < 3000 : prefillAt > previousAt)
  const decode = metricValue(live, engineMetric(live, 'outputTokensPerSecond', false))
  // As Spark Scope's mini window: computed prompt tokens, else all prompt tokens, in any version.
  const prefill = live?.promptComputeTokensPerSecond ?? live?.promptTokensPerSecond
  return { at, decode: decode ?? 0, prefill: fresh ? (prefill ?? 0) : 0 }
}

/** The samples seeded from the chart history. It keeps no prefill timing, so those samples carry decode only. */
export const historySamples = (state: State, from: number): Sample[] =>
  state.history
    .filter((point) => point.at >= from)
    .map((point) => ({ at: point.at, decode: point.outputTokensPerSecond ?? 0, prefill: 0 }))

/** SVG path of one sparkline over `span` milliseconds up to `now`, in a 300 x 30 box; '' with fewer than two points. */
export function sparkPath(samples: Sample[], key: 'decode' | 'prefill', now: number, span: number): string {
  const from = now - span
  const points = samples.filter((sample) => sample.at >= from)
  if (points.length < 2) return ''
  const top = points.reduce((most, point) => Math.max(most, point[key]), 1)
  return points
    .map(
      (point, i) =>
        `${i === 0 ? 'M' : 'L'}${(((point.at - from) / span) * 300).toFixed(1)} ${(28 - (26 * point[key]) / top).toFixed(1)}`,
    )
    .join('')
}
