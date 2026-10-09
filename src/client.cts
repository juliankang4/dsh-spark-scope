import type { Context } from '@deepseek-ai/cordis'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { createElement as h, useEffect, useId, useRef, useState } from 'react'
import {
  duration,
  engineMetric,
  engineNeedsKey,
  finite,
  fixed,
  gib,
  gpuMemory,
  gpuPowerWatts,
  hasNodeTemperature,
  historySamples,
  memoryWording,
  parseState,
  metricValue,
  rate,
  rateCoverage,
  sampleOf,
  serverName,
  serverState,
  sparkPath,
  viewInference,
  type Inference,
  type Metric,
  type MetricKey,
  type Sample,
  type State,
} from './glance.cjs'

/** Locale namespace, and the settings namespace (the entry id in cordis.patch.yml). */
const NS = 'spark-scope'
const ROUTE = '/plugins/dsh-spark-scope/state'
const COLLAPSED_KEY = 'dsh-spark-scope:collapsed'
const POLL_MS = 2000
const SPARK_MS = 5 * 60_000
/** Spark Scope counts data older than three polls, and at least 20 seconds, as stale. */
const STALE_MS = 20_000
const HOT_CELSIUS = 80
const NODE_COLORS = ['blue', 'orange', 'green', 'ink', 'purple', 'gold', 'magenta', 'umber']

