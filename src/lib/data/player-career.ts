// src/lib/data/player-career.ts
// GET /api/players/{player_id}/career — a player's Clippers years only:
// per-season lines (regular season and playoffs apart; play-in games count in
// neither), career averages and totals, franchise points rank, and career
// highs. Games for other teams are left out by design.

import { json, type ApiResult } from './result';
import { sql, LAC_NBA_TEAM_ID } from '@/src/lib/db';
import { buildMeta, buildError } from '@/src/lib/api-utils';
import { GAME_TYPE_SQL } from '@/src/lib/game-type';

export interface CareerLine {
  games: number;
  pts_avg: number | null;
  reb_avg: number | null;
  ast_avg: number | null;
  /** 0–1, from the season's shooting totals. */
  ts_pct: number | null;
  pts_total: number;
  reb_total: number;
  ast_total: number;
}

export interface CareerSeason extends CareerLine {
  season_id: number;
}

export interface CareerHigh {
  game_id: string;
  game_date: string;
  opp: string;
  home: boolean;
  points: number;
  rebounds: number | null;
  assists: number | null;
  team_score: number | null;
  opp_score: number | null;
  playoffs: boolean;
}

export interface PlayerCareerPayload {
  meta: ReturnType<typeof buildMeta>;
  player_id: string;
  nba_person_id: number | null;
  first_season: number | null;
  last_season: number | null;
  regular: CareerLine | null;
  playoffs: CareerLine | null;
  seasons: { regular: CareerSeason[]; playoffs: CareerSeason[] };
  points_rank: number | null;
  highs: CareerHigh[];
}

interface LineRow extends CareerSeason {
  bucket: 'regular' | 'playoffs';
  fga: number;
  fta: number;
}

const ts = (pts: number, fga: number, fta: number): number | null => {
  const shots = 2 * (fga + 0.44 * fta);
  return shots > 0 ? pts / shots : null;
};

function careerLine(rows: LineRow[]): CareerLine | null {
  if (rows.length === 0) return null;
  const games = rows.reduce((n, r) => n + r.games, 0);
  const pts = rows.reduce((n, r) => n + r.pts_total, 0);
  const reb = rows.reduce((n, r) => n + r.reb_total, 0);
  const ast = rows.reduce((n, r) => n + r.ast_total, 0);
  const fga = rows.reduce((n, r) => n + r.fga, 0);
  const fta = rows.reduce((n, r) => n + r.fta, 0);
  return {
    games,
    pts_avg: games ? pts / games : null,
    reb_avg: games ? reb / games : null,
    ast_avg: games ? ast / games : null,
    ts_pct: ts(pts, fga, fta),
    pts_total: pts,
    reb_total: reb,
    ast_total: ast,
  };
}

const toSeason = (r: LineRow): CareerSeason => ({
  season_id: r.season_id,
  games: r.games,
  pts_avg: r.pts_avg,
  reb_avg: r.reb_avg,
  ast_avg: r.ast_avg,
  ts_pct: ts(r.pts_total, r.fga, r.fta),
  pts_total: r.pts_total,
  reb_total: r.reb_total,
  ast_total: r.ast_total,
});

