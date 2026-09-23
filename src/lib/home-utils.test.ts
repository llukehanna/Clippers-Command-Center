// src/lib/home-utils.test.ts
// Unit tests for home page utility functions.
// TDD: Written before home-utils.ts implementation (RED → GREEN).

import { describe, it, expect } from 'vitest'
import {
  formatGameDate,
  formatGameTime,
  hasAnyOdds,
  seasonStartYear,
  formatSeasonLabel,
} from './home-utils'

describe('formatGameDate', () => {
  it('formats a Saturday date correctly', () => {
    // 2026-03-14 is a Saturday
    expect(formatGameDate('2026-03-14')).toBe('Sat, Mar 14')
  })

  it('formats a Tuesday date with single-digit day correctly', () => {
    // 2026-12-01 is a Tuesday
    expect(formatGameDate('2026-12-01')).toBe('Tue, Dec 1')
  })
})

describe('formatGameTime', () => {
  it('returns TBD when utcStr is null', () => {
    expect(formatGameTime(null)).toBe('TBD')
  })

  it('returns a locale time string with timezone for a valid UTC string', () => {
    const result = formatGameTime('2026-03-14T23:30:00Z')
    // Should be a non-empty string, contain AM/PM, and contain a timezone abbreviation
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
    // Should not be TBD
    expect(result).not.toBe('TBD')
    // Should contain a time portion
    expect(result).toMatch(/\d+:\d{2}/)
  })

  it('formats in Pacific time (PDT during daylight saving)', () => {
    // 2026-03-14 is after the Mar 8 DST switch: 23:30Z → 4:30 PM PDT
    expect(formatGameTime('2026-03-14T23:30:00Z').replace(/\s/g, ' ')).toBe('4:30 PM PDT')
  })

  it('formats in Pacific time (PST in winter)', () => {
    // 2026-12-01T03:30Z → Nov 30, 7:30 PM PST
    expect(formatGameTime('2026-12-01T03:30:00Z').replace(/\s/g, ' ')).toBe('7:30 PM PST')
  })

  it('returns LA time regardless of process TZ', () => {
    const original = process.env.TZ
    try {
      for (const tz of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
        process.env.TZ = tz
        expect(formatGameTime('2026-03-14T23:30:00Z').replace(/\s/g, ' ')).toBe('4:30 PM PDT')
      }
    } finally {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    }
  })
})

describe('hasAnyOdds', () => {
  it('returns false for empty array', () => {
    expect(hasAnyOdds([])).toBe(false)
  })

  it('returns false when all games have null odds', () => {
    expect(hasAnyOdds([{ odds: null }])).toBe(false)
  })

  it('returns true when at least one game has non-null odds (mixed null)', () => {
    expect(
      hasAnyOdds([
        { odds: null },
        { odds: { spread: '+2.5', moneyline: null, over_under: null } },
      ])
    ).toBe(true)
  })

  it('returns true when game has full odds object', () => {
    expect(
      hasAnyOdds([
        { odds: { spread: '+2.5', moneyline: '-110', over_under: '220' } },
      ])
    ).toBe(true)
  })
})

describe('seasonStartYear', () => {
  it('uses the previous year before July', () => {
    expect(seasonStartYear(new Date('2026-03-14T12:00:00Z'))).toBe(2025)
    expect(seasonStartYear(new Date('2026-06-30T12:00:00Z'))).toBe(2025)
  })

  it('uses the current year from July onward', () => {
    expect(seasonStartYear(new Date('2026-07-01T12:00:00Z'))).toBe(2026)
    expect(seasonStartYear(new Date('2026-09-23T12:00:00Z'))).toBe(2026)
  })
})

describe('formatSeasonLabel', () => {
  it('formats start year as YYYY-YY', () => {
    expect(formatSeasonLabel(2025)).toBe('2025-26')
  })

  it('zero-pads the century rollover', () => {
    expect(formatSeasonLabel(2099)).toBe('2099-00')
    expect(formatSeasonLabel(2008)).toBe('2008-09')
  })
})