const en = {
  nodesUp: '{online}/{count} nodes',
  offline: 'Not responding',
  invalid: 'The Spark Scope address in Settings is not an http or https address.',
  noModel: 'No model',
  mean: 'mean',
  apiKey: 'API key required',
  decode: 'Decode',
  prefill: 'Prefill',
  decode2s: 'Decode (2 s)',
  prefill2s: 'Prefill (2 s)',
  decodeMean: 'Mean decode',
  prefillMean: 'Mean prefill',
  serversPartial: '(servers {reporting}/{count})',
  running: 'Running',
  queue: 'Queue',
  kv: 'KV',
  contextUsed: 'Context used',
  noRequests: 'no requests',
  ttft: 'TTFT',
  tpot: 'TPOT',
  meanDecode: 'Mean decode time',
  cacheHit: 'Cache hit',
  cacheHitSinceStart: 'Cache hit since start',
  total: 'Total',
  serving: 'serving',
  idle: 'idle',
  down: 'not responding',
  checking: 'checking',
  gpuLoad: 'GPU load',
  mem: 'MEM',
  vram: 'VRAM',
  gpuPower: 'GPU power',
  powerPartial: '({reporting}/{count} nodes)',
  mostMemory: 'Most memory used',
  mostGpuMemory: 'Most GPU memory used',
  helpCacheHit: 'The share of prompt tokens served from the prefix cache, counted since the engine started.',
  helpTtft: 'Time to first token: the 95th percentile over the requests that finished in the last 5 minutes.',
  helpTpot: 'Time per output token: the 95th percentile over the requests that finished in the last 5 minutes.',
  helpMeanDecode:
    'Average time to generate an output token. Lower means faster replies. Calculated from generation time and token increases between collections, and held until another generation completes. The first token adds to the count but not the time, so this is not a mean token gap or p95.',
  helpCacheHitSinceStart:
    'Since the engine started: reused prompt tokens divided by computed plus reused prompt tokens. The counters update at different times during a request.',
  helpContextUsed:
    'The share of the context window used by active requests. Unlike vLLM KV cache usage, this measures token capacity, not occupied cache memory.',
  helpPrefill2s:
    'Prompt tokens computed per second during the last prompt pass. TensorFold keeps this rate for two seconds, then reports zero.',
  helpDecode2s: 'Output tokens generated per second over the last two seconds.',
  helpPrefillMean:
    'Computed prompt tokens divided by prefill time for completed requests since the server started. Cached tokens and idle time are excluded. This is a session average, not a live rate.',
  helpDecodeMean:
    'Output tokens divided by generation time for completed requests since the server started. Idle time is excluded. This is a session average, not a live rate.',
  helpStrataPrefill:
    'While a request runs, its reported prompt-reading rate. Otherwise, the rate from the latest completed requests is kept.',
  helpTtftQueueExcluded:
    'TTFT p95 over finished requests in the last 5 minutes. Queue and model-load time are excluded.',
  helpTpotTokenWeighted:
    "Token-weighted p95 of each finished request's mean inter-token gap, over the last 5 minutes. It is not a percentile of individual token gaps.",
  helpTpotRequestMean:
    "P95 of each finished reply's mean gap between output tokens, over the last 5 minutes. One-token replies are omitted.",
  collapse: 'Collapse Spark Scope',
  expand: 'Expand Spark Scope',
  nav: 'Spark Scope',
  settingTitle: 'Spark Scope address',
  settingDescription:
    'Shows Spark Scope in the sidebar. Enter its local network or tailnet address, for example http://spark-scope.local:8787. Leave it empty to hide the card.',
  settingInput: 'Spark Scope address',
  settingBad: 'Enter an http or https address.',
  settingFailed: 'The address could not be saved.',
  settingReadOnly: 'Settings can only be changed on the computer that runs dsh.',
}
type Key = keyof typeof en
const zh: Record<Key, string> = {
  nodesUp: '{online}/{count} 个节点',
  offline: '无响应',
  invalid: '设置中的 Spark Scope 地址不是 http 或 https 地址。',
  noModel: '无模型',
  mean: '平均',
  apiKey: '需要 API 密钥',
  decode: 'Decode',
  prefill: 'Prefill',
  decode2s: 'Decode (2 秒)',
  prefill2s: 'Prefill (2 秒)',
  decodeMean: '平均 Decode',
  prefillMean: '平均 Prefill',
  serversPartial: '(服务器 {reporting}/{count})',
  running: '运行中',
  queue: '队列',
  kv: 'KV',
  contextUsed: '上下文占用',
  noRequests: '无请求',
  ttft: 'TTFT',
  tpot: 'TPOT',
  meanDecode: '平均 Decode 时间',
  cacheHit: '缓存命中',
  cacheHitSinceStart: '启动以来缓存命中',
  total: '合计',
  serving: '服务中',
  idle: '空闲',
  down: '无响应',
  checking: '检查中',
  gpuLoad: 'GPU 负载',
  mem: '内存',
  vram: 'VRAM',
  gpuPower: 'GPU 功耗',
  powerPartial: '({reporting}/{count} 个节点)',
  mostMemory: '最高内存',
  mostGpuMemory: '最高 GPU 内存',
  helpCacheHit: '自引擎启动以来，从前缀缓存取得的提示词 token 所占比例。',
  helpTtft: '首个 token 的等待时间：最近 5 分钟内完成的请求的 p95。',
  helpTpot: '每个输出 token 的耗时：最近 5 分钟内完成的请求的 p95。',
  helpMeanDecode:
    '生成一个输出 token 的平均时间，越短回复越快。按两次采集之间增加的生成时间和 token 数计算，并保持到下一次生成完成。首个 token 只计入数量、不计入时间，所以它不是平均 token 间隔，也不是 p95。',
  helpCacheHitSinceStart:
    '自引擎启动以来：复用的提示词 token 除以计算和复用的提示词 token 之和。请求进行中，两个计数器的更新时间可能不同。',
  helpContextUsed:
    '进行中的请求占用上下文窗口的比例。与 vLLM 的 KV 缓存使用率不同，它按 token 容量计算，而不是已占用的缓存内存。',
  helpPrefill2s: '最近一次处理提示词时每秒计算的 token 数。TensorFold 会把这个速率保持两秒，然后报告为零。',
  helpDecode2s: '最近两秒内每秒生成的输出 token 数。',
  helpPrefillMean:
    '自服务器启动以来，已完成请求中计算的提示词 token 数除以 prefill 时间，不含缓存 token 和空闲时间。这是会话平均值，不是实时速率。',
  helpDecodeMean:
    '自服务器启动以来，已完成请求的输出 token 数除以生成时间，不含空闲时间。这是会话平均值，不是实时速率。',
  helpStrataPrefill: '请求进行中时显示它报告的提示词读取速率，否则保留最近完成的请求的速率。',
  helpTtftQueueExcluded: '最近 5 分钟内完成的请求的 TTFT p95，不含排队和模型加载时间。',
  helpTpotTokenWeighted:
    '最近 5 分钟内，各个已完成请求的平均 token 间隔按 token 数加权后的 p95。它不是单个 token 间隔的百分位。',
  helpTpotRequestMean: '最近 5 分钟内，每个已完成回复的平均输出 token 间隔的 p95。只有一个 token 的回复不计入。',
  collapse: '收起 Spark Scope',
  expand: '展开 Spark Scope',
  nav: 'Spark Scope',
  settingTitle: 'Spark Scope 地址',
  settingDescription:
    '在侧边栏显示 Spark Scope。填写它在局域网或 tailnet 上的地址，例如 http://spark-scope.local:8787。留空则隐藏卡片。',
  settingInput: 'Spark Scope 地址',
  settingBad: '请输入 http 或 https 地址。',
  settingFailed: '地址未能保存。',
  settingReadOnly: '只能在运行 dsh 的电脑上更改设置。',
}
const ko: Record<Key, string> = {
  nodesUp: '노드 {online}/{count}',
  offline: '응답 없음',
  invalid: '설정의 Spark Scope 주소가 http 또는 https 주소가 아닙니다.',
  noModel: '모델 없음',
  mean: '평균',
  apiKey: 'API 키 필요',
  decode: 'Decode',
  prefill: 'Prefill',
  decode2s: 'Decode (2초)',
  prefill2s: 'Prefill (2초)',
  decodeMean: '평균 Decode',
  prefillMean: '평균 Prefill',
  serversPartial: '(서버 {reporting}/{count})',
  running: '실행 중',
  queue: '대기열',
  kv: 'KV',
  contextUsed: '컨텍스트 사용률',
  noRequests: '요청 없음',
  ttft: 'TTFT',
  tpot: 'TPOT',
  meanDecode: '평균 Decode 시간',
  cacheHit: '캐시 적중',
  cacheHitSinceStart: '캐시 적중률 (엔진 시작 이후)',
  total: '합계',
  serving: '서빙 중',
  idle: '유휴',
  down: '응답 없음',
  checking: '확인 중',
  gpuLoad: 'GPU 사용률',
  mem: '메모리',
  vram: 'VRAM',
  gpuPower: 'GPU 전력',
  powerPartial: '(노드 {reporting}/{count})',
  mostMemory: '최대 메모리',
  mostGpuMemory: '최대 GPU 메모리',
  helpCacheHit: '엔진 시작 이후 프롬프트 토큰 중 prefix cache에서 가져온 비율입니다.',
  helpTtft: '첫 토큰이 나오기까지 걸린 시간입니다. 최근 5분 동안 완료된 요청 기준 p95 값입니다.',
  helpTpot: '출력 토큰 하나당 걸린 시간입니다. 최근 5분 동안 완료된 요청 기준 p95 값입니다.',
  helpMeanDecode:
    '출력 토큰 하나를 생성하는 데 걸린 평균 시간입니다. 짧을수록 응답이 빠릅니다. 수집 사이에 늘어난 생성 시간과 토큰 수로 계산하며 다음 생성이 완료될 때까지 유지합니다. 첫 토큰은 개수에만 포함되므로 평균 토큰 간격이나 p95와는 다릅니다.',
  helpCacheHitSinceStart:
    '엔진 시작 이후 계산한 프롬프트 토큰과 재사용한 토큰의 합에서 재사용한 토큰의 비율입니다. 요청 처리 중에는 두 카운터의 갱신 시점이 다를 수 있습니다.',
  helpContextUsed:
    '처리 중인 요청이 컨텍스트 한도에서 차지하는 비율입니다. vLLM의 KV 캐시 사용률과 달리 메모리가 아닌 토큰 수 기준입니다.',
  helpPrefill2s:
    '마지막 프롬프트 처리 중 초당 계산한 토큰 수입니다. TensorFold는 이 값을 2초간 유지한 뒤 0을 보고합니다.',
  helpDecode2s: '최근 2초 동안 초당 생성한 출력 토큰 수입니다.',
  helpPrefillMean:
    '서버 시작 이후 완료된 요청에서 계산한 프롬프트 토큰 수를 입력 처리 시간으로 나눈 값입니다. 캐시 재사용 토큰과 유휴 시간은 제외합니다. 실시간 속도가 아닌 세션 평균입니다.',
  helpDecodeMean:
    '서버 시작 이후 완료된 요청의 출력 토큰 수를 생성 시간으로 나눈 값입니다. 유휴 시간은 제외합니다. 실시간 속도가 아닌 세션 평균입니다.',
  helpStrataPrefill:
    '요청 처리 중에는 해당 요청의 프롬프트 읽기 속도를 표시합니다. 그 외에는 최근 완료된 요청에서 계산한 속도를 유지합니다.',
  helpTtftQueueExcluded: '최근 5분 동안 완료된 요청의 TTFT p95입니다. 대기 시간과 모델 로딩 시간은 제외합니다.',
  helpTpotTokenWeighted:
    '최근 5분 동안 완료된 요청마다 평균 토큰 간격을 구한 뒤 토큰 수로 가중한 p95입니다. 개별 토큰 간격의 p95는 아닙니다.',
  helpTpotRequestMean: '최근 5분 동안 완료된 응답별 평균 출력 토큰 간격의 p95입니다. 토큰이 하나인 응답은 제외합니다.',
  collapse: 'Spark Scope 접기',
  expand: 'Spark Scope 펼치기',
  nav: 'Spark Scope',
  settingTitle: 'Spark Scope 주소',
  settingDescription:
    '사이드바에 Spark Scope를 표시합니다. 내부 네트워크나 tailnet 주소를 입력하세요(예: http://spark-scope.local:8787). 비워 두면 카드를 숨깁니다.',
  settingInput: 'Spark Scope 주소',
  settingBad: 'http 또는 https 주소를 입력하세요.',
  settingFailed: '주소를 저장하지 못했습니다.',
  settingReadOnly: '설정은 dsh를 실행하는 컴퓨터에서만 바꿀 수 있습니다.',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'spark-scope': Key
  }
}

