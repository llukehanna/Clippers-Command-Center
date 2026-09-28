// scripts/lib/record-book/highs.ts
// Top-N single-game values per scope, rebuilt nightly into rb_game_highs.
// Regular season only. Query params: $1 = LAC team_id, $2 = first season of
// the "relevant players" window (players with a recent Clippers game).
import { REGULAR_SEASON } from '../sql-fragments.js';

export type HighScope = 'lac_team' | 'lac_player' | 'player_career' | 'player_season' | 'league_season';

export interface HighSpec {
  scope: HighScope;
  statKey: string;
  /** SELECT of (scope_id text, value numeric, game_id, game_date, player_id, team_id). */
  source: string;
  order: 'desc' | 'asc';
  limit: number;
}

/** Players with a regular-season Clippers game since season $2. */
export const RELEVANT_PLAYERS = `(
  SELECT DISTINCT rp.player_id
  FROM game_player_box_scores rp
  JOIN games rg ON rg.game_id = rp.game_id
  WHERE rp.team_id = $1::bigint AND rg.season_id >= $2::int
    AND NOT rg.is_playoffs AND rg.nba_game_id NOT BETWEEN 50000000 AND 59999999
)`;

const PLAYER_STATS: [string, string][] = [
  ['pts', 'points'], ['reb', 'rebounds'], ['ast', 'assists'], ['fg3m', 'fg3_made'], ['stl', 'steals'], ['blk', 'blocks'],
];

function playerGames(column: string, where: string, scopeId: string): string {
  return `
    SELECT ${scopeId} AS scope_id, pb.${column}::numeric AS value, pb.game_id, g.game_date, pb.player_id, pb.team_id
    FROM game_player_box_scores pb
    JOIN games g ON g.game_id = pb.game_id
    WHERE ${REGULAR_SEASON} AND ${where}`;
}

function lacTeamGames(expr: string): string {
  return `
    SELECT ''::text AS scope_id, (${expr})::numeric AS value, t.game_id, g.game_date, NULL::bigint AS player_id, t.team_id
    FROM game_team_box_scores t
    JOIN game_team_box_scores o ON o.game_id = t.game_id AND o.team_id <> t.team_id
    JOIN games g ON g.game_id = t.game_id
    WHERE t.team_id = $1::bigint AND ${REGULAR_SEASON}`;
}

const spec = (scope: HighScope, statKey: string, source: string, limit = 25, order: 'desc' | 'asc' = 'desc'): HighSpec =>
  ({ scope, statKey, source, order, limit });

export const HIGH_SPECS: HighSpec[] = [
  // Any Clipper, any season.
  ...PLAYER_STATS.map(([key, col]) => spec('lac_player', key, playerGames(col, 'pb.team_id = $1::bigint', `''::text`))),
  // Personal bests of relevant players (all teams).
  ...PLAYER_STATS.map(([key, col]) => spec('player_career', key, playerGames(col, `pb.player_id IN ${RELEVANT_PLAYERS}`, 'pb.player_id::text'))),
  ...PLAYER_STATS.map(([key, col]) =>
    spec('player_season', key, playerGames(col, `pb.player_id IN ${RELEVANT_PLAYERS}`, `pb.player_id::text || ':' || g.season_id::text`), 5)),
  // League-wide per season.
  ...PLAYER_STATS.filter(([key]) => ['pts', 'reb', 'ast', 'fg3m'].includes(key))
    .map(([key, col]) => spec('league_season', key, playerGames(col, 'TRUE', 'g.season_id::text'))),
  // Clippers team games.
  spec('lac_team', 'team_pts', lacTeamGames('t.points')),
  spec('lac_team', 'team_fg3m', lacTeamGames('t.fg3_made')),
  spec('lac_team', 'team_ast', lacTeamGames('t.assists')),
  spec('lac_team', 'margin', lacTeamGames('t.points - o.points')),
  spec('lac_team', 'opp_pts_low', lacTeamGames('o.points'), 25, 'asc'),
  // Quarters and halves (play-by-play derived; regulation periods only — overtime is 5 minutes).
  spec('lac_team', 'team_q_pts', `
    SELECT ''::text AS scope_id, pt.pts::numeric AS value, pt.game_id, g.game_date, NULL::bigint AS player_id, pt.team_id
    FROM period_team_stats pt JOIN games g ON g.game_id = pt.game_id
    WHERE pt.team_id = $1::bigint AND pt.period <= 4 AND ${REGULAR_SEASON}`),
  spec('lac_player', 'q_pts', `
    SELECT ''::text AS scope_id, pp.pts::numeric AS value, pp.game_id, g.game_date, pp.player_id, pp.team_id
    FROM period_player_stats pp JOIN games g ON g.game_id = pp.game_id
    WHERE pp.team_id = $1::bigint AND pp.period <= 4 AND ${REGULAR_SEASON}`),
  spec('lac_player', 'half_pts', `
    SELECT ''::text AS scope_id, SUM(pp.pts)::numeric AS value, pp.game_id, g.game_date, pp.player_id, pp.team_id
    FROM period_player_stats pp JOIN games g ON g.game_id = pp.game_id
    WHERE pp.team_id = $1::bigint AND pp.period <= 4 AND ${REGULAR_SEASON}
    GROUP BY pp.game_id, g.game_date, pp.player_id, pp.team_id, (pp.period <= 2)`),
];

export function buildHighsSql(s: HighSpec): string {
  const dir = s.order === 'asc' ? 'ASC' : 'DESC';
  return `
    INSERT INTO rb_game_highs (scope, scope_id, stat_key, rank, value, game_id, game_date, player_id, team_id)
    SELECT '${s.scope}', scope_id, '${s.statKey}', rn, value, game_id, game_date, player_id, team_id
    FROM (
      SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.scope_id ORDER BY s.value ${dir}, s.game_date, s.game_id) AS rn
      FROM (${s.source}) s
      WHERE s.value IS NOT NULL
    ) ranked
    WHERE rn <= ${s.limit}`.trim();
}

/** Only the params a spec's SQL references (Postgres rejects extra bind params). */
export function highsParams(s: HighSpec, lacTeamId: string, relevantFrom: number): (string | number)[] {
  if (s.source.includes('$2')) return [lacTeamId, relevantFrom];
  if (s.source.includes('$1')) return [lacTeamId];
  return [];
}
