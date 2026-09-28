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
