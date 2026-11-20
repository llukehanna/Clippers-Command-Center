import { describe, expect, it } from 'vitest'
import type { CachedPayload } from '@/src/lib/prebuild/payload-cache'
import { classify, shouldDrop, ttlDays, type ClassifyContext } from './classify'

const ctx: ClassifyContext = {
  currentSeasonId: 2025,
  recentGameIds: new Set(['100']),
  rosterIds: new Set(['7']),
}

const cases: Array<[string, string]> = [
  ['/api/history/games/100', 'volatile'],
  ['/api/history/games/100/story', 'volatile'],
  ['/api/history/games/200', 'settled'],
  ['/api/history/games/200/story', 'settled'],
  ['/api/history/games?season_id=2024', 'settled'],
  ['/api/history/games?season_id=2025', 'volatile'],
  ['/api/history/games?season_id=2024&type=regular', 'settled'],
  ['/api/players/9?season_id=2024', 'settled'],
  ['/api/players/9?season_id=2025', 'volatile'],
  ['/api/players/7?season_id=2024', 'settled'],
  ['/api/players/7?lac_only=true', 'volatile'],
  ['/api/players/9?lac_only=true', 'settled'],
  ['/api/players/7/career', 'volatile'],
  ['/api/players/9/career', 'settled'],
  ['/api/franchise/moves?season=2020', 'settled'],
  ['/api/franchise/moves?season=2025', 'volatile'],
  ['/api/franchise/moves?season=2020&player_id=5', 'volatile'],
  ['/api/franchise/moves?player=blake-griffin', 'weekly'],
  ['/api/franchise/moves', 'volatile'],
  ['/api/franchise/trades/some-trade', 'weekly'],
  ['/api/franchise/draft', 'weekly'],
  ['/api/franchise/honors', 'weekly'],
  ['/api/franchise/front-office', 'weekly'],
  ['/api/franchise/people', 'weekly'],
  ['/api/history/seasons', 'weekly'],
  ['/api/home', 'volatile'],
  ['/api/schedule', 'volatile'],
  ['/api/players?include_traded=true', 'volatile'],
]

describe('classify', () => {
  it.each(cases)('%s -> %s', (path, expected) => {
    expect(classify(path, ctx)).toBe(expected)
  })
})

describe('ttlDays', () => {
  it('is stable for a path and within range', () => {
    const p = '/api/history/games/200'
    expect(ttlDays(p, 'settled')).toBe(ttlDays(p, 'settled'))
    expect(ttlDays(p, 'settled')).toBeGreaterThanOrEqual(60)
    expect(ttlDays(p, 'settled')).toBeLessThanOrEqual(90)
    expect(ttlDays('/api/history/seasons', 'weekly')).toBeGreaterThanOrEqual(5)
    expect(ttlDays('/api/history/seasons', 'weekly')).toBeLessThanOrEqual(9)
    expect(ttlDays('/api/home', 'volatile')).toBe(0)
  })
})

describe('shouldDrop', () => {
  const now = new Date('2026-11-19T12:00:00Z')
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString()
  const entry = (path: string, d: number): CachedPayload => ({ path, status: 200, body: {}, fetchedAt: daysAgo(d) })

  it('settled entries expire after their TTL', () => {
    const p = '/api/history/games/200'
    expect(shouldDrop(entry(p, 91), ctx, now)).toBe(true)
    expect(shouldDrop(entry(p, 59), ctx, now)).toBe(false)
  })

  it('volatile entries always drop', () => {
    expect(shouldDrop(entry('/api/home', 0), ctx, now)).toBe(true)
  })

  it('weekly entries expire after 9 days at most', () => {
    expect(shouldDrop(entry('/api/franchise/draft', 10), ctx, now)).toBe(true)
    expect(shouldDrop(entry('/api/franchise/draft', 4), ctx, now)).toBe(false)
  })
})