/**
 * Normalize the address field: trimmed, with http:// added when no scheme is given.
 * @returns the address to store ('' clears it), or undefined when it is not an http(s) URL.
 */
export function parseAddress(text: string): string | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return ''
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return withScheme.replace(/\/+$/, '')
  } catch {
    return undefined
  }
}

// Spark Scope's Soft design: its light and dark palettes, rounded card, pill bars. Sizes are in px, so dsh-ui-scale's
// zoom scales the card with the rest of the page.
const css = `
.dsp-card{--paper:#fff;--ink:#1c1e22;--muted:#6b7280;--line:#e4e6ea;--meter:#eceef2;--hover:#f1f3f6;--blue:#2563eb;--orange:#ea580c;--green:#059669;--red:#dc2626;--purple:#7c3aed;--gold:#a16207;--magenta:#db2777;--umber:#92745c;
  order:-2;flex:1 0 100%;box-sizing:border-box;min-width:0;margin:0 0 8px;padding:10px 12px;border-radius:14px;background:var(--paper);color:var(--ink);box-shadow:0 1px 2px #0000000f,0 4px 16px #00000008;font-size:12px;line-height:1.35;font-variant-numeric:tabular-nums;display:flex;flex-direction:column;gap:9px}
body[data-ds-dark-theme] .dsp-card{--paper:#1c1c1f;--ink:#f2f2f4;--muted:#a1a1aa;--line:#2b2b30;--meter:#2a2a2f;--hover:#26262a;--blue:#60a5fa;--orange:#fb923c;--green:#34d399;--red:#f87171;--purple:#a78bfa;--gold:#facc15;--magenta:#f472b6;--umber:#c4a487;box-shadow:inset 0 0 0 1px var(--line)}
:has(>[data-slot="sidebar.footer.action"]>.dsp-card){flex-wrap:wrap}
.dsp-head{display:flex;align-items:center;gap:6px;min-width:0;margin:-2px -4px -2px 0;font-size:11px;color:var(--muted)}
.dsp-head b{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--ink);font-size:12px;font-weight:600}
.dsp-head>span{white-space:nowrap}
.dsp-head .dsp-now{color:var(--ink);font-weight:600}
.dsp-dot{flex:none;width:7px;height:7px;border-radius:50%;background:currentColor}
.dsp-ok{color:var(--green)}.dsp-warn{color:var(--orange)}.dsp-crit{color:var(--red)}
.dsp-toggle{flex:none;display:flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:999px;background:transparent;color:var(--muted);cursor:pointer}
.dsp-toggle:hover{background:var(--hover);color:var(--ink)}
.dsp-toggle svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .15s}
.dsp-card[data-collapsed] .dsp-toggle svg{transform:rotate(180deg)}
.dsp-pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.dsp-metric{min-width:0}
.dsp-metric small{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--muted)}
.dsp-cover{display:block;min-height:1lh;font-size:9px;color:var(--muted)}
.dsp-metric b{font-size:22px;font-weight:650;line-height:1.1;letter-spacing:-.5px;white-space:nowrap}
.dsp-metric em{margin-left:3px;font-size:10px;font-style:normal;font-weight:500;letter-spacing:0;color:var(--muted)}
.dsp-spark{display:block;width:100%;height:22px}
.dsp-chips{display:flex;flex-wrap:wrap;gap:2px 9px;font-size:11px;color:var(--muted)}
.dsp-chips b{color:var(--ink);font-weight:600}
.dsp-spread{justify-content:space-between}
.dsp-rule{border-top:1px solid var(--line)}
.dsp-servers{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:2px 10px;align-items:center;font-size:11px}
.dsp-servers>div{display:contents}
.dsp-servers>div>span:not(.dsp-name){text-align:right;white-space:nowrap}
.dsp-servers .dsp-serving{color:color-mix(in srgb,var(--green) 70%,var(--ink))}.dsp-servers .dsp-down{color:var(--red)}.dsp-servers .dsp-idle,.dsp-servers .dsp-checking{color:var(--muted)}
.dsp-total>span{padding-top:3px;border-top:1px solid var(--line);font-weight:600}
.dsp-nodes{display:grid;gap:8px}
.dsp-nodes.dsp-two{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px}
.dsp-two .dsp-l1{grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto 1lh;gap:1px 6px}
.dsp-two .dsp-l1>span:nth-child(2){text-align:left}
.dsp-two .dsp-name{grid-column:1/-1}
.dsp-two .dsp-l2{gap:4px}
.dsp-node{display:grid;gap:4px;font-size:11px}
.dsp-l1{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;align-items:center}
.dsp-l1>span:not(.dsp-name){text-align:right;white-space:nowrap}
.dsp-name{display:flex;align-items:center;gap:5px;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:600}
.dsp-name>span{min-width:0;overflow:hidden;text-overflow:ellipsis}
.dsp-name i{flex:none;width:8px;height:8px;border-radius:50%;background:var(--node)}
.dsp-l2{display:grid;grid-template-columns:auto 1fr auto 1fr;gap:6px;align-items:center;font-size:9px;letter-spacing:.5px;color:var(--muted)}
.dsp-bar{position:relative;display:block;height:6px;border-radius:999px;background:var(--meter);overflow:hidden}
.dsp-bar i{position:absolute;inset:0 auto 0 0;border-radius:999px;background:var(--node)}
.dsp-bar.dsp-mem i{background:color-mix(in srgb,var(--node) 55%,var(--meter))}
.dsp-hot{color:var(--red)}.dsp-warm{color:var(--orange)}
.dsp-note{color:var(--muted)}
`

