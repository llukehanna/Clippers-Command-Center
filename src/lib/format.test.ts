import { describe, it, expect } from 'vitest'
import { formatClock } from './format'

describe('formatClock', () => {
  it('converts PT05M30.00S to 5:30', () => {
    expect(formatClock('PT05M30.00S')).toBe('5:30')
  })

  it('converts PT12M03.00S to 12:03', () => {
    expect(formatClock('PT12M03.00S')).toBe('12:03')
  })

  it('converts PT00M45.00S to 0:45', () => {
    expect(formatClock('PT00M45.00S')).toBe('0:45')
  })

  it('converts PT10M00.00S to 10:00', () => {
    expect(formatClock('PT10M00.00S')).toBe('10:00')
  })

  it('passes through already MM:SS format', () => {
    expect(formatClock('2:30')).toBe('2:30')
  })

  it('returns empty string for empty input', () => {
    expect(formatClock('')).toBe('')
  })

  it('returns garbage input unchanged', () => {
    expect(formatClock('garbage')).toBe('garbage')
  })
})
