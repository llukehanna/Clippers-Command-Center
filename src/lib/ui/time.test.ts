import { describe, it, expect } from 'vitest'
import { parseTimestamp, formatDay, formatTip, formatDayLong } from './time'

describe('time', () => {
  it('parses Postgres-style timestamps that Safari rejects', () => {
    expect(parseTimestamp('2026-10-22 02:30:00+00')?.toISOString()).toBe('2026-10-22T02:30:00.000Z')
    expect(parseTimestamp('2026-10-22T02:30:00Z')?.toISOString()).toBe('2026-10-22T02:30:00.000Z')
    expect(parseTimestamp('2026-10-22 02:30:00+05:30')?.toISOString()).toBe('2026-10-21T21:00:00.000Z')
    expect(parseTimestamp(null)).toBeNull()
    expect(parseTimestamp('nope')).toBeNull()
  })

  it('formats game days without timezone drift', () => {
    expect(formatDay('2026-10-21')).toBe('Wed, Oct 21')
    expect(formatDayLong('2026-10-21')).toBe('Wednesday, October 21, 2026')
  })

  it('formats tip-off in Pacific time', () => {
    expect(formatTip('2026-10-22 02:30:00+00')).toBe('7:30 PM PT')
    expect(formatTip(null)).toBe('TBD')
  })
})