const chevron = () => h('svg', { viewBox: '0 0 24 24', 'aria-hidden': true }, h('path', { d: 'm6 15 6-6 6 6' }))
const heat = (celsius: unknown) =>
  finite(celsius) && celsius >= HOT_CELSIUS
    ? 'dsp-hot'
    : finite(celsius) && celsius >= HOT_CELSIUS - 8
      ? 'dsp-warm'
      : undefined
const percent = (part: unknown, whole: unknown) =>
  finite(part) && finite(whole) && whole > 0 ? Math.max(0, Math.min(100, (100 * part) / whole)) : 0

interface Poll {
  state: State | null
  samples: Sample[]
  error: string | null
  at: number
}

/**
 * Polls the host route every two seconds while the page is visible; the first answer also seeds the sparklines.
 * A request still running when the next tick comes makes that tick skip, so answers arrive in order.
 */
function usePoll(): Poll {
  const [poll, setPoll] = useState<Poll>({ state: null, samples: [], error: null, at: Date.now() })
  useEffect(() => {
    const abort = new AbortController()
    let busy = false
    let seeded = false
    const tick = async () => {
      if (document.hidden || busy) return
      busy = true
      let state: State | null = null
      let error: string | null = null
      try {
        const response = await fetch(`${ROUTE}${seeded ? '?history=0' : ''}`, {
          cache: 'no-store',
          headers: { accept: 'application/json' },
          signal: abort.signal,
        })
        const body: unknown = response.ok ? await response.json() : null
        const failure = (body as { error?: unknown } | null)?.error
        if (failure !== undefined) error = typeof failure === 'string' ? failure : 'unreachable'
        else state = parseState(body)
        if (state === null) error ??= 'unreachable'
      } catch {
        error = 'unreachable'
      } finally {
        busy = false
      }
      if (abort.signal.aborted) return
      const first = !seeded && state !== null
      if (first) seeded = true
      setPoll((previous) => {
        if (state === null) return { ...previous, error, at: Date.now() }
        const now = Date.parse(state.updatedAt ?? '') || Date.now()
        const samples = first ? historySamples(state, now - SPARK_MS) : previous.samples
        const sample = sampleOf(viewInference(state), now, samples.at(-1)?.at ?? null)
        const next = samples.length === 0 || sample.at > samples.at(-1)!.at ? [...samples, sample] : samples
        return { state, samples: next.filter((s) => s.at >= now - SPARK_MS), error: null, at: Date.now() }
      })
    }
    void tick()
    const timer = setInterval(() => {
      void tick()
    }, POLL_MS)
    const shown = () => {
      if (!document.hidden) void tick()
    }
    document.addEventListener('visibilitychange', shown)
    return () => {
      abort.abort()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', shown)
    }
  }, [])
  return poll
}

