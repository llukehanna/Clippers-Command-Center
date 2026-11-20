import { describe, it, expect } from 'vitest'
import {
  GAME_OVER_AFTER_MS,
  gameOverAt,
  gamesOverAt,
  heroCandidates,
  inClockWindow,
  liveWindow,
  pickNextGame,
  seasonRolloverAt,
  slotWindow,
} from './clock'
import { seasonStartYear } from '@/src/lib/home-utils'

const H = 3_600_000
const t = (iso: string) => Date.parse(iso)

describe('inClockWindow', () => {
  it('before mount (no clock) shows the build-time arrangement: open-start windows only', () => {
    expect(inClockWindow({ until: 10 }, null)).toBe(true)
    expect(inClockWindow({}, null)).toBe(true)
    expect(inClockWindow({ from: 5, until: 10 }, null)).toBe(false)
  })

  it('an explicit initial overrides the default', () => {
    expect(inClockWindow({ from: 5, initial: true }, null)).toBe(true)
    expect(inClockWindow({ until: 10, initial: false }, null)).toBe(false)
  })

  it('after mount the clock decides: from is inclusive, until exclusive', () => {
    expect(inClockWindow({ from: 5, until: 10 }, 4)).toBe(false)
    expect(inClockWindow({ from: 5, until: 10 }, 5)).toBe(true)
    expect(inClockWindow({ from: 5, until: 10 }, 9)).toBe(true)
    expect(inClockWindow({ from: 5, until: 10 }, 10)).toBe(false)
    expect(inClockWindow({ from: 5, initial: false }, 6)).toBe(true)
  })
})

describe('gameOverAt', () => {
  it('is four hours after the scheduled tip', () => {
    expect(GAME_OVER_AFTER_MS).toBe(4 * H)
    expect(gameOverAt({ game_date: '2026-11-20', start_time_utc: '2026-11-21T03:30:00Z' })).toBe(t('2026-11-21T07:30:00Z'))
    // Postgres-style timestamps parse too.
    expect(gameOverAt({ game_date: '2026-11-20', start_time_utc: '2026-11-21 03:30:00+00' })).toBe(t('2026-11-21T07:30:00Z'))
  })

  it('without a tip time, the morning after the game day', () => {
    expect(gameOverAt({ game_date: '2026-11-20', start_time_utc: null })).toBe(t('2026-11-21T12:00:00Z'))
  })
})

describe('gamesOverAt', () => {
  it('never decreases, so a game counts as over only once every earlier one is', () => {
    const games = [
      { game_date: '2026-11-20', start_time_utc: null }, // over 11-21 12:00Z
      { game_date: '2026-11-20', start_time_utc: '2026-11-21T03:00:00Z' }, // over 07:00Z, earlier than the TBD one
      { game_date: '2026-11-22', start_time_utc: '2026-11-23T03:00:00Z' },
    ]
    expect(gamesOverAt(games)).toEqual([t('2026-11-21T12:00:00Z'), t('2026-11-21T12:00:00Z'), t('2026-11-23T07:00:00Z')])
  })
})

describe('slotWindow', () => {
  const ends = [100, 200, 300, 400, 500, 600, 700]
  const visibleAt = (now: number | null, offset: number, size: number) =>
    ends.map((_, i) => i).filter((i) => i >= offset && inClockWindow(slotWindow(ends, i, offset, size), now))

  it('hero (offset 0, one slot): the first game not yet over', () => {
    expect(visibleAt(null, 0, 1)).toEqual([0])
    expect(visibleAt(50, 0, 1)).toEqual([0])
    expect(visibleAt(100, 0, 1)).toEqual([1])
    expect(visibleAt(250, 0, 1)).toEqual([2])
    expect(visibleAt(10_000, 0, 1)).toEqual([])
  })

  it('a list after the hero (offset 1, unbounded): every later game', () => {
    expect(visibleAt(null, 1, Infinity)).toEqual([1, 2, 3, 4, 5, 6])
    expect(visibleAt(150, 1, Infinity)).toEqual([2, 3, 4, 5, 6])
    expect(visibleAt(650, 1, Infinity)).toEqual([])
  })

  it('a capped list after the hero (offset 1, four slots) slides along', () => {
    expect(visibleAt(null, 1, 4)).toEqual([1, 2, 3, 4])
    expect(visibleAt(99, 1, 4)).toEqual([1, 2, 3, 4])
    expect(visibleAt(100, 1, 4)).toEqual([2, 3, 4, 5])
    expect(visibleAt(200, 1, 4)).toEqual([3, 4, 5, 6])
  })

  it('rejects an index before the offset', () => {
    expect(() => slotWindow(ends, 0, 1, 4)).toThrow(RangeError)
  })
})

describe('heroCandidates / pickNextGame', () => {
  const g = (id: number, tip: string) => ({ game_id: id, game_date: tip.slice(0, 10), start_time_utc: tip })
  const pre = { ...g(1, '2026-10-10T02:00:00Z'), is_preseason: true }
  const r1 = g(2, '2026-10-22T02:30:00Z')
  const r2 = g(3, '2026-10-24T02:30:00Z')

  it('is the next game, then the schedule without it', () => {
    expect(heroCandidates(r1, [r1, r2]).map((x) => x.game_id)).toEqual([2, 3])
    expect(heroCandidates(pre, [r1, r2]).map((x) => x.game_id)).toEqual([1, 2, 3])
    expect(heroCandidates(null, [r1, r2]).map((x) => x.game_id)).toEqual([2, 3])
    // ids may arrive as strings
    const loose: Array<{ game_id: number | string }> = [r1, r2]
    expect(heroCandidates({ game_id: '2' }, loose).map((x) => x.game_id)).toEqual(['2', 3])
  })

  it('picks the first game not yet over; the first before mount', () => {
    const list = [pre, r1, r2]
    expect(pickNextGame(list, null)?.game_id).toBe(1)
    expect(pickNextGame(list, t('2026-10-10T05:59:59Z'))?.game_id).toBe(1)
    expect(pickNextGame(list, t('2026-10-10T06:00:00Z'))?.game_id).toBe(2)
    expect(pickNextGame(list, t('2026-10-30T00:00:00Z'))).toBeNull()
    expect(pickNextGame([], null)).toBeNull()
  })
})

describe('liveWindow', () => {
  const game = { game_date: '2026-11-20', start_time_utc: '2026-11-21T03:30:00Z' }

  it('runs from tip to the game surely ending; first paint follows the build-time status', () => {
    expect(liveWindow(game, 'scheduled')).toEqual({ from: t('2026-11-21T03:30:00Z'), until: t('2026-11-21T07:30:00Z'), initial: false })
    expect(liveWindow(game, 'in_progress')?.initial).toBe(true)
  })

  it('without a tip time, only a game the build saw in progress', () => {
    const tbd = { game_date: '2026-11-20', start_time_utc: null }
    expect(liveWindow(tbd, 'scheduled')).toBeNull()
    expect(liveWindow(tbd, 'in_progress')).toEqual({ until: t('2026-11-21T12:00:00Z'), initial: true })
  })
})

describe('seasonRolloverAt', () => {
  it('is the July 1 (UTC) that ends the season, matching seasonStartYear', () => {
    expect(seasonRolloverAt(2025)).toBe(t('2026-07-01T00:00:00Z'))
    expect(seasonStartYear(new Date(seasonRolloverAt(2025) - 1))).toBe(2025)
    expect(seasonStartYear(new Date(seasonRolloverAt(2025)))).toBe(2026)
  })
})
