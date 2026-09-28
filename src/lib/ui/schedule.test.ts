import { describe, it, expect } from 'vitest'
import { annotateSchedule, groupByMonth, daysBetween } from './schedule'

const g = (d: string, h: 'home' | 'away') => ({ game_date: d, home_away: h })

describe('schedule', () => {
  it('counts calendar days across month boundaries', () => {
    expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1)
  })

  it('flags back-to-backs and rest days', () => {
    const out = annotateSchedule(
      [g('2026-10-21', 'home'), g('2026-10-22', 'away'), g('2026-10-25', 'away')],
      '2026-10-19',
    )
    expect(out[0].annotation.restDays).toBe(1)
    expect(out[0].annotation.b2b).toBe(false)
    expect(out[1].annotation.b2b).toBe(true)
    expect(out[2].annotation.restDays).toBe(2)
  })

  it('has no rest info for the first game without a previous date', () => {
    const out = annotateSchedule([g('2026-10-21', 'home')])
    expect(out[0].annotation).toEqual({ b2b: false, restDays: null, stand: null })
  })

  it('detects home stands and road trips of 3+ games', () => {
    const out = annotateSchedule([
      g('2026-11-01', 'home'),
      g('2026-11-03', 'home'),
      g('2026-11-05', 'home'),
      g('2026-11-07', 'away'),
    ])
    expect(out[1].annotation.stand).toEqual({ kind: 'home', index: 2, length: 3 })
    expect(out[3].annotation.stand).toBeNull()
  })

  it('groups games by month in order', () => {
    const groups = groupByMonth([g('2026-10-30', 'home'), g('2026-11-02', 'away')])
    expect(groups.map((x) => x.label)).toEqual(['October 2026', 'November 2026'])
    expect(groups[1].games).toHaveLength(1)
  })
})
