import { describe, it, expect } from 'vitest'
import { computeFtEdge, getNextIndex, livePollInterval, staleThresholdMs } from './live-utils'

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

describe('staleThresholdMs', () => {
  it('is 30 s at live cadence and cadence + 20 s when slower', () => {
    expect(staleThresholdMs({ next_ms: 3_000 })).toBe(30_000)
    expect(staleThresholdMs({ next_ms: 30_000 })).toBe(50_000)
  })

  it('assumes the old 12 s runner when there is no cadence', () => {
    expect(staleThresholdMs(null)).toBe(32_000)
    expect(staleThresholdMs(undefined)).toBe(32_000)
  })
})

describe('livePollInterval', () => {
  it('polls every 5 minutes with no game and every minute after the final', () => {
    expect(livePollInterval({ state: 'NO_ACTIVE_GAME' })).toBe(300_000)
    expect(livePollInterval({ state: 'LIVE', game: { status: 'final' } })).toBe(60_000)
  })

  it('follows the runner cadence, clamped to 4–30 s', () => {
    expect(livePollInterval({ state: 'LIVE', cadence: { next_ms: 3_000 } })).toBe(4_000)
    expect(livePollInterval({ state: 'LIVE', cadence: { next_ms: 8_000 } })).toBe(8_000)
    expect(livePollInterval({ state: 'DATA_DELAYED', cadence: { next_ms: 60_000 } })).toBe(30_000)
  })

  it('falls back to 12 s while loading or without a cadence', () => {
    expect(livePollInterval(undefined)).toBe(12_000)
    expect(livePollInterval({ state: 'LIVE' })).toBe(12_000)
  })
})
