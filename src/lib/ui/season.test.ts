import { describe, it, expect } from 'vitest'
import { playedGames, upcomingGames, seasonSummary, streaks, previousSeasonId, regularSeason, type HistoryGame } from './season'

const mk = (
  d: string,
  r: 'W' | 'L' | null,
  t?: number,
  o?: number,
  ha: 'home' | 'away' = 'home',
  status = 'final',
): HistoryGame => ({
  game_id: d,
  game_date: d,
  opponent_abbr: 'DEN',
  home_away: ha,
  result: r,
  final_score: t == null ? null : { team: t, opp: o! },
  status,
})

describe('season', () => {
  const games = [
    mk('2026-01-03', 'L', 99, 104, 'away'),
    mk('2026-01-01', 'W', 110, 100),
    mk('2026-01-05', 'W', 120, 118, 'home', 'Final/OT'),
    mk('2026-01-07', null),
  ]

  it('splits played and upcoming games, ascending', () => {
    expect(playedGames(games).map((g) => g.game_date)).toEqual(['2026-01-01', '2026-01-03', '2026-01-05'])
    expect(upcomingGames(games).map((g) => g.game_date)).toEqual(['2026-01-07'])
    expect(playedGames(games)[2].ot).toBe(true)
    expect(playedGames(games)[1].margin).toBe(-5)
  })

  it('summarizes records and average margin', () => {
    const s = seasonSummary(playedGames(games))
    expect(s).toMatchObject({ wins: 2, losses: 1, home: { w: 2, l: 0 }, away: { w: 0, l: 1 } })
    expect(s.avgMargin).toBeCloseTo((10 - 5 + 2) / 3)
    expect(seasonSummary([]).avgMargin).toBeNull()
  })

  it('computes longest and current streaks', () => {
    expect(streaks(playedGames(games))).toEqual({ longestWin: 1, longestLoss: 1, current: { kind: 'W', length: 1 } })
    expect(streaks([]).current).toBeNull()
  })

  it('finds the previous season', () => {
    expect(previousSeasonId([2024, 2025, 2026], 2026)).toBe(2025)
    expect(previousSeasonId([2026], 2026)).toBeNull()
  })
})

describe('season with game types', () => {
  const g = (d: string, r: 'W' | 'L', type: 'regular' | 'play_in' | 'playoffs', ot = 0): HistoryGame => ({
    game_id: d,
    game_date: d,
    opponent_abbr: 'GSW',
    home_away: 'home',
    result: r,
    final_score: { team: 110, opp: r === 'W' ? 100 : 120 },
    status: 'final',
    game_type: type,
    overtime_periods: ot,
  })

  it('reads overtime from overtime_periods', () => {
    expect(playedGames([g('2026-01-01', 'W', 'regular', 2)])[0].ot).toBe(true)
    expect(playedGames([g('2026-01-01', 'W', 'regular', 0)])[0].ot).toBe(false)
  })

  it('keeps regular-season games apart from play-in and playoffs', () => {
    const played = playedGames([g('2026-04-10', 'W', 'regular'), g('2026-04-15', 'L', 'play_in')])
    expect(regularSeason(played).map((x) => x.game_date)).toEqual(['2026-04-10'])
  })
})