const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

interface Injected {
  hooks: { settings: HostObservable<ConfigFormSnapshot<{ url: string }>> }
}

type CardProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'spark-scope'> & InjectFace<Injected>

function Glance({ t }: Pick<CardProps, 't'>) {
  const { state, samples, error, at } = usePoll()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const toggle = () => {
    setCollapsed(!collapsed)
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '0' : '1')
    } catch {}
  }

  // `unset` reaches here only on a page that cannot read the settings; the host has no address either.
  if (error === 'unset' || (state === null && error === null)) return null
  if (error === 'invalid') return h('div', { className: 'dsp-card' }, h('div', { className: 'dsp-note' }, t('invalid')))

  const v = viewInference(state)
  const live = v?.ok ? v : null
  const nodes = state?.nodes ?? {}
  const metas = state?.order ?? []
  const servers = state?.servers ?? []
  const online = metas.filter((meta) => nodes[meta.id]?.ok).length
  const updated = Date.parse(state?.updatedAt ?? '')
  const offline = error !== null || !(at - updated < STALE_MS)
  const tone = offline ? 'dsp-crit' : state?.status === 'healthy' ? 'dsp-ok' : 'dsp-warn'
  const now = Number.isFinite(updated) ? updated : at
  const decode = engineMetric(v, 'outputTokensPerSecond')
  const prefill = engineMetric(v, 'promptComputeTokensPerSecond')
  const decodeValue = metricValue(v, decode)
  const needsKey = engineNeedsKey(v)

  const head = h(
    'div',
    { className: 'dsp-head' },
    h('span', { className: `dsp-dot ${tone}` }),
    h('b', { title: live?.modelName ?? '' }, live?.modelName || t('noModel')),
    collapsed && !offline && needsKey
      ? h('span', { className: 'dsp-warn' }, t('apiKey'))
      : collapsed && !offline && decode.shown
        ? h(
            'span',
            { className: 'dsp-now', title: t(decode.label) },
            decode.average && h('span', { className: 'dsp-note' }, `${t('mean')} `),
            rate(decodeValue),
            h('span', { className: 'dsp-note' }, ' tok/s'),
          )
        : h('span', { className: tone }, offline ? t('offline') : t('nodesUp', { online, count: metas.length })),
    h(
      'button',
      {
        type: 'button',
        className: 'dsp-toggle',
        'aria-expanded': !collapsed,
        'aria-label': t(collapsed ? 'expand' : 'collapse'),
        title: t(collapsed ? 'expand' : 'collapse'),
        onClick: toggle,
      },
      chevron(),
    ),
  )
  if (collapsed) return h('div', { className: 'dsp-card', 'data-collapsed': '' }, head)

  const coverage = (field: MetricKey) => {
    const partial = rateCoverage(servers, field)
    return partial ? t('serversPartial', partial) : ''
  }
  const reserveCoverLine = servers.length > 1
  const metric = (m: Metric, key: 'decode' | 'prefill', stroke: string) =>
    h(
      'div',
      { className: 'dsp-metric', title: m.help && t(m.help) },
      h('small', null, t(m.label)),
      reserveCoverLine && h('span', { className: 'dsp-cover' }, m.average ? '' : coverage(m.key)),
      h('b', null, rate(metricValue(v, m)), h('em', null, 'tok/s')),
      !m.average &&
        h(
          'svg',
          { className: 'dsp-spark', viewBox: '0 0 300 30', preserveAspectRatio: 'none', 'aria-hidden': true },
          h('path', {
            d: sparkPath(samples, key, now, SPARK_MS),
            fill: 'none',
            stroke,
            strokeWidth: 1.6,
            vectorEffect: 'non-scaling-stroke',
          }),
        ),
    )
  const chip = (label: string, value: string, title?: string) =>
    h('span', { key: label, title }, `${label} `, h('b', null, value))
  const engineChip = (field: MetricKey) => {
    const m = engineMetric(v, field)
    if (!m.shown) return null
    const reading = live?.[m.key] ?? null
    const value = m.idle ? t('noRequests') : m.key.endsWith('Seconds') ? duration(reading) : fixed(reading, 0, '%')
    return chip(t(m.label), value, m.help && t(m.help))
  }
  const color = (index: number) => `var(--${NODE_COLORS[index % NODE_COLORS.length]})`
  const unreported = (reading: Inference | null) => reading?.reported.outputTokensPerSecond === false

  const readings = metas.map((meta) => nodes[meta.id])
  const watts = gpuPowerWatts(readings)
  const reporting = readings.filter((node) => node?.ok && finite(node.gpu.powerWatts)).length
  const memories = readings.map(gpuMemory)
  const wording = memoryWording(memories.map((memory) => memory.kind))
  const fullest = memories
    .filter((memory) => finite(memory.used) && finite(memory.total) && memory.total > 0)
    .sort((a, b) => percent(b.used, b.total) - percent(a.used, a.total))[0]

  return h(
    'div',
    { className: 'dsp-card' },
    head,
    needsKey && h('div', { className: 'dsp-note' }, t('apiKey')),
    (decode.shown || prefill.shown) &&
      h(
        'div',
        { className: 'dsp-pair' },
        decode.shown && metric(decode, 'decode', 'var(--blue)'),
        prefill.shown && metric(prefill, 'prefill', 'var(--orange)'),
      ),
    h(
      'div',
      { className: 'dsp-chips' },
      chip(t('running'), fixed(live?.runningRequests ?? null, 0)),
      chip(t('queue'), fixed(live?.waitingRequests ?? null, 0)),
      engineChip('kvCachePercent'),
      engineChip('ttftP95RecentSeconds'),
      engineChip('tpotP95RecentSeconds'),
      engineChip('prefixCacheHitPercent'),
    ),
    servers.length > 1 &&
      h(
        'div',
        { className: 'dsp-servers' },
        servers.map((server, index) => {
          const own = server.inference
          const name = serverName(server)
          const status = serverState(server)
          const first = metas.findIndex((meta) => meta.id === server.nodes[0])
          return h(
            'div',
            { key: server.id ?? index, style: { '--node': color(Math.max(0, first)) } },
            h('span', { className: 'dsp-name', title: name }, h('i'), h('span', null, name)),
            h('span', null, unreported(own) ? '' : `${rate(own?.ok ? own.outputTokensPerSecond : null)} tok/s`),
            h('span', { className: `dsp-${status}` }, t(engineNeedsKey(own) ? 'apiKey' : status)),
          )
        }),
        h(
          'div',
          { className: 'dsp-total' },
          h('span', null, `${t('total')} ${coverage('outputTokensPerSecond')}`.trim()),
          h('span', null, unreported(v) ? '' : `${rate(v?.outputTokensPerSecond ?? null)} tok/s`),
          h('span'),
        ),
      ),
    h('div', { className: 'dsp-rule' }),
    h(
      'div',
      { className: metas.length > 4 ? 'dsp-nodes dsp-two' : 'dsp-nodes' },
      metas.map((meta, index) => {
        const node = nodes[meta.id]
        const gpu = node?.ok ? node.gpu : { utilization: null, temperature: null, powerWatts: null }
        const { kind, used, total } = memories[index]!
        return h(
          'div',
          { key: meta.id, className: 'dsp-node', style: { '--node': color(index) } },
          h(
            'div',
            { className: 'dsp-l1' },
            h('span', { className: 'dsp-name', title: meta.name }, h('i'), h('span', null, meta.name)),
            hasNodeTemperature(node) && [
              h('span', { key: 'temp', className: heat(gpu.temperature) }, fixed(gpu.temperature, 0, '°C')),
              h('span', { key: 'power' }, fixed(gpu.powerWatts, 1, ' W')),
            ],
          ),
          h(
            'div',
            { className: 'dsp-l2' },
            h('span', null, 'GPU'),
            h(
              'span',
              { className: 'dsp-bar', title: `${t('gpuLoad')} ${fixed(gpu.utilization, 0, '%')}` },
              h('i', { style: { width: `${percent(gpu.utilization, 100).toFixed(0)}%` } }),
            ),
            h('span', null, t(kind === 'discrete' ? 'vram' : 'mem')),
            h(
              'span',
              {
                className: 'dsp-bar dsp-mem',
                title: finite(used) && finite(total) ? `${gib(used)} / ${gib(total, 0)} GiB` : undefined,
              },
              h('i', { style: { width: `${percent(used, total).toFixed(0)}%` } }),
            ),
          ),
        )
      }),
    ),
    h(
      'div',
      { className: 'dsp-chips dsp-spread' },
      watts !== null &&
        h(
          'span',
          { key: 'power' },
          `${t('gpuPower')} `,
          h('b', null, `${fixed(watts)} W`),
          reporting < metas.length ? ` ${t('powerPartial', { reporting, count: metas.length })}` : null,
        ),
      chip(
        t(wording === 'unified' ? 'mostMemory' : 'mostGpuMemory'),
        fullest ? `${gib(fullest.used)} / ${gib(fullest.total, 0)} GiB` : '—',
      ),
    ),
  )
}

