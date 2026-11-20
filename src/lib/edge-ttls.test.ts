import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import nextConfig from '@/next.config'

// Next matches headers() sources with this path-to-regexp build.
const { pathToRegexp } = createRequire(import.meta.url)('next/dist/compiled/path-to-regexp') as {
  pathToRegexp: (source: string) => RegExp
}

/** The CDN-Cache-Control a path gets: the last matching headers() rule wins, as in Next and OpenNext. */
async function cdnCacheControl(path: string): Promise<string | null> {
  let value: string | null = null
  for (const rule of await nextConfig.headers!()) {
    if (!pathToRegexp(rule.source).test(path)) continue
    for (const h of rule.headers) if (h.key === 'CDN-Cache-Control') value = h.value
  }
  return value
}

describe('edge TTLs (next.config headers)', () => {
  it.each([
    '/home',
    '/schedule',
    '/schedule/22500123',
    '/schedule/22500123/ics',
    '/schedule.ics',
    '/players',
    '/players/201935',
    '/players/201935/season/2024',
    '/players/table',
    '/players/all-time',
    '/players/traded',
    '/players/traded/table',
    '/history',
    '/history/22500123',
    '/history/season/2024',
    '/history/season/2024/home',
    '/franchise',
    '/franchise/draft',
    '/franchise/moves/trade/2020',
    '/franchise/person/nba:1641715',
    '/franchise/trades/some-trade',
    '/news',
    '/news/articles',
    '/news/social',
  ])('gives the prerendered page %s a day at the edge', async (path) => {
    expect(await cdnCacheControl(path)).toBe('public, s-maxage=86400, stale-while-revalidate=86400')
  })

  it('leaves the live pipeline alone and keeps media short', async () => {
    expect(await cdnCacheControl('/api/live')).toBeNull()
    expect(await cdnCacheControl('/live')).toBeNull()
    expect(await cdnCacheControl('/players/nba/1629029')).toBeNull()
    expect(await cdnCacheControl('/api/media')).toBe('public, s-maxage=60, stale-while-revalidate=300')
  })
})
