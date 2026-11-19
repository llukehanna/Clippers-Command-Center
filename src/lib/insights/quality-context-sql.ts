// src/lib/insights/quality-context-sql.ts
// The load-side game counts the quality bar needs (Q1, Q2), one row per
// ContextNeed. DB-free: SQL text and its params only; loaders run it.
// Relative imports only.
//   games_since       Q1: regular-season games strictly between since_date and until_date.
//                     A player need counts HIS games (any team); otherwise the Clippers'.
//   team_game_number  Q2: Clippers regular-season games in season_id through at_date, that game included.
// The `< until_date` and `<= at_date` bounds are the as-of: both are at most the fact date.

import { REGULAR_SEASON_SQL } from '../game-type';
import type { ContextNeed } from './quality';

/**
 * Params: $1 text[] insight ids, $2 bigint[] player ids, $3 date[] since dates, $4 date[] until dates,
 * $5 date[] at dates, $6 int[] season ids, $7 bigint the LAC nba_team_id.
 * Returns insight_id::text, games_since::int, team_game_number::int (NULL when the need lacks its dates).
 */
export const QUALITY_CONTEXT_SQL = `WITH lac AS (SELECT team_id FROM teams WHERE nba_team_id = $7::bigint),
need AS (
  SELECT * FROM unnest($1::text[], $2::bigint[], $3::date[], $4::date[], $5::date[], $6::int[])
    AS n(insight_id, player_id, since_date, until_date, at_date, season_id))
SELECT n.insight_id::text AS insight_id,
  (CASE WHEN n.since_date IS NULL OR n.until_date IS NULL THEN NULL
        WHEN n.player_id IS NOT NULL THEN (
          SELECT COUNT(*) FROM game_player_box_scores pb JOIN games g ON g.game_id = pb.game_id
          WHERE pb.player_id = n.player_id AND ${REGULAR_SEASON_SQL}
            AND g.game_date > n.since_date AND g.game_date < n.until_date)
        ELSE (
          SELECT COUNT(*) FROM games g, lac
          WHERE lac.team_id IN (g.home_team_id, g.away_team_id) AND ${REGULAR_SEASON_SQL} AND lower(g.status) = 'final'
            AND g.game_date > n.since_date AND g.game_date < n.until_date) END)::int AS games_since,
  (CASE WHEN n.at_date IS NULL OR n.season_id IS NULL THEN NULL ELSE (
          SELECT COUNT(*) FROM games g, lac
          WHERE lac.team_id IN (g.home_team_id, g.away_team_id) AND ${REGULAR_SEASON_SQL} AND lower(g.status) = 'final'
            AND g.season_id = n.season_id AND g.game_date <= n.at_date) END)::int AS team_game_number
FROM need n`;

/** The seven binds of QUALITY_CONTEXT_SQL, column-wise and in order. */
export function qualityContextParams(needs: ContextNeed[], lacNbaTeamId: number): unknown[] {
  return [
    needs.map((n) => n.insight_id),
    needs.map((n) => n.player_id),
    needs.map((n) => n.since_date),
    needs.map((n) => n.until_date),
    needs.map((n) => n.at_date),
    needs.map((n) => n.season_id),
    lacNbaTeamId,
  ];
}