/**
 * The card mounts (and polls) only in the wide sidebar, since the 56 px rail has no room for it, and only with an
 * address. A new address mounts a fresh card, so the sparklines do not mix two servers. A page that cannot read the
 * settings polls anyway, and the host answers with its own address or `unset`.
 */
function Card({ wide, t, useSettings }: CardProps) {
  const address = useSettings((s) => (s.status === 'ready' ? (s.value?.url ?? '') : null))
  if (!wide || address === '') return null
  return h(Glance, { key: address ?? '', t })
}

interface RowInjected extends Injected {
  /** Resolves true once dsh saved the address. */
  setAddress: (address: string) => Promise<boolean>
}

type SectionProps = PropsRuntime<'settings.section'> & PropsLocale<'spark-scope'> & InjectFace<RowInjected>

/** The Spark Scope page in Settings: the address field. */
function AddressSection({ t, useSettings, setAddress }: SectionProps) {
  const address = useSettings((s) => s.value?.url ?? '')
  // Pages opened from another computer keep settings in memory only and cannot save them.
  const status = useSettings((s) =>
    s.status === 'loading' ? 'loading' : s.status === 'ready' && s.writable ? 'writable' : 'readOnly',
  )
  const [text, setText] = useState<string>()
  const [problem, setProblem] = useState<'settingBad' | 'settingFailed'>()
  const id = useId()
  // The field's latest text, so a save that settles after further typing leaves the new draft alone.
  const draft = useRef<string>()
  draft.current = text
  const commit = () => {
    if (text === undefined) return
    const parsed = parseAddress(text)
    if (parsed === undefined) return setProblem('settingBad')
    if (parsed === address) return setText(undefined)
    const submitted = text
    setAddress(parsed)
      .catch(() => false)
      .then((saved) => {
        if (draft.current !== submitted) return
        setProblem(saved ? undefined : 'settingFailed')
        if (saved) setText(undefined)
      })
  }
  return h(
    'div',
    { className: 'dsp-row' },
    h(
      'div',
      { className: 'dsp-row-text' },
      h('div', { id: `${id}title`, className: 'dsp-row-title' }, t('settingTitle')),
      h('div', { id: `${id}desc`, className: 'dsp-row-desc' }, t('settingDescription')),
    ),
    h('input', {
      type: 'url',
      inputMode: 'url',
      spellCheck: false,
      placeholder: 'http://spark-scope.local:8787',
      disabled: status !== 'writable',
      'aria-label': t('settingInput'),
      'aria-describedby': `${id}desc`,
      'aria-invalid': problem !== undefined,
      value: text ?? address,
      onChange: (event) => {
        setText(event.target.value)
        setProblem(undefined)
      },
      onBlur: commit,
      onKeyDown: (event) => {
        if (event.key === 'Enter') commit()
      },
    }),
    status === 'readOnly' && h('div', { className: 'dsp-row-desc' }, t('settingReadOnly')),
    problem !== undefined && h('div', { role: 'alert', className: 'dsp-row-bad' }, t(problem)),
  )
}

