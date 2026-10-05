import { describe, expect, it, vi } from 'vitest'
import {
  cacheKey,
  edgePolicy,
  isCacheableRequest,
  serveWithEdgeCache,
  type EdgeCacheStore,
} from './edge-cache'

const ORIGIN = 'https://clippers.lukeghanna.com'
const TTL = 'public, s-maxage=60, stale-while-revalidate=300'

/** In-memory stand-in for caches.default (keyed by URL, like the Cache API). */
function memoryStore() {
  const entries = new Map<string, Response>()
  const store: EdgeCacheStore = {
    async match(req) {
      return entries.get(req.url)?.clone()
    },
    async put(req, res) {
      entries.set(req.url, new Response(await res.arrayBuffer(), res))
    },
  }
  return { store, entries }
}

function ctxCollector() {
  const pending: Promise<unknown>[] = []
  return {
    ctx: { waitUntil: (p: Promise<unknown>) => void pending.push(p) },
    settle: async () => {
      while (pending.length) await pending.shift()
    },
  }
}

function page(body: string, headers: Record<string, string> = {}, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'private, no-cache, no-store, max-age=0, must-revalidate',
      'CDN-Cache-Control': TTL,
      ...headers,
    },
  })
}

const get = (path: string, headers: Record<string, string> = {}) => new Request(`${ORIGIN}${path}`, { headers })

describe('isCacheableRequest', () => {
  it('accepts plain GETs of pages and read APIs', () => {
    expect(isCacheableRequest(get('/home'))).toBe(true)
    expect(isCacheableRequest(get('/api/players/22157'))).toBe(true)
    expect(isCacheableRequest(get('/history?season=2024'))).toBe(true)
  })

  it('bypasses non-GET, auth, cron, and server actions', () => {
    expect(isCacheableRequest(new Request(`${ORIGIN}/home`, { method: 'POST' }))).toBe(false)
    expect(isCacheableRequest(new Request(`${ORIGIN}/home`, { method: 'HEAD' }))).toBe(false)
    expect(isCacheableRequest(get('/api/home', { Authorization: 'Bearer x' }))).toBe(false)
    expect(isCacheableRequest(get('/api/cron/poll-live'))).toBe(false)
    expect(isCacheableRequest(get('/home', { 'Next-Action': 'abc' }))).toBe(false)
  })

  it('accepts RSC requests only with the _rsc cache-busting param', () => {
    expect(isCacheableRequest(get('/home', { RSC: '1' }))).toBe(false)
    expect(isCacheableRequest(get('/home?_rsc=1x2y3', { RSC: '1' }))).toBe(true)
  })
})

describe('cacheKey', () => {
  it('keys on the URL, keeping HTML and RSC apart', () => {
    const doc = cacheKey(get('/home?_rsc=abc'))
    const rsc = cacheKey(get('/home?_rsc=abc', { RSC: '1' }))
    expect(doc.url).not.toBe(rsc.url)
    expect(cacheKey(get('/home', { Cookie: 'a=1' })).url).toBe(cacheKey(get('/home')).url)
  })
})

describe('edgePolicy', () => {
  it('reads s-maxage and stale-while-revalidate', () => {
    expect(edgePolicy(page('x'))).toEqual({ fresh: 60, stale: 300 })
    expect(edgePolicy(page('x', { 'CDN-Cache-Control': 'max-age=2' }))).toEqual({ fresh: 2, stale: 0 })
  })

  it('refuses responses that did not opt in, opted out, or failed', () => {
    expect(edgePolicy(new Response('x'))).toBeNull()
    expect(edgePolicy(page('x', { 'CDN-Cache-Control': 'private, max-age=60' }))).toBeNull()
    expect(edgePolicy(page('x', { 'CDN-Cache-Control': 'no-store' }))).toBeNull()
    expect(edgePolicy(page('x', { 'CDN-Cache-Control': 's-maxage=0' }))).toBeNull()
    expect(edgePolicy(page('x', {}, 404))).toBeNull()
    expect(edgePolicy(page('x', {}, 500))).toBeNull()
  })
})

