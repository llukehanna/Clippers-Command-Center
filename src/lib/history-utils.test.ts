import { describe, it, expect } from 'vitest'
import { computeSeasonRecord, detectOT, overtimeLabel } from './history-utils'
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

describe('overtimeLabel', () => {
  it('labels overtime periods', () => {
    expect(overtimeLabel({ overtime_periods: 0 })).toBeNull()
    expect(overtimeLabel({})).toBeNull()
    expect(overtimeLabel({ overtime_periods: 1 })).toBe('OT')
    expect(overtimeLabel({ overtime_periods: 2 })).toBe('2OT')
  })
})

describe('computeSeasonRecord postseason split', () => {
  it('counts play-in and playoffs separately from the regular season', () => {
    const g = (result: 'W' | 'L', game_type: GameItem['game_type'], home_away: 'home' | 'away' = 'home'): GameItem => ({
      game_id: '1', game_date: '2026-04-01', opponent_abbr: 'DEN', home_away, result,
      final_score: { team: 1, opp: 0 }, status: 'final', game_type,
    })
    const r = computeSeasonRecord([g('W', 'regular'), g('L', 'regular', 'away'), g('W', 'play_in'), g('L', 'playoffs')])
    expect(r).toEqual({ overall: '1-1', home: '1-0', away: '0-1', postseason: '1-1' })
  })
})

describe('detectOT (deprecated)', () => {
  it('still reads legacy status strings', () => {
    expect(detectOT('Final/OT')).toBe(true)
    expect(detectOT('final')).toBe(false)
    expect(detectOT(null)).toBe(false)
  })
})
