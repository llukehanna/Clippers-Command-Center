import { describe, it, expect } from 'vitest'
import { computeSeasonRecord, detectOT } from './history-utils'
import type { GameItem } from './history-utils'

describe('computeSeasonRecord', () => {
  it('returns "0-0" for all records when given an empty array', () => {
    const result = computeSeasonRecord([])
    expect(result.overall).toBe('0-0')
    expect(result.home).toBe('0-0')
    expect(result.away).toBe('0-0')
  })

  it('computes W-L records correctly for mixed home/away results', () => {
    const games: GameItem[] = [
      {
        game_id: '1',
        game_date: '2024-01-01',
        opponent_abbr: 'LAL',
        home_away: 'home',
        result: 'W',
        final_score: { team: 110, opp: 100 },
        status: 'final',
      },
      {
        game_id: '2',
        game_date: '2024-01-02',
        opponent_abbr: 'DEN',
        home_away: 'away',
        result: 'L',
        final_score: { team: 90, opp: 105 },
        status: 'final',
      },
    ]
    const result = computeSeasonRecord(games)
    expect(result.overall).toBe('1-1')
    expect(result.home).toBe('1-0')
    expect(result.away).toBe('0-1')
  })

  it('ignores games where result is null (not yet final)', () => {
    const games: GameItem[] = [
      {
        game_id: '1',
        game_date: '2024-01-01',
        opponent_abbr: 'LAL',
        home_away: 'home',
        result: 'W',
        final_score: { team: 110, opp: 100 },
        status: 'final',
      },
      {
        game_id: '2',
        game_date: '2024-01-05',
        opponent_abbr: 'GSW',
        home_away: 'away',
        result: null,
        final_score: null,
        status: 'Scheduled',
      },
    ]
    const result = computeSeasonRecord(games)
    expect(result.overall).toBe('1-0')
    expect(result.home).toBe('1-0')
    expect(result.away).toBe('0-0')
  })
})

describe('detectOT', () => {
  it('returns true for "Final/OT"', () => {
    expect(detectOT('Final/OT')).toBe(true)
  })

  it('returns false for "Final"', () => {
    expect(detectOT('Final')).toBe(false)
  })

  it('returns false for null', () => {
    expect(detectOT(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(detectOT(undefined)).toBe(false)
  })
})