describe('serveWithEdgeCache', () => {
  it('renders once, then serves hits without running Next', async () => {
    const { store } = memoryStore()
    const { ctx, settle } = ctxCollector()
    const render = vi.fn(async () => page('<p>home</p>'))
    let now = 1_000_000

    const first = await serveWithEdgeCache(get('/home'), render, { store, ctx, now: () => now })
    expect(first.headers.get('X-Edge-Cache')).toBe('MISS')
    expect(await first.text()).toBe('<p>home</p>')
    await settle()

    now += 30_000
    const second = await serveWithEdgeCache(get('/home'), render, { store, ctx, now: () => now })
    expect(render).toHaveBeenCalledTimes(1)
    expect(second.headers.get('X-Edge-Cache')).toBe('HIT')
    expect(await second.text()).toBe('<p>home</p>')
    // Browsers get Next's own Cache-Control back, not the edge TTL.
    expect(second.headers.get('Cache-Control')).toBe('private, no-cache, no-store, max-age=0, must-revalidate')
    expect(second.headers.get('X-Edge-Stored-At')).toBeNull()
  })

  it('never stores Set-Cookie', async () => {
    const { store, entries } = memoryStore()
    const { ctx, settle } = ctxCollector()
    const render = async () => page('<p>x</p>', { 'Set-Cookie': 'session=secret; HttpOnly' })

    await serveWithEdgeCache(get('/players'), render, { store, ctx })
    await settle()
    const stored = [...entries.values()][0]
    expect(stored).toBeDefined()
    expect(stored.headers.get('Set-Cookie')).toBeNull()
    expect(stored.headers.get('Cache-Control')).toBe('public, max-age=360')

    const hit = await serveWithEdgeCache(get('/players'), render, { store, ctx })
    expect(hit.headers.get('X-Edge-Cache')).toBe('HIT')
    expect(hit.headers.get('Set-Cookie')).toBeNull()
  })

  it('serves stale past the fresh window and refreshes once in the background', async () => {
    const { store } = memoryStore()
    const { ctx, settle } = ctxCollector()
    let version = 1
    const render = vi.fn(async () => page(`v${version}`))
    let now = 0

    await serveWithEdgeCache(get('/news'), render, { store, ctx, now: () => now })
    await settle()
    version = 2
    now = 61_000

    const [a, b] = await Promise.all([
      serveWithEdgeCache(get('/news'), render, { store, ctx, now: () => now }),
      serveWithEdgeCache(get('/news'), render, { store, ctx, now: () => now }),
    ])
    expect(a.headers.get('X-Edge-Cache')).toBe('STALE')
    expect(await a.text()).toBe('v1')
    expect(await b.text()).toBe('v1')
    await settle()
    expect(render).toHaveBeenCalledTimes(2) // one initial render + one refresh

    const fresh = await serveWithEdgeCache(get('/news'), render, { store, ctx, now: () => now })
    expect(fresh.headers.get('X-Edge-Cache')).toBe('HIT')
    expect(await fresh.text()).toBe('v2')
  })

  it('passes bypassed and non-opted-in requests straight through', async () => {
    const { store, entries } = memoryStore()
    const { ctx, settle } = ctxCollector()

    const cron = vi.fn(async () => page('ok'))
    await serveWithEdgeCache(get('/api/cron/poll-live', { Authorization: 'Bearer s' }), cron, { store, ctx })
    await serveWithEdgeCache(get('/api/cron/poll-live', { Authorization: 'Bearer s' }), cron, { store, ctx })
    expect(cron).toHaveBeenCalledTimes(2)

    const live = vi.fn(async () => new Response('{}', { headers: { 'Cache-Control': 'no-store' } }))
    const res = await serveWithEdgeCache(get('/api/live'), live, { store, ctx })
    expect(res.headers.get('X-Edge-Cache')).toBeNull()

    const error = vi.fn(async () => page('boom', {}, 500))
    await serveWithEdgeCache(get('/home'), error, { store, ctx })
    await settle()
    expect(entries.size).toBe(0)
  })

  it('caches /api/live for its max-age only, with no stale window', async () => {
    const { store } = memoryStore()
    const { ctx, settle } = ctxCollector()
    const render = vi.fn(async () => page('{"state":"LIVE"}', { 'CDN-Cache-Control': 'max-age=2' }))
    let now = 0
    await serveWithEdgeCache(get('/api/live'), render, { store, ctx, now: () => now })
    await settle()
    now = 1_500
    expect((await serveWithEdgeCache(get('/api/live'), render, { store, ctx, now: () => now })).headers.get('X-Edge-Cache')).toBe('HIT')
    expect(render).toHaveBeenCalledTimes(1)
  })
})
