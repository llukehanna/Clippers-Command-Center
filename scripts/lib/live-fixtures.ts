// scripts/lib/live-fixtures.ts
// DB-free fixtures for live runner tests. Opening night 2026-27: SAC @ LAC.

import type {
  BoxscoreGame,
  BoxscoreTeam,
  NBAScoreboardResponse,
  PlayByPlayAction,
  ScoreboardGame,
  ScoreboardTeam,
  TeamStatistics,
} from '../../src/lib/types/live';
import type { LiveStateDoc } from '../../src/lib/types/live-state';

export const LAC_ID = 1610612746;
export const SAC_ID = 1610612758;
export const GAME_ID = '0022600093';
const T0 = Date.UTC(2026, 9, 22, 2, 40, 0);

export function action(n: number, over: Partial<PlayByPlayAction> = {}): PlayByPlayAction {
  return {
    actionNumber: n,
    clock: 'PT10M00.00S',
    period: 1,
    teamId: LAC_ID,
    teamTricode: 'LAC',
    actionType: '2pt',
    subType: 'jumpshot',
    qualifiers: [],
    personId: 201,
    description: `Play ${n}`,
    scoreHome: '2',
    scoreAway: '0',
    pointsTotal: 2,
    timeActual: new Date(T0 + n * 10_000).toISOString(),
    ...over,
  };
}

const ZERO: TeamStatistics = {
  assists: 0, blocks: 0, fieldGoalsAttempted: 0, fieldGoalsMade: 0, fieldGoalsPercentage: 0,
  foulsPersonal: 0, freeThrowsAttempted: 0, freeThrowsMade: 0, freeThrowsPercentage: 0, points: 0,
  reboundsDefensive: 0, reboundsOffensive: 0, reboundsTotal: 0, steals: 0, threePointersAttempted: 0,
  threePointersMade: 0, threePointersPercentage: 0, turnovers: 0,
};

function boxTeam(teamId: number, tricode: string, score: number, periods: number[]): BoxscoreTeam {
  return {
    teamId, teamName: tricode, teamCity: tricode, teamTricode: tricode, score,
    periods: periods.map((s, i) => ({ period: i + 1, periodType: 'REGULAR', score: s })),
    statistics: { ...ZERO, points: score },
    players: [],
  };
}

export function box(o: {
  status?: number; period?: number; clock?: string; home?: number; away?: number;
  homePeriods?: number[]; awayPeriods?: number[];
} = {}): BoxscoreGame {
  const home = o.home ?? 2;
  const away = o.away ?? 0;
  return {
    gameId: GAME_ID,
    gameStatus: o.status ?? 2,
    gameStatusText: o.status === 3 ? 'Final' : 'Q1 10:00',
    period: o.period ?? 1,
    gameClock: o.clock ?? 'PT10M00.00S',
    gameTimeUTC: '2026-10-22T02:30:00Z',
    regulationPeriods: 4,
    homeTeam: boxTeam(LAC_ID, 'LAC', home, o.homePeriods ?? [home]),
    awayTeam: boxTeam(SAC_ID, 'SAC', away, o.awayPeriods ?? [away]),
  };
}

function sbTeam(teamId: number, tricode: string, score: number): ScoreboardTeam {
  return { teamId, teamName: tricode, teamCity: tricode, teamTricode: tricode, wins: 0, losses: 0, score, periods: [], timeoutsRemaining: 7, inBonus: '0' };
}

export function sbGame(o: { status?: number; period?: number; clock?: string; home?: number; away?: number; gameId?: string } = {}): ScoreboardGame {
  return {
    gameId: o.gameId ?? GAME_ID,
    gameCode: '20261021/SACLAC',
    gameStatus: o.status ?? 2,
    gameStatusText: o.status === 1 ? '7:30 pm ET' : 'Q1',
    period: o.period ?? 1,
    gameClock: o.clock ?? 'PT10M00.00S',
    gameTimeUTC: '2026-10-22T02:30:00Z',
    homeTeam: sbTeam(LAC_ID, 'LAC', o.home ?? 0),
    awayTeam: sbTeam(SAC_ID, 'SAC', o.away ?? 0),
  };
}

export function scoreboard(...games: ScoreboardGame[]): NBAScoreboardResponse {
  return {
    meta: { version: 1, code: 200, request: 'scoreboard', time: '' },
    scoreboard: { gameDate: '2026-10-21', leagueId: '00', leagueName: 'NBA', games },
  };
}

export function liveDoc(seq: number, over: Partial<LiveStateDoc> = {}): LiveStateDoc {
  return {
    v: 1, seq, source: 'nba', nba_game_id: GAME_ID, status: 'in_progress', status_text: 'Q1 10:00',
    period: 1, clock: '10:00', home_score: 2, away_score: 0, periods: [{ period: 1, home: 2, away: 0 }],
    home_box: null, away_box: null, recent_scoring: [], last_plays: [], other_games: [],
    observed_at: '2026-10-22T02:40:10.000Z', fetched_at: '2026-10-22T02:40:12.000Z',
    cadence: { phase: 'LIVE', next_ms: 3000 }, is_stale: false, stale_reason: null,
    ...over,
  };
}
