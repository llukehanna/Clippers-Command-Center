import { describe, it, expect } from 'vitest'
import { parseTimestamp, formatDay, formatDayShort, formatDayTick, formatTip, formatDayLong } from './time'

describe('time', () => {
  it('parses Postgres-style timestamps that Safari rejects', () => {
    expect(parseTimestamp('2026-10-22 02:30:00+00')?.toISOString()).toBe('2026-10-22T02:30:00.000Z')
    expect(parseTimestamp('2026-10-22T02:30:00Z')?.toISOString()).toBe('2026-10-22T02:30:00.000Z')
    expect(parseTimestamp('2026-10-22 02:30:00+05:30')?.toISOString()).toBe('2026-10-21T21:00:00.000Z')
    expect(parseTimestamp(null)).toBeNull()
    expect(parseTimestamp('nope')).toBeNull()
  })

  it('formats game days without timezone drift', () => {
    expect(formatDay('2026-10-21', new Date('2026-11-18T20:00:00Z'))).toBe('Wed, Oct 21')
    expect(formatDayLong('2026-10-21')).toBe('Wednesday, October 21, 2026')
  })

  it('formats tip-off in Pacific time', () => {
    expect(formatTip('2026-10-22 02:30:00+00')).toBe('7:30 PM PT')
    expect(formatTip(null)).toBe('TBD')
  })
})

describe('year on dates outside the current year', () => {
  const now = new Date('2026-11-18T20:00:00Z')
  it('leaves this year bare and adds the year otherwise', () => {
    expect(formatDayShort('2026-02-08', now)).toBe('Feb 8')
    expect(formatDayShort('2023-02-08', now)).toBe('Feb 8, 2023')
    expect(formatDayShort('2027-01-04', now)).toBe('Jan 4, 2027')
    expect(formatDay('2023-02-08', now)).toBe('Wed, Feb 8, 2023')
    expect(formatDayTick('2023-02-08', now)).toBe('Feb 8 ’23')
    expect(formatDayTick('2026-02-08', now)).toBe('Feb 8')
  })
  it('uses the Pacific calendar year at New Year', () => {
    // 05:00 UTC on Jan 1 is still Dec 31 in Los Angeles.
    expect(formatDayShort('2026-12-31', new Date('2027-01-01T05:00:00Z'))).toBe('Dec 31')
  })
})
