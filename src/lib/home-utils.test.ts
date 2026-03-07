// src/lib/home-utils.test.ts
// Unit tests for home page utility functions.
// TDD: Written before home-utils.ts implementation (RED → GREEN).

import { describe, it, expect } from 'vitest'
import { formatGameDate, formatGameTime, hasAnyOdds } from './home-utils'

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
