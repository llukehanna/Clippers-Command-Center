import { describe, it, expect } from 'vitest'
import { getNextIndex } from './live-utils'

// Tests the pure getNextIndex helper that powers useInsightRotation hook.
// No React, no jsdom, no timers needed — pure function only.
describe('getNextIndex (rotation logic)', () => {
  it('advances index from 0 to 1', () => {
    expect(getNextIndex(0, 3)).toBe(1)
  })

  it('advances index from 1 to 2', () => {
    expect(getNextIndex(1, 3)).toBe(2)
  })

  it('wraps from last index back to 0', () => {
    expect(getNextIndex(2, 3)).toBe(0)
  })

  it('returns 0 for single-item array (no rotation)', () => {
    expect(getNextIndex(0, 1)).toBe(0)
  })

  it('wraps index 4 to 0 in length-5 array', () => {
    expect(getNextIndex(4, 5)).toBe(0)
  })
})