const rowCss = `
.dsp-row{display:flex;flex-direction:column;gap:8px;padding:16px 0}
.dsp-row-text{display:flex;flex-direction:column;gap:4px}
.dsp-row-title{font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}
.dsp-row-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsp-row input{box-sizing:border-box;width:100%;height:36px;padding:0 10px;border:none;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);font:inherit;font-size:14px;color:var(--dsw-alias-label-primary)}
.dsp-row input:disabled{opacity:.6}
.dsp-row input[aria-invalid="true"]{outline:1px solid var(--dsw-alias-state-error-primary,#dc2626)}
.dsp-row-bad{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#dc2626)}
`

export const inject = ['slots', 'locale', 'configForms']

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const style = Object.assign(document.createElement('style'), { id: 'dsh-spark-scope', textContent: css + rowCss })
    document.head.append(style)
    return () => {
      style.remove()
    }
  }, 'spark-scope: styles')
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'spark-scope: en/zh strings')
  ctx.effect(() => ctx.locale.register(NS, 'ko', ko), 'spark-scope: ko strings')

  // An empty address is stored as such: unset would bring back an address set in the profile's own patch layer.
  const form = ctx.configForms.get<{ url: string }>(NS)
  const setAddress = (next: string) => form.set('url', next)

  // Order -1 puts the card before dsh-cost-meter's balance (order 0) at the sidebar foot.
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      {
        name: 'sidebar.footer.action',
        id: 'spark-scope',
        order: -1,
        locale: NS,
        inject: (): Injected => ({ hooks: { settings: form } }),
      },
      Card,
    ),
  )
  // Its own page in Settings, after the built-in ones.
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'spark-scope',
        order: 50,
        label: () => ctx.locale.bind(NS)('nav'),
        locale: NS,
        inject: (): RowInjected => ({ hooks: { settings: form }, setAddress }),
      },
      AddressSection,
    ),
  )
}