export async function loadPlayerCareer(player_id: string): Promise<ApiResult> {
  if (!/^\d{1,15}$/.test(player_id)) {
    return json(buildError('NOT_FOUND', 'Player not found'), { status: 404 });
  }
  try {
    const [lines, highs, rankRows, personRows] = await Promise.all([
      sql<LineRow[]>`
        SELECT
          g.season_id::int AS season_id,
          (${sql.unsafe(GAME_TYPE_SQL)}) AS bucket,
          COUNT(*)::int AS games,
          AVG(pb.points)::float8   AS pts_avg,
          AVG(pb.rebounds)::float8 AS reb_avg,
          AVG(pb.assists)::float8  AS ast_avg,
          COALESCE(SUM(pb.points), 0)::int   AS pts_total,
          COALESCE(SUM(pb.rebounds), 0)::int AS reb_total,
          COALESCE(SUM(pb.assists), 0)::int  AS ast_total,
          COALESCE(SUM(pb.fg_attempted), 0)::int AS fga,
          COALESCE(SUM(pb.ft_attempted), 0)::int AS fta
        FROM game_player_box_scores pb
        JOIN games g ON g.game_id = pb.game_id
        WHERE pb.player_id = ${player_id}::bigint
          AND pb.team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
          AND lower(g.status) = 'final'
        GROUP BY 1, 2
        ORDER BY 1
      `,
      sql<CareerHigh[]>`
        SELECT
          g.game_id::text,
          g.game_date::text,
          COALESCE(oe.abbreviation, opp.abbreviation) AS opp,
          (g.home_team_id = pb.team_id) AS home,
          pb.points,
          pb.rebounds,
          pb.assists,
          CASE WHEN g.home_team_id = pb.team_id THEN g.home_score ELSE g.away_score END AS team_score,
          CASE WHEN g.home_team_id = pb.team_id THEN g.away_score ELSE g.home_score END AS opp_score,
          g.is_playoffs AS playoffs
        FROM game_player_box_scores pb
        JOIN games g ON g.game_id = pb.game_id
        JOIN teams opp ON opp.team_id = CASE WHEN g.home_team_id = pb.team_id THEN g.away_team_id ELSE g.home_team_id END
        LEFT JOIN team_era_names oe ON oe.team_id = opp.team_id
         AND g.season_id >= oe.first_season_id
         AND (oe.last_season_id IS NULL OR g.season_id <= oe.last_season_id)
        WHERE pb.player_id = ${player_id}::bigint
          AND pb.team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
          AND lower(g.status) = 'final'
          AND pb.points IS NOT NULL
        ORDER BY pb.points DESC, pb.rebounds DESC NULLS LAST, g.game_date DESC
        LIMIT 3
      `,
      sql<{ points_rank: number }[]>`
        WITH totals AS (
          SELECT pb.player_id, SUM(pb.points) AS pts
          FROM game_player_box_scores pb
          JOIN games g ON g.game_id = pb.game_id
          WHERE pb.team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
            AND lower(g.status) = 'final'
            AND ${sql.unsafe(GAME_TYPE_SQL)} = 'regular'
          GROUP BY pb.player_id
        )
        SELECT rank::int AS points_rank FROM (
          SELECT player_id, RANK() OVER (ORDER BY COALESCE(pts, 0) DESC) AS rank FROM totals
        ) r
        WHERE player_id = ${player_id}::bigint
      `,
      sql<{ nba_person_id: number | null }[]>`
        SELECT nba_person_id FROM players WHERE player_id = ${player_id}::bigint
      `,
    ]);

    const regularRows = lines.filter((r) => r.bucket === 'regular');
    const playoffRows = lines.filter((r) => r.bucket === 'playoffs');
    const allSeasons = lines.map((r) => r.season_id);

    return json<PlayerCareerPayload>(
      {
        meta: buildMeta('db', 600),
        player_id,
        nba_person_id: personRows[0]?.nba_person_id ?? null,
        first_season: allSeasons.length ? Math.min(...allSeasons) : null,
        last_season: allSeasons.length ? Math.max(...allSeasons) : null,
        regular: careerLine(regularRows),
        playoffs: careerLine(playoffRows),
        seasons: { regular: regularRows.map(toSeason), playoffs: playoffRows.map(toSeason) },
        points_rank: rankRows[0]?.points_rank ?? null,
        highs,
      },
      { headers: { 'Cache-Control': 'public, max-age=600' } }
    );
  } catch (err) {
    console.error('[players/career]', err);
    return json(buildError('INTERNAL_ERROR', 'Could not load career'), { status: 500 });
  }
}
