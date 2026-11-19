// src/lib/data/players-all-time.ts
// GET /api/players/all-time — every player who has played for the franchise
// (Buffalo Braves, San Diego and LA Clippers), with their Clippers-only
// regular-season totals and averages. ~500 rows; the page sorts, filters by era
// and searches them. Box scores reach back to 1970 (the Kaggle history import).

import { json, type ApiResult } from './result';
import { sql, LAC_NBA_TEAM_ID } from '@/src/lib/db';
import { buildMeta, buildError } from '@/src/lib/api-utils';
import { GAME_TYPE_SQL } from '@/src/lib/game-type';

export interface AllTimePlayer {
  player_id: string;
  display_name: string;
  position: string | null;
  nba_person_id: number | null;
  games: number;
  seasons: number;
  first_season: number;
  last_season: number;
  pts_avg: number | null;
  reb_avg: number | null;
  ast_avg: number | null;
  pts_total: number;
  /** 1 = most regular-season points in franchise history. */
  points_rank: number;
}

export interface AllTimePayload {
  meta: ReturnType<typeof buildMeta>;
  players: AllTimePlayer[];
}

export async function loadPlayersAllTime(): Promise<ApiResult> {
  try {
    const players = await sql<AllTimePlayer[]>`
      WITH lac AS (
        SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID}
      ), rows AS (
        SELECT pb.player_id, g.season_id, pb.points, pb.rebounds, pb.assists
        FROM game_player_box_scores pb
        JOIN games g ON g.game_id = pb.game_id
        WHERE pb.team_id = (SELECT team_id FROM lac)
          AND lower(g.status) = 'final'
          AND ${sql.unsafe(GAME_TYPE_SQL)} = 'regular'
      ), agg AS (
        SELECT
          player_id,
          COUNT(*)::int                     AS games,
          COUNT(DISTINCT season_id)::int    AS seasons,
          MIN(season_id)::int               AS first_season,
          MAX(season_id)::int               AS last_season,
          AVG(points)::float8               AS pts_avg,
          AVG(rebounds)::float8             AS reb_avg,
          AVG(assists)::float8              AS ast_avg,
          COALESCE(SUM(points), 0)::int     AS pts_total
        FROM rows
        GROUP BY player_id
      )
      SELECT
        a.player_id::text,
        p.display_name,
        p.position,
        p.nba_person_id,
        a.games, a.seasons, a.first_season, a.last_season,
        a.pts_avg, a.reb_avg, a.ast_avg, a.pts_total,
        RANK() OVER (ORDER BY a.pts_total DESC)::int AS points_rank
      FROM agg a
      JOIN players p ON p.player_id = a.player_id
      ORDER BY a.pts_total DESC, p.display_name
    `;
    return json<AllTimePayload>(
      { meta: buildMeta('db', 3600), players },
      { headers: { 'Cache-Control': 'public, max-age=600' } }
    );
  } catch (err) {
    console.error('[players/all-time]', err);
    return json(buildError('INTERNAL_ERROR', 'Could not load all-time players'), { status: 500 });
  }
}
