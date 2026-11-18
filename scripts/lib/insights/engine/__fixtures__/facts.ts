// Fixture facts and contexts for engine unit tests (not a test file).
import type { EngineContext, Fact, FactData, InsightSeason, TeamInfo } from '../types';

export type FactOverrides = Omit<Partial<Fact>, 'data'> & { data?: Partial<FactData> };

const STREAK_DATA: FactData = {
  length: 5, start_date: '2026-02-13', end_date: '2026-02-21', hit_threshold: 30,
  thing: 'streak of 30+ points', best: 'longest streak of 30+ points', by: 'by a Clipper',
  streak_games: [
    { date: '2026-02-13', value: 33, hit: true }, { date: '2026-02-15', value: 31, hit: true },
    { date: '2026-02-17', value: 36, hit: true }, { date: '2026-02-19', value: 30, hit: true },
    { date: '2026-02-21', value: 34, hit: true },
  ],
};

export function makeFact(over: FactOverrides = {}): Fact {
  const { data, ...rest } = over;
  return {
    kind: 'streak',
    surface: 'season',
    subject: { type: 'player', id: '1', name: 'Star Clipper' },
    stat: 'scoring_30',
    value: 5,
    window: { type: 'streak', season_id: 2025 },
    context: { date: '2026-02-21' },
    polarity: 'positive',
    proof: { sql: 'SELECT $1::int AS season_id, $2::text AS player_id', params: [2025, '1'], match: { player_id: '1' } },
    asOf: '2026-02-25',
    sample: { kind: 'rate', k: 10, n: 120, pRef: 0.01, power: 5 },
    gameId: null,
    seasonId: 2025,
    ...rest,
    data: { ...(rest.kind && rest.kind !== 'streak' ? {} : STREAK_DATA), ...(data ?? {}) },
  };
}

export const LAC: TeamInfo = { teamId: '1', abbreviation: 'LAC', name: 'Clippers', fullName: 'LA Clippers', conference: 'West' };
export const GSW: TeamInfo = { teamId: '2', abbreviation: 'GSW', name: 'Warriors', fullName: 'Golden State Warriors', conference: 'West' };
export const POR: TeamInfo = { teamId: '15', abbreviation: 'POR', name: 'Trail Blazers', fullName: 'Portland Trail Blazers', conference: 'West' };

export const CURRENT_SEASON: InsightSeason = { id: 2025, label: '2025-26', isCurrent: true, phrase: 'this season', lastGameDate: '2026-02-21' };
export const COMPLETED_SEASON: InsightSeason = { ...CURRENT_SEASON, isCurrent: false, phrase: 'in 2025-26' };

export function makeCtx(over: Partial<EngineContext> = {}): EngineContext {
  return {
    asOf: '2026-02-25',
    lac: LAC,
    teams: new Map([[LAC.teamId, LAC], [GSW.teamId, GSW], [POR.teamId, POR]]),
    season: CURRENT_SEASON,
    minPlayerGames: 30,
    recordsStart: { season_id: 2020, label: '2020-21' },
    pbpRecordsStart: { season_id: 2019, label: '2019-20' },
    roster: new Map([
      ['1', { playerId: '1', name: 'Star Clipper', games: 60, mpg: 33.5 }],
      ['2', { playerId: '2', name: 'Big Clipper', games: 58, mpg: 18.2 }],
    ]),
    league: { complete: true, reason: null },
    gameId: null,
    postgameDays: 3,
    prior: new Map(),
    ...over,
  };
}
