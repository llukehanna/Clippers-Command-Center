// src/lib/edge-cache.ts
// Shared edge cache for the Cloudflare Worker entry (worker.ts): a GET whose
// response carries `CDN-Cache-Control: s-maxage=N[, stale-while-revalidate=M]`
// is stored in the Cache API, and later requests in the same Cloudflare
// location are answered from it without running Next.js. A crawler burst
// then costs one render per location per TTL instead of one per request.
//
// TTLs are declared by the routes (next.config.ts headers(), and /api/live
// itself); this module only enforces the rules:
// - only GET, no Authorization, never /api/cron/*;
// - RSC (client navigation) requests only with Next's `_rsc` cache-busting
//   param, and keyed apart from the HTML document at the same URL;
// - only 200s, never `private`/`no-store`; Set-Cookie is never stored.
// The key is the URL alone: the app reads no cookies or request headers.
//
// Runtime-agnostic (Request/Response only) so it can be unit tested in Node.
// The Cache API only works on a custom domain; on workers.dev every lookup
// misses and every request renders.

export interface EdgeCacheStore {
  match(request: Request): Promise<Response | undefined>
  put(request: Request, response: Response): Promise<void>
}

export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void
}

export interface EdgePolicy {
  /** Seconds a stored response is served as fresh. */
  fresh: number
  /** Further seconds it may be served stale while one background render refreshes it. */
  stale: number
}

const STORED_AT = 'X-Edge-Stored-At'
const FRESH_FOR = 'X-Edge-Fresh'
const BROWSER_CACHE_CONTROL = 'X-Edge-Browser-Cache-Control'
export const EDGE_STATUS = 'X-Edge-Cache'

/** Whether this request may be answered from, or stored in, the edge cache. */
export function isCacheableRequest(request: Request): boolean {
  if (request.method !== 'GET') return false
  if (request.headers.has('authorization')) return false
  if (request.headers.has('next-action')) return false
  const url = new URL(request.url)
  if (url.pathname.startsWith('/api/cron/')) return false
  // Client navigations vary on router-state headers; Next folds those into
  // the `_rsc` param, so without it the URL doesn't identify the response.
  if (request.headers.get('rsc') === '1' && !url.searchParams.has('_rsc')) return false
  return true
}

/** The cache key: the URL, plus which representation (HTML document or RSC payload). */
export function cacheKey(request: Request): Request {
  const url = new URL(request.url)
  url.searchParams.set('__edge', request.headers.get('rsc') === '1' ? 'rsc' : 'doc')
  return new Request(url.toString(), { method: 'GET' })
}

/** The edge TTLs a response asks for, or null when it must not be stored. */
export function edgePolicy(response: Response): EdgePolicy | null {
  if (response.status !== 200) return null
  const header = response.headers.get('CDN-Cache-Control')
  if (!header) return null
  const directives = new Map<string, string>()
  for (const part of header.toLowerCase().split(',')) {
    const [name, value = ''] = part.trim().split('=')
    if (name) directives.set(name, value.trim())
  }
  if (directives.has('private') || directives.has('no-store') || directives.has('no-cache')) return null
  const seconds = (name: string): number => {
    const n = Number(directives.get(name))
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  }
  const fresh = seconds('s-maxage') || seconds('max-age')
  if (fresh <= 0) return null
  return { fresh, stale: seconds('stale-while-revalidate') }
}

/** The copy that goes into the Cache API: edge TTL, no cookies, browser headers kept aside. */
export function toStored(response: Response, policy: EdgePolicy, now: number): Response {
  const stored = new Response(response.body, response)
  stored.headers.delete('Set-Cookie')
  // The Cache API keys on the URL we give it; Vary would only fragment or block storage.
  stored.headers.delete('Vary')
  stored.headers.set(BROWSER_CACHE_CONTROL, response.headers.get('Cache-Control') ?? 'no-store')
  stored.headers.set('Cache-Control', `public, max-age=${policy.fresh + policy.stale}`)
  stored.headers.set(STORED_AT, String(now))
  stored.headers.set(FRESH_FOR, String(policy.fresh))
  stored.headers.delete(EDGE_STATUS)
  return stored
}

/** A stored copy, turned back into what the browser would have got from Next. */
export function fromStored(hit: Response, status: 'HIT' | 'STALE'): Response {
  const res = new Response(hit.body, hit)
  res.headers.set('Cache-Control', hit.headers.get(BROWSER_CACHE_CONTROL) ?? 'no-store')
  res.headers.delete(BROWSER_CACHE_CONTROL)
  res.headers.delete(STORED_AT)
  res.headers.delete(FRESH_FOR)
  res.headers.delete('Set-Cookie')
  res.headers.set(EDGE_STATUS, status)
  return res
}

function withStatus(response: Response, status: string): Response {
  const res = new Response(response.body, response)
  res.headers.set(EDGE_STATUS, status)
  return res
}

// One background refresh per key per isolate.
const refreshing = new Set<string>()

export interface EdgeCacheOptions {
  store: EdgeCacheStore
  ctx: WaitUntil
  now?: () => number
}

/**
 * Answers `request` from the edge cache when possible, else calls `render`
 * (the Next.js app) and stores the result if the response allows it.
 */
export async function serveWithEdgeCache(
  request: Request,
  render: () => Promise<Response>,
  { store, ctx, now = Date.now }: EdgeCacheOptions
): Promise<Response> {
  if (!isCacheableRequest(request)) return render()

  const key = cacheKey(request)
  /** Stores `response` (or a clone of it, when the caller still sends the original). */
  const storeFrom = (response: Response, { clone }: { clone: boolean }): Promise<void> => {
    const policy = edgePolicy(response)
    if (!policy) return Promise.resolve()
    const copy = clone ? response.clone() : response
    return store.put(key, toStored(copy, policy, now())).catch(() => {})
  }

  const hit = await store.match(key)
  if (hit) {
    const ageSeconds = (now() - Number(hit.headers.get(STORED_AT))) / 1000
    if (ageSeconds <= Number(hit.headers.get(FRESH_FOR))) return fromStored(hit, 'HIT')
    // Past its fresh window but still stored (the Cache API drops it after
    // fresh + stale): serve it, and refresh in the background.
    if (!refreshing.has(key.url)) {
      refreshing.add(key.url)
      ctx.waitUntil(
        render()
          .then((fresh) => storeFrom(fresh, { clone: false }))
          .catch(() => {})
          .finally(() => refreshing.delete(key.url))
      )
    }
    return fromStored(hit, 'STALE')
  }

  const response = await render()
  ctx.waitUntil(storeFrom(response, { clone: true }))
  return edgePolicy(response) ? withStatus(response, 'MISS') : response
}
