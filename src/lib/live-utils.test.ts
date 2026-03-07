import { describe, it, expect } from 'vitest'
import { computeFtEdge, getNextIndex } from './live-utils'

describe('computeFtEdge', () => {
  it('returns positive delta when LAC has more FT made', () => {
    expect(computeFtEdge('18-24', '12-20')).toBe(6)
  })

  it('returns negative delta when opponent has more FT made', () => {
    expect(computeFtEdge('10-15', '14-18')).toBe(-4)
  })

  it('returns 0 when FT made counts are equal', () => {
    expect(computeFtEdge('8-8', '8-10')).toBe(0)
  })

  it('returns 0 for empty strings', () => {
    expect(computeFtEdge('', '')).toBe(0)
  })

  it('returns 0 for zero case', () => {
    expect(computeFtEdge('0-0', '0-0')).toBe(0)
  })
})

describe('getNextIndex', () => {
  it('advances from 0 to 1 in array of length 3', () => {
    expect(getNextIndex(0, 3)).toBe(1)
  })

  it('advances from 1 to 2 in array of length 3', () => {
    expect(getNextIndex(1, 3)).toBe(2)
  })

  it('wraps from 2 to 0 in array of length 3', () => {
    expect(getNextIndex(2, 3)).toBe(0)
  })

  it('stays at 0 for single-item array', () => {
    expect(getNextIndex(0, 1)).toBe(0)
  })

  it('wraps last index to 0 in array of length 5', () => {
    expect(getNextIndex(4, 5)).toBe(0)
  })
})
