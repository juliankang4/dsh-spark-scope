import type { Context } from '@deepseek-ai/cordis'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { createElement as h, useEffect, useId, useRef, useState } from 'react'
import {
  duration,
  finite,
  fixed,
  gib,
  historySamples,
  parseState,
  prefillRate,
  rate,
  sampleOf,
  sparkPath,
  viewInference,
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
  decode: 'Decode',
  prefill: 'Prefill',
  running: 'Running',
  queue: 'Queue',
  cacheHit: 'Cache hit',
  gpuLoad: 'GPU load',
  mem: 'MEM',
  gpuPower: 'GPU power',
  mostMemory: 'Most memory used',
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
  decode: 'Decode',
  prefill: 'Prefill',
  running: '运行中',
  queue: '队列',
  cacheHit: '缓存命中',
  gpuLoad: 'GPU 负载',
  mem: '内存',
  gpuPower: 'GPU 功耗',
  mostMemory: '最高内存',
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
  decode: 'Decode',
  prefill: 'Prefill',
  running: '실행 중',
  queue: '대기열',
  cacheHit: '캐시 적중',
  gpuLoad: 'GPU 사용률',
  mem: '메모리',
  gpuPower: 'GPU 전력',
  mostMemory: '최대 메모리',
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
.dsp-metric small{display:block;font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--muted)}
.dsp-metric b{font-size:22px;font-weight:650;line-height:1.1;letter-spacing:-.5px;white-space:nowrap}
.dsp-metric em{margin-left:3px;font-size:10px;font-style:normal;font-weight:500;letter-spacing:0;color:var(--muted)}
.dsp-spark{display:block;width:100%;height:22px}
.dsp-chips{display:flex;flex-wrap:wrap;gap:2px 9px;font-size:11px;color:var(--muted)}
.dsp-chips b{color:var(--ink);font-weight:600}
.dsp-spread{justify-content:space-between}
.dsp-rule{border-top:1px solid var(--line)}
.dsp-nodes{display:grid;gap:8px}
.dsp-node{display:grid;gap:4px;font-size:11px}
.dsp-l1{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;align-items:center}
.dsp-l1>span:not(.dsp-name){text-align:right;white-space:nowrap}
.dsp-name{display:flex;align-items:center;gap:5px;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:600}
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
  const online = metas.filter((meta) => nodes[meta.id]?.ok).length
  const updated = Date.parse(state?.updatedAt ?? '')
  const offline = error !== null || !(at - updated < STALE_MS)
  const tone = offline ? 'dsp-crit' : state?.status === 'healthy' ? 'dsp-ok' : 'dsp-warn'
  const now = Number.isFinite(updated) ? updated : at

  const head = h(
    'div',
    { className: 'dsp-head' },
    h('span', { className: `dsp-dot ${tone}` }),
    h('b', { title: live?.modelName ?? '' }, live?.modelName || t('noModel')),
    collapsed && !offline
      ? h(
          'span',
          { className: 'dsp-now' },
          rate(live?.outputTokensPerSecond ?? null),
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

  const metric = (label: string, value: string, key: 'decode' | 'prefill', stroke: string) =>
    h(
      'div',
      { className: 'dsp-metric' },
      h('small', null, label),
      h('b', null, value, h('em', null, 'tok/s')),
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
  const chip = (label: string, value: string) => h('span', { key: label }, `${label} `, h('b', null, value))
  const readings = metas.map((meta) => nodes[meta.id]).filter((node) => node?.ok)
  const watts = readings
    .map((node) => node.gpu.powerWatts)
    .filter(finite)
    .reduce((sum, w) => sum + w, 0)
  const fullest = readings
    .filter((node) => finite(node.memory.usedBytes) && finite(node.memory.totalBytes) && node.memory.totalBytes > 0)
    .sort(
      (a, b) => percent(b.memory.usedBytes, b.memory.totalBytes) - percent(a.memory.usedBytes, a.memory.totalBytes),
    )[0]

  return h(
    'div',
    { className: 'dsp-card' },
    head,
    h(
      'div',
      { className: 'dsp-pair' },
      metric(t('decode'), rate(live?.outputTokensPerSecond ?? null), 'decode', 'var(--blue)'),
      metric(t('prefill'), rate(prefillRate(live)), 'prefill', 'var(--orange)'),
    ),
    h(
      'div',
      { className: 'dsp-chips' },
      chip(t('running'), fixed(live?.runningRequests ?? null, 0)),
      chip(t('queue'), fixed(live?.waitingRequests ?? null, 0)),
      chip('KV', fixed(live?.kvCachePercent ?? null, 0, '%')),
      chip('TTFT', duration(live?.ttftP95RecentSeconds ?? null)),
      chip('TPOT', duration(live?.tpotP95RecentSeconds ?? null)),
      chip(t('cacheHit'), fixed(live?.prefixCacheHitPercent ?? null, 0, '%')),
    ),
    h('div', { className: 'dsp-rule' }),
    h(
      'div',
      { className: 'dsp-nodes' },
      metas.map((meta, index) => {
        const node = nodes[meta.id]
        const gpu = node?.ok ? node.gpu : { utilization: null, temperature: null, powerWatts: null }
        const memory = node?.ok ? node.memory : { usedBytes: null, totalBytes: null }
        return h(
          'div',
          {
            key: meta.id,
            className: 'dsp-node',
            style: { '--node': `var(--${NODE_COLORS[index % NODE_COLORS.length]})` },
          },
          h(
            'div',
            { className: 'dsp-l1' },
            h('span', { className: 'dsp-name', title: meta.name }, h('i'), meta.name),
            h('span', { className: heat(gpu.temperature) }, fixed(gpu.temperature, 0, '°C')),
            h('span', null, fixed(gpu.powerWatts, 1, ' W')),
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
            h('span', null, t('mem')),
            h(
              'span',
              { className: 'dsp-bar dsp-mem', title: `${gib(memory.usedBytes)} / ${gib(memory.totalBytes, 0)} GiB` },
              h('i', { style: { width: `${percent(memory.usedBytes, memory.totalBytes).toFixed(0)}%` } }),
            ),
          ),
        )
      }),
    ),
    h(
      'div',
      { className: 'dsp-chips dsp-spread' },
      chip(t('gpuPower'), `${fixed(watts)} W`),
      chip(
        t('mostMemory'),
        fullest ? `${gib(fullest.memory.usedBytes)} / ${gib(fullest.memory.totalBytes, 0)} GiB` : '—',
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
