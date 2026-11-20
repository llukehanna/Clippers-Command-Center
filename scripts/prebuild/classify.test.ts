import { describe, expect, it } from 'vitest'
import type { CachedPayload } from '@/src/lib/prebuild/payload-cache'
import { classify, dropReason, personKeysInMoves, rosterIdsFrom, shouldDrop, ttlDays, type ClassifyContext } from './classify'

const ctx: ClassifyContext = {
  currentSeasonId: 2025,
  recentGameIds: new Set(['100']),
  rosterIds: new Set(['7']),
  currentSeasonPersonKeys: new Set(['paulch01', 'nba:1641715']),
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
  ['/api/franchise/moves?season=2020&player_id=5', 'weekly'],
  ['/api/franchise/moves?player_id=5', 'weekly'],
  ['/api/franchise/moves?player_id=7', 'volatile'],
  ['/api/franchise/moves?season=2020&player_id=7', 'volatile'],
  ['/api/franchise/moves?player=blake-griffin', 'weekly'],
  ['/api/franchise/moves?type=all&player=griffbl01', 'weekly'],
  ['/api/franchise/moves?type=all&player=paulch01', 'volatile'],
  ['/api/franchise/moves?type=all&player=nba%3A1641715', 'volatile'],
  ['/api/franchise/moves?type=all&player=nba%3A1', 'weekly'],
  ['/api/franchise/moves', 'volatile'],
  ['/api/franchise/trades/some-trade', 'weekly'],
  ['/api/franchise/draft', 'weekly'],
  ['/api/franchise/honors', 'weekly'],
  ['/api/franchise/front-office', 'weekly'],
  ['/api/franchise/people', 'volatile'],
  ['/api/history/seasons', 'volatile'],
  ['/api/schedule/100', 'volatile'],
  ['/api/schedule/200', 'settled'],
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

describe('personKeysInMoves', () => {
  it('collects every person key in the moves of a season=latest payload', () => {
    const body = {
      filters: { season: 2026 },
      moves: [
        { people: [{ person_key: 'paulch01' }, { person_key: 'nba:1641715' }] },
        { people: [{ person_key: 'paulch01' }] },
        { people: [] },
      ],
    }
    expect(personKeysInMoves(200, body)).toEqual(new Set(['paulch01', 'nba:1641715']))
  })
  it('throws on a failed load or a payload without moves', () => {
    expect(() => personKeysInMoves(500, {})).toThrow('500')
    expect(() => personKeysInMoves(200, { moves: null })).toThrow('moves')
    expect(() => personKeysInMoves(200, { moves: [{ people: null }] })).toThrow('people')
  })
})

describe('dropReason', () => {
  const now = new Date('2026-11-19T12:00:00Z')
  const entry = (path: unknown, fetchedAt = now.toISOString()) => ({ path, status: 200, body: {}, fetchedAt }) as CachedPayload

  it('reports why an entry drops, or null when it is kept', () => {
    expect(dropReason(entry('/api/home'), ctx, now)).toBe('volatile')
    expect(dropReason(entry('/api/franchise/draft', '2026-10-01T00:00:00Z'), ctx, now)).toBe('expired')
    expect(dropReason(entry('/api/franchise/draft'), ctx, now)).toBeNull()
  })

  it.each([
    ['404 settled, 2 days old', 404, 2 * 24, 'expired'],
    ['404 settled, 1 hour old', 404, 1, null],
    ['200 settled, 30 days old', 200, 30 * 24, null],
  ] as const)('a non-2xx entry lives a day at most: %s', (_name, status, hoursAgo, expected) => {
    const fetchedAt = new Date(now.getTime() - hoursAgo * 3_600_000).toISOString()
    const e = { path: '/api/history/games/200', status, body: {}, fetchedAt } as CachedPayload
    expect(dropReason(e, ctx, now)).toBe(expected)
  })

  it('drops an entry whose path makes classify throw instead of aborting the sweep', () => {
    expect(() => classify('/api/history/games/%E0%A4%A', ctx)).toThrow()
    expect(dropReason(entry('/api/history/games/%E0%A4%A'), ctx, now)).toBe('invalid')
    expect(shouldDrop(entry('/api/players/%ZZ/career'), ctx, now)).toBe(true)
  })

  it('drops an entry without a usable path or date', () => {
    expect(dropReason(entry(undefined), ctx, now)).toBe('invalid')
    expect(dropReason(entry(42), ctx, now)).toBe('invalid')
    expect(dropReason(entry('/api/franchise/draft', 'not a date'), ctx, now)).toBe('expired')
  })
})

describe('rosterIdsFrom', () => {
  it('collects player ids from a roster load', () => {
    expect(rosterIdsFrom(200, { players: [{ player_id: 7 }, { player_id: '9' }] })).toEqual(new Set(['7', '9']))
  })
  it('treats an empty roster, a failed load, or a bad shape as a failed context', () => {
    expect(() => rosterIdsFrom(200, { players: [] })).toThrow('empty')
    expect(() => rosterIdsFrom(503, {})).toThrow('503')
    expect(() => rosterIdsFrom(200, {})).toThrow('players')
  })
})
