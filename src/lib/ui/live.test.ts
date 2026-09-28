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
