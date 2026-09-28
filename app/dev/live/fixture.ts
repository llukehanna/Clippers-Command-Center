// A LIVE /api/live payload (exact route shape) for designing and checking the
// Live view without a real game. Sample numbers, not a real game.

import type { BoxScorePlayer, LivePayload } from '@/src/lib/ui/types'

function p(
  player_id: string,
  name: string,
  starter: boolean,
  MIN: string,
  PTS: number,
  REB: number,
  AST: number,
  STL: number,
  BLK: number,
  TO: number,
  FG: string,
  TPT: string,
  FT: string,
  PM: number,
): BoxScorePlayer {
  return { player_id, name, starter, MIN, PTS, REB, AST, STL, BLK, TO, FG, '3PT': TPT, FT, '+/-': PM }
}

export function liveFixture(now = new Date()): LivePayload {
  const iso = now.toISOString()
  return {
    meta: { generated_at: iso, source: 'mixed', stale: false, stale_reason: null, ttl_seconds: 5 },
    state: 'LIVE',
    game: {
      game_id: '9001',
      nba_game_id: '0022600123',
      season_id: 2026,
      game_date: iso.slice(0, 10),
      start_time_utc: iso,
      status: 'in_progress',
      period: 3,
      clock: 'PT07M42.00S',
      home: { team_id: '13', abbreviation: 'LAC', name: 'Clippers', score: 84, is_home: true },
      away: { team_id: '8', abbreviation: 'DEN', name: 'Nuggets', score: 78, is_home: false },
    },
    key_metrics: [
      { key: 'efg_pct', label: 'eFG%', value: 0.568, team: 'LAC', delta_vs_opp: 0.047 },
      { key: 'tov_margin', label: 'TO Margin', value: -4, team: 'LAC', delta_vs_opp: -4 },
      { key: 'reb_margin', label: 'Reb Margin', value: -3, team: 'LAC', delta_vs_opp: -3 },
      { key: 'pace', label: 'Pace', value: 99.4, team: 'GAME', delta_vs_opp: null },
    ],
    box_score: {
      columns: ['MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', 'FG', '3PT', 'FT', '+/-'],
      teams: [
        {
          team_abbr: 'LAC',
          players: [
            p('202695', 'Kawhi Leonard', true, '27:14', 26, 6, 3, 2, 1, 1, '10-17', '3-6', '3-3', 9),
            p('1629636', 'Darius Garland', true, '25:40', 17, 2, 8, 1, 0, 2, '6-13', '2-5', '3-4', 6),
            p('1628381', 'John Collins', true, '22:03', 12, 9, 1, 0, 1, 1, '5-8', '0-1', '2-2', 4),
            p('201572', 'Brook Lopez', true, '20:51', 10, 5, 1, 0, 3, 0, '4-7', '2-4', '0-0', 7),
            p('1627739', 'Kris Dunn', true, '19:12', 5, 3, 2, 3, 0, 1, '2-4', '1-2', '0-0', 2),
            p('203992', 'Bogdan Bogdanovic', false, '14:30', 8, 1, 2, 0, 0, 1, '3-7', '2-5', '0-0', -3),
            p('1627884', 'Derrick Jones Jr.', false, '12:18', 4, 3, 0, 1, 1, 0, '2-3', '0-0', '0-0', -1),
            p('201587', 'Nicolas Batum', false, '8:12', 2, 2, 1, 0, 0, 0, '1-2', '0-1', '0-0', 0),
          ],
          totals: { PTS: 84, REB: 31, AST: 18, TO: 9, FG: '33-61', '3PT': '10-24', FT: '8-9' },
        },
        {
          team_abbr: 'DEN',
          players: [
            p('203999', 'Nikola Jokic', true, '26:02', 24, 11, 9, 1, 1, 4, '9-15', '1-3', '5-6', -4),
            p('1627750', 'Jamal Murray', true, '25:11', 16, 3, 4, 0, 0, 3, '6-15', '2-7', '2-2', -7),
            p('203932', 'Aaron Gordon', true, '22:40', 12, 6, 2, 1, 0, 1, '5-9', '1-2', '1-2', -2),
            p('1631128', 'Christian Braun', true, '21:05', 9, 4, 1, 1, 0, 2, '4-8', '1-3', '0-0', -5),
            p('1630578', 'Peyton Watson', true, '18:44', 7, 5, 0, 0, 2, 1, '3-6', '1-2', '0-1', -3),
            p('1631124', 'Julian Strawther', false, '13:20', 6, 2, 1, 0, 0, 1, '2-6', '2-5', '0-0', 1),
            p('1629667', 'Jalen Pickett', false, '9:58', 4, 1, 2, 1, 0, 1, '2-3', '0-1', '0-0', -2),
          ],
          totals: { PTS: 78, REB: 34, AST: 19, TO: 13, FG: '31-64', '3PT': '8-23', FT: '8-11' },
        },
      ],
    },
    insights: [
      {
        insight_id: 'live-9001-0',
        category: 'run',
        headline: '9–0 Clippers run, their longest of the game',
        detail: 'Leonard scored 5 of the 9 during the stretch.',
        importance: 85,
        proof: { summary: 'run', result: { team_id: '13', points: 9, event_time_seconds: 1818 } },
      },
      {
        insight_id: 'live-9001-1',
        category: 'clutch',
        headline: 'One-possession game midway through the third',
        detail: null,
        importance: 70,
        proof: { summary: 'clutch', result: { period: 3, clock: '9:58', home_score: 75, away_score: 74, margin: 1 } },
      },
    ],
    other_games: [],
    odds: {
      provider: 'odds_api',
      captured_at: new Date(now.getTime() - 4 * 60_000).toISOString(),
      spread_home: -3.5,
      spread_away: 3.5,
      moneyline_home: -158,
      moneyline_away: 132,
      total_points: 231.5,
    },
  }
}
