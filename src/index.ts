import type { Context, Volatile } from '@deepseek-ai/cordis'
import type { ServerResponse } from 'node:http'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-spark-scope'
export const inject = ['webServer', 'connection']

export interface Config {
  /** Spark Scope address, such as http://spark-scope.local:8787 or https://host.tailnet.ts.net. Empty hides the card. */
  url: Volatile<string>
}

export const Config = z.object({
  url: z.string().default('').volatile(),
})

/** The route the client half polls; the browser cannot read Spark Scope itself (no CORS, other Host names refused). */
const ROUTE = '/plugins/dsh-spark-scope/state'
/** A real 15-minute state with history is about 100 KB; anything far larger is not Spark Scope. */
const MAX_BYTES = 2 * 1024 * 1024

// Failures are answered 200 with an `error` field: the card polls every two seconds, and a failed status would put a
// console error on the page each time.
function send(res: ServerResponse, body: string): void {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

/** The body as text, or null once it grows past MAX_BYTES. */
async function readLimited(response: Response): Promise<string | null> {
  if (response.body === null) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > MAX_BYTES) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: async (req, res) => {
      // The same Host/Origin checks and sign-in as dsh's own /api routes.
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined || req.method !== 'GET') {
        res.writeHead(rejection ?? 405, rejection === undefined ? { allow: 'GET' } : {})
        res.end()
        return
      }
      const text = config.url.get().trim()
      if (text === '') return send(res, '{"error":"unset"}')
      let base: URL
      try {
        base = new URL(text.endsWith('/') ? text : `${text}/`)
        if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new Error(base.protocol)
      } catch {
        return send(res, '{"error":"invalid"}')
      }
      // The client asks for the chart history once and then polls without it, as Spark Scope's own pages do.
      const history = new URL(req.url ?? '', 'http://local').searchParams.get('history') === '0' ? '&history=0' : ''
      try {
        const response = await fetch(new URL(`api/state?minutes=15${history}`, base), { signal: AbortSignal.timeout(5000) })
        if (!response.ok) return send(res, JSON.stringify({ error: 'http', status: response.status }))
        const body = await readLimited(response)
        send(res, body ?? '{"error":"large"}')
      } catch {
        send(res, '{"error":"unreachable"}')
      }
    },
  }), 'spark-scope: state route')
}
