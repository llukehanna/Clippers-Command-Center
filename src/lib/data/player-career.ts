// src/lib/data/player-career.ts
// GET /api/players/{player_id}/career — a player's Clippers years only:
// per-season lines (regular season and playoffs apart; play-in games count in
// neither), career averages, shooting splits and totals, franchise ranks, and
// career highs. Games for other teams are left out by design.
//
// Coverage varies by era: the Kaggle import (1970–) has points, rebounds and
// assists throughout, but steals/blocks start in 1973–74, threes in 1979–80,
// and plus-minus and starts only in the modern feeds. Each average divides by
// the games that actually recorded it, and is null when none did.

import { json, type ApiResult } from './result';
import { sql, LAC_NBA_TEAM_ID } from '@/src/lib/db';
import { buildMeta, buildError } from '@/src/lib/api-utils';
import { GAME_TYPE_SQL } from '@/src/lib/game-type';

export interface CareerLine {
  games: number;
  pts_avg: number | null;
  reb_avg: number | null;
  ast_avg: number | null;
  min_avg: number | null;
  stl_avg: number | null;
  blk_avg: number | null;
  tov_avg: number | null;
  pm_avg: number | null;
  /** 0–1 shooting percentages from the period's totals. */
  ts_pct: number | null;
  fg_pct: number | null;
  fg3_pct: number | null;
  ft_pct: number | null;
  fg3_made: number;
  pts_total: number;
  reb_total: number;
  ast_total: number;
  stl_total: number;
  blk_total: number;
  double_doubles: number;
  triple_doubles: number;
  games_30: number;
  games_40: number;
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

/** Rank among everyone in franchise history (regular season totals); 1 = most. */
export interface CareerRanks {
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  games: number | null;
  steals: number | null;
  blocks: number | null;
  threes: number | null;
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
  /** Kept for older callers; same as ranks.points. */
  points_rank: number | null;
  ranks: CareerRanks;
  highs: CareerHigh[];
}

/** Raw sums per season and bucket; averages are derived in careerLine(). */
interface SumRow {
  season_id: number;
  bucket: 'regular' | 'playoffs' | 'play_in';
  games: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  stl_n: number;
  blk: number;
  blk_n: number;
  tov: number;
  tov_n: number;
  pm: number;
  pm_n: number;
  min: number;
  min_n: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  fg3_n: number;
  ftm: number;
  fta: number;
  dd: number;
  td: number;
  g30: number;
  g40: number;
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

const SUM_KEYS = [
  'games', 'pts', 'reb', 'ast', 'stl', 'stl_n', 'blk', 'blk_n', 'tov', 'tov_n', 'pm', 'pm_n', 'min', 'min_n',
  'fgm', 'fga', 'fg3m', 'fg3a', 'fg3_n', 'ftm', 'fta', 'dd', 'td', 'g30', 'g40',
] as const;

/** Combine season rows into one line (a career, or a single season). */
export function careerLine(rows: SumRow[]): CareerLine | null {
  if (rows.length === 0) return null;
  const t = Object.fromEntries(SUM_KEYS.map((k) => [k, rows.reduce((n, r) => n + Number(r[k] ?? 0), 0)])) as Record<
    (typeof SUM_KEYS)[number],
    number
  >;
  return {
    games: t.games,
    pts_avg: ratio(t.pts, t.games),
    reb_avg: ratio(t.reb, t.games),
    ast_avg: ratio(t.ast, t.games),
    min_avg: ratio(t.min, t.min_n),
    stl_avg: ratio(t.stl, t.stl_n),
    blk_avg: ratio(t.blk, t.blk_n),
    tov_avg: ratio(t.tov, t.tov_n),
    pm_avg: ratio(t.pm, t.pm_n),
    ts_pct: ratio(t.pts, 2 * (t.fga + 0.44 * t.fta)),
    fg_pct: ratio(t.fgm, t.fga),
    // Before the three-point line (and in feeds without it) there are no attempts to divide by.
    fg3_pct: t.fg3_n > 0 ? ratio(t.fg3m, t.fg3a) : null,
    ft_pct: ratio(t.ftm, t.fta),
    fg3_made: t.fg3m,
    pts_total: t.pts,
    reb_total: t.reb,
    ast_total: t.ast,
    stl_total: t.stl,
    blk_total: t.blk,
    double_doubles: t.dd,
    triple_doubles: t.td,
    games_30: t.g30,
    games_40: t.g40,
  };
}

const toSeason = (r: SumRow): CareerSeason => ({ season_id: r.season_id, ...careerLine([r])! });

// Minutes arrive as "34:12" (Kaggle/BDL), "PT34M12.00S" (NBA feeds) or a bare number.
const MINUTES_SQL = `CASE
  WHEN pb.minutes ~ '^PT' THEN COALESCE(substring(pb.minutes from 'PT([0-9]+)M')::numeric, 0)
                             + COALESCE(substring(pb.minutes from 'M([0-9.]+)S')::numeric, 0) / 60
  WHEN pb.minutes ~ '^[0-9]+:[0-9]+' THEN split_part(pb.minutes, ':', 1)::numeric + split_part(pb.minutes, ':', 2)::numeric / 60
  WHEN pb.minutes ~ '^[0-9]+(\\.[0-9]+)?$' THEN pb.minutes::numeric
END`;

// A stat counts toward a double-double at 10+.
const TENS_SQL = `((COALESCE(pb.points, 0) >= 10)::int + (COALESCE(pb.rebounds, 0) >= 10)::int + (COALESCE(pb.assists, 0) >= 10)::int
  + (COALESCE(pb.steals, 0) >= 10)::int + (COALESCE(pb.blocks, 0) >= 10)::int)`;

export async function loadPlayerCareer(player_id: string): Promise<ApiResult> {
  if (!/^\d{1,15}$/.test(player_id)) {
    return json(buildError('NOT_FOUND', 'Player not found'), { status: 404 });
  }
  try {
    const [sums, highs, rankRows, personRows] = await Promise.all([
      sql<SumRow[]>`
        SELECT
          g.season_id::int AS season_id,
          (${sql.unsafe(GAME_TYPE_SQL)}) AS bucket,
          COUNT(*)::int AS games,
          COALESCE(SUM(pb.points), 0)::int   AS pts,
          COALESCE(SUM(pb.rebounds), 0)::int AS reb,
          COALESCE(SUM(pb.assists), 0)::int  AS ast,
          COALESCE(SUM(pb.steals), 0)::int   AS stl,
          COUNT(pb.steals)::int              AS stl_n,
          COALESCE(SUM(pb.blocks), 0)::int   AS blk,
          COUNT(pb.blocks)::int              AS blk_n,
          COALESCE(SUM(pb.turnovers), 0)::int AS tov,
          COUNT(pb.turnovers)::int           AS tov_n,
          COALESCE(SUM(pb.plus_minus), 0)::int AS pm,
          COUNT(pb.plus_minus)::int          AS pm_n,
          COALESCE(SUM(${sql.unsafe(MINUTES_SQL)}), 0)::float8 AS min,
          COUNT(${sql.unsafe(MINUTES_SQL)})::int AS min_n,
          COALESCE(SUM(pb.fg_made), 0)::int      AS fgm,
          COALESCE(SUM(pb.fg_attempted), 0)::int AS fga,
          COALESCE(SUM(pb.fg3_made), 0)::int     AS fg3m,
          COALESCE(SUM(pb.fg3_attempted), 0)::int AS fg3a,
          COUNT(pb.fg3_attempted)::int           AS fg3_n,
          COALESCE(SUM(pb.ft_made), 0)::int      AS ftm,
          COALESCE(SUM(pb.ft_attempted), 0)::int AS fta,
          COUNT(*) FILTER (WHERE ${sql.unsafe(TENS_SQL)} >= 2)::int AS dd,
          COUNT(*) FILTER (WHERE ${sql.unsafe(TENS_SQL)} >= 3)::int AS td,
          COUNT(*) FILTER (WHERE pb.points >= 30)::int AS g30,
          COUNT(*) FILTER (WHERE pb.points >= 40)::int AS g40
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
      sql<Array<{ points: number; rebounds: number; assists: number; games: number; steals: number; blocks: number; threes: number }>>`
        WITH totals AS (
          SELECT
            pb.player_id,
            COALESCE(SUM(pb.points), 0)   AS pts,
            COALESCE(SUM(pb.rebounds), 0) AS reb,
            COALESCE(SUM(pb.assists), 0)  AS ast,
            COUNT(*)                      AS gp,
            COALESCE(SUM(pb.steals), 0)   AS stl,
            COALESCE(SUM(pb.blocks), 0)   AS blk,
            COALESCE(SUM(pb.fg3_made), 0) AS fg3
          FROM game_player_box_scores pb
          JOIN games g ON g.game_id = pb.game_id
          WHERE pb.team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
            AND lower(g.status) = 'final'
            AND ${sql.unsafe(GAME_TYPE_SQL)} = 'regular'
          GROUP BY pb.player_id
        ), ranked AS (
          SELECT
            player_id,
            RANK() OVER (ORDER BY pts DESC)::int AS points,
            RANK() OVER (ORDER BY reb DESC)::int AS rebounds,
            RANK() OVER (ORDER BY ast DESC)::int AS assists,
            RANK() OVER (ORDER BY gp DESC)::int  AS games,
            RANK() OVER (ORDER BY stl DESC)::int AS steals,
            RANK() OVER (ORDER BY blk DESC)::int AS blocks,
            RANK() OVER (ORDER BY fg3 DESC)::int AS threes
          FROM totals
        )
        SELECT points, rebounds, assists, games, steals, blocks, threes
        FROM ranked
        WHERE player_id = ${player_id}::bigint
      `,
      sql<{ nba_person_id: number | null }[]>`
        SELECT nba_person_id FROM players WHERE player_id = ${player_id}::bigint
      `,
    ]);

    const regularRows = sums.filter((r) => r.bucket === 'regular');
    const playoffRows = sums.filter((r) => r.bucket === 'playoffs');
    const allSeasons = sums.map((r) => r.season_id);
    const r = rankRows[0];
    const ranks: CareerRanks = {
      points: r?.points ?? null,
      rebounds: r?.rebounds ?? null,
      assists: r?.assists ?? null,
      games: r?.games ?? null,
      steals: r && regularRows.some((x) => x.stl_n > 0) ? r.steals : null,
      blocks: r && regularRows.some((x) => x.blk_n > 0) ? r.blocks : null,
      threes: r && regularRows.some((x) => x.fg3m > 0) ? r.threes : null,
    };

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
        points_rank: ranks.points,
        ranks,
        highs,
      },
      { headers: { 'Cache-Control': 'public, max-age=600' } }
    );
  } catch (err) {
    console.error('[players/career]', err);
    return json(buildError('INTERNAL_ERROR', 'Could not load career'), { status: 500 });
  }
}
