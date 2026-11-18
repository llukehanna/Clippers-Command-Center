import { describe, it, expect } from 'vitest'
import { periodLabel, clockLabel, liveTabTitle, countdownParts } from './live'

describe('live', () => {
  it('labels periods', () => {
    expect(periodLabel(0)).toBe('Pregame')
    expect(periodLabel(null)).toBe('Pregame')
    expect(periodLabel(3)).toBe('Q3')
    expect(periodLabel(5)).toBe('OT')
    expect(periodLabel(7)).toBe('3OT')
  })

  it('labels clocks from ISO or plain strings', () => {
    expect(clockLabel('PT07M42.00S')).toBe('7:42')
    expect(clockLabel('7:42')).toBe('7:42')
    expect(clockLabel(null)).toBe('')
  })

  it('builds LAC-first tab titles', () => {
    expect(
      liveTabTitle({
        period: 3,
        clock: 'PT07M42.00S',
        home: { abbreviation: 'DEN', score: 78 },
        away: { abbreviation: 'LAC', score: 84 },
      }),
    ).toBe('LAC 84–78 DEN · Q3 7:42')
  })

  it('counts down to tip-off and stops once it passes', () => {
    expect(countdownParts('2026-10-22T02:30:00Z', new Date('2026-10-20T01:00:00Z'))).toEqual({
      days: 2,
      hours: 1,
      minutes: 30,
    })
    expect(countdownParts('2026-10-22T02:30:00Z', new Date('2026-10-23T00:00:00Z'))).toBeNull()
  })
})

import { resolveLiveState } from './live'

describe('resolveLiveState', () => {
  const base = { meta: { generated_at: '2026-01-01T12:00:00Z' }, game: { game_id: '1' } }
  it('passes LIVE through when a game is present', () => {
    expect(resolveLiveState({ ...base, state: 'LIVE' })).toBe('LIVE')
  })
  it('treats missing data or no game as idle', () => {
    expect(resolveLiveState(undefined)).toBe('NO_ACTIVE_GAME')
    expect(resolveLiveState({ ...base, state: 'LIVE', game: null })).toBe('NO_ACTIVE_GAME')
  })
  it('treats a delayed snapshot older than 6h as idle', () => {
    expect(resolveLiveState({ ...base, state: 'DATA_DELAYED', snapshot_captured_at: '2026-01-01T11:00:00Z' })).toBe('DATA_DELAYED')
    expect(resolveLiveState({ ...base, state: 'DATA_DELAYED', snapshot_captured_at: '2026-01-01T02:00:00Z' })).toBe('NO_ACTIVE_GAME')
  })
})

import { breakLabel, gameMomentLabel } from './live'

describe('period breaks', () => {
  it('names the break when a period ends', () => {
    expect(breakLabel(2, '0:00')).toBe('Halftime')
    expect(breakLabel(1, 'PT00M00.00S')).toBe('End of Q1')
    expect(breakLabel(3, '0:00')).toBe('End of Q3')
    expect(breakLabel(4, '0:00')).toBe('End of Q4')
    expect(breakLabel(5, '0:00')).toBe('End of OT')
  })

  it('shows the clock while it runs, and nothing before tip', () => {
    expect(breakLabel(2, '0:01')).toBeNull()
    expect(breakLabel(2, 'PT00M00.40S')).toBeNull() // 0.4 s left, though it displays as 0:00
    expect(breakLabel(2, '0.0')).toBe('Halftime')
    expect(breakLabel(0, '0:00')).toBeNull()
    expect(breakLabel(2, '')).toBeNull()
    expect(gameMomentLabel(3, 'PT07M42.00S')).toBe('Q3 7:42')
    expect(gameMomentLabel(2, '0:00')).toBe('Halftime')
  })

  it('puts the break in the tab title', () => {
    expect(
      liveTabTitle({ period: 2, clock: '0:00', home: { abbreviation: 'LAC', score: 62 }, away: { abbreviation: 'UTA', score: 58 } }),
    ).toBe('LAC 62–58 UTA · Halftime')
  })
})

import { gameIsOn } from './live'

describe('after the final', () => {
  const game = (status: string) => ({ status, period: 4, clock: '0:00', home: { abbreviation: 'LAC', score: 107 }, away: { abbreviation: 'UTA', score: 132 } })

  it('titles the tab "Final", not "End of Q4"', () => {
    expect(liveTabTitle(game('final'))).toBe('LAC 107–132 UTA · Final')
    expect(liveTabTitle(game('in_progress'))).toBe('LAC 107–132 UTA · End of Q4')
  })

  it('stops calling the game on once it is final', () => {
    const at = '2026-11-18T05:49:00Z'
    const payload = (status: string) => ({ state: 'LIVE', game: { status }, snapshot_captured_at: at, meta: { generated_at: at } })
    expect(gameIsOn(payload('in_progress'))).toBe(true)
    expect(gameIsOn(payload('final'))).toBe(false)
    expect(gameIsOn({ state: 'NO_ACTIVE_GAME', game: null })).toBe(false)
  })
})
