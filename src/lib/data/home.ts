// src/lib/data/home.ts — moved from app/api/home/route.ts; the route and server pages both call loadHome().
// app/api/home/route.ts
// GET /api/home — Between-Games Dashboard endpoint.
//
// Returns team snapshot, upcoming schedule with odds, player trends, and insights.
// Implements the /api/home contract from Docs/API_SPEC.md.
// SLA: < 300ms (all DB queries run in parallel via Promise.all).

import { json, type ApiResult } from './result';
import { sql, LAC_NBA_TEAM_ID } from '@/src/lib/db';
import { buildMeta, buildError } from '@/src/lib/api-utils';
import { getLatestOdds } from '@/src/lib/odds';
import { getDisplaySeasonId } from '@/src/lib/season';
import { REGULAR_SEASON_SQL } from '@/src/lib/game-type';
import { MINUTES_SECONDS_SQL } from '@/src/lib/minutes';

// ─── Minutes parsing helper ───────────────────────────────────────────────────
// game_player_box_scores.minutes is stored as TEXT, e.g. "34:12" or "PT34M12.00S".
// Returns decimal minutes for averaging.

function minutesTextToDecimal(minutes: string | null | undefined): number {
  if (!minutes) return 0;
  // ISO 8601 duration: "PT34M12.00S"
  const isoDurationMatch = minutes.match(/PT(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?/);
  if (isoDurationMatch) {
    const m = parseFloat(isoDurationMatch[1] ?? '0');
    const s = parseFloat(isoDurationMatch[2] ?? '0');
    return m + s / 60;
  }
  // MM:SS format: "34:12"
  const colonMatch = minutes.match(/^(\d+):(\d+)$/);
  if (colonMatch) {
    return parseInt(colonMatch[1], 10) + parseInt(colonMatch[2], 10) / 60;
  }
  // Plain decimal
  const num = parseFloat(minutes);
  return isNaN(num) ? 0 : num;
}

// ─── Types for query results ──────────────────────────────────────────────────

interface TeamRow {
  team_id: string;
  abbreviation: string;
}

interface GameRecordRow {
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
}

interface Last10GameRow extends GameRecordRow {
  game_id: string;
  game_date: string;
  home_abbr: string;
  away_abbr: string;
}

interface RatingsRow {
  net_rating: number | null;
  off_rating: number | null;
  def_rating: number | null;
}

interface UpcomingGameRow {
  game_id: string;
  game_date: string;
  start_time_utc: string | null;
  home_team_id: string;
  away_team_id: string;
  home_abbr: string;
  away_abbr: string;
  status: string;
}

interface PlayerTrendRow {
  player_id: string;
  nba_player_id: number | null;
  nba_person_id: number | null;
  name: string;
  game_count: string;
  minutes_texts: string[];
  pts_avg: number | null;
  reb_avg: number | null;
  ast_avg: number | null;
  ts_pct: number | null;
}

interface InsightRow {
  insight_id: string;
  category: string;
  headline: string;
  detail: string | null;
  importance: number;
  proof_result: unknown;
}

/** Sort key for "which game is next": tip time, else the game date. */
function tipKey(g: { game_date: string; start_time_utc: string | null }): string {
  return g.start_time_utc ?? `${g.game_date}T23:59:59Z`;
}

// ─── GET handler ──────────────────────────────────────────────────────────────

export async function loadHome(): Promise<ApiResult> {
  try {
    // Display season = latest season with a completed LAC game (see
    // getDisplaySeasonId), so record, last_10 and ratings always describe the
    // same season — including through the offseason and preseason window.
    const seasonId = await getDisplaySeasonId();

    // ── Parallel queries (all run concurrently for < 300ms SLA) ─────────────
    // Team lookup is embedded as a subquery so we never store a bigint in JS.
    // Pattern consistent with app/api/live/route.ts.

    const [
      teamRows,
      ratingsRows,
      last10Rows,
      recordRows,
      upcomingRows,
      playerTrendRows,
      seedRows,
      insightRows,
      lastSyncRows,
      preseasonRows,
    ] = await Promise.all([
      // 0: LAC team record (need abbreviation and internal id for opponent lookup)
      sql`
        SELECT team_id::text AS team_id, abbreviation
        FROM teams
        WHERE nba_team_id = ${LAC_NBA_TEAM_ID}
      ` as Promise<TeamRow[]>,

      // A: Regular-season ratings for LAC in the display season, possession-
      //    weighted (points per 100 possessions over the season). Matches the
      //    record next to it; the rolling tables include playoff games.
      sql`
        SELECT
          (SUM(a.net_rating * a.possessions) / NULLIF(SUM(a.possessions), 0))::float8 AS net_rating,
          (SUM(a.off_rating * a.possessions) / NULLIF(SUM(a.possessions), 0))::float8 AS off_rating,
          (SUM(a.def_rating * a.possessions) / NULLIF(SUM(a.possessions), 0))::float8 AS def_rating
        FROM advanced_team_game_stats a
        JOIN games g ON g.game_id = a.game_id
        WHERE a.team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
          AND g.season_id = ${seasonId}
          AND ${sql.unsafe(REGULAR_SEASON_SQL)}
        HAVING COUNT(*) > 0
      ` as Promise<RatingsRow[]>,

      // B: Last 10 LAC final games in the display season
      //    (for last_10 W/L record and the last10_games point-diff chart)
      sql`
        SELECT
          g.game_id::text AS game_id,
          g.home_team_id::text AS home_team_id,
          g.away_team_id::text AS away_team_id,
          g.home_score,
          g.away_score,
          g.game_date::text AS game_date,
          ht.abbreviation AS home_abbr,
          at.abbreviation AS away_abbr
        FROM games g
        JOIN teams ht ON ht.team_id = g.home_team_id
        JOIN teams at ON at.team_id = g.away_team_id
        WHERE (
          g.home_team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
          OR g.away_team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
        )
          AND lower(g.status) = 'final'
          AND g.season_id = ${seasonId}
        ORDER BY g.game_date DESC
        LIMIT 10
      ` as Promise<Last10GameRow[]>,

      // C: Season W/L record (regular-season final games in the display season;
      //    excludes the play-in, which is not flagged is_playoffs)
      sql`
        SELECT
          g.home_team_id::text AS home_team_id,
          g.away_team_id::text AS away_team_id,
          g.home_score,
          g.away_score
        FROM games g
        WHERE (
          g.home_team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
          OR g.away_team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
        )
          AND lower(g.status) = 'final'
          AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
          AND ${sql.unsafe(REGULAR_SEASON_SQL)}
          AND g.season_id = ${seasonId}
        ORDER BY g.game_date DESC
      ` as Promise<GameRecordRow[]>,

      // D: Upcoming schedule (future LAC games, ordered by date)
      sql`
        SELECT
          g.game_id::text AS game_id,
          g.game_date::text AS game_date,
          to_char(g.start_time_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_time_utc,  -- ISO-8601 for every browser
          g.home_team_id::text AS home_team_id,
          g.away_team_id::text AS away_team_id,
          ht.abbreviation AS home_abbr,
          at.abbreviation AS away_abbr,
          g.status
        FROM games g
        JOIN teams ht ON ht.team_id = g.home_team_id
        JOIN teams at ON at.team_id = g.away_team_id
        WHERE (
          g.home_team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
          OR g.away_team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
        )
          -- game_date is the US Eastern calendar date; compare against today in ET
          -- so tonight's game doesn't drop off after midnight UTC (5pm PT).
          AND g.game_date >= (now() AT TIME ZONE 'America/New_York')::date
          AND lower(g.status) <> 'final'
        ORDER BY g.game_date ASC
        LIMIT 10
      ` as Promise<UpcomingGameRow[]>,

      // E: Player trends — top 8 by average minutes in last 10 LAC games.
      // minutes is stored as TEXT (e.g. "34:12" or "PT34M12.00S"), so we
      // collect the raw strings and parse them in JavaScript.
      sql`
        SELECT
          p.player_id::text AS player_id,
          p.nba_player_id,
          p.nba_person_id,
          p.display_name AS name,
          COUNT(*)::text AS game_count,
          array_agg(gpbs.minutes ORDER BY g.game_date DESC) AS minutes_texts,
          AVG(gpbs.points)::float8 AS pts_avg,
          AVG(gpbs.rebounds)::float8 AS reb_avg,
          AVG(gpbs.assists)::float8 AS ast_avg,
          -- TS% = PTS / (2 × (FGA + 0.44 × FTA)) over the window
          (SUM(gpbs.points)::float8
            / NULLIF(2 * (SUM(gpbs.fg_attempted) + 0.44 * SUM(gpbs.ft_attempted)), 0)) AS ts_pct
        FROM game_player_box_scores gpbs
        JOIN players p ON p.player_id = gpbs.player_id
        JOIN games g ON g.game_id = gpbs.game_id
        WHERE gpbs.team_id = (
          SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID}
        )
          AND gpbs.game_id IN (
            SELECT game_id FROM games
            WHERE (
              home_team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
              OR away_team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
            )
              AND lower(status) = 'final'
              AND season_id = ${seasonId}
            ORDER BY game_date DESC LIMIT 10
          )
        GROUP BY p.player_id, p.nba_player_id, p.nba_person_id, p.display_name
        ORDER BY AVG(${sql.unsafe(MINUTES_SECONDS_SQL.replaceAll('pb.', 'gpbs.'))}
        ) DESC NULLS LAST
        LIMIT 8
      ` as Promise<PlayerTrendRow[]>,

      // G: Conference seed — regular-season win% rank within LAC's conference
      //    (league-wide games are in the DB). Null until every team has played.
      sql`
        WITH results AS (
          SELECT g.home_team_id AS team_id, (g.home_score > g.away_score) AS won
          FROM games g
          WHERE g.season_id = ${seasonId} AND lower(g.status) = 'final'
            AND g.home_score IS NOT NULL AND ${sql.unsafe(REGULAR_SEASON_SQL)}
          UNION ALL
          SELECT g.away_team_id, (g.away_score > g.home_score)
          FROM games g
          WHERE g.season_id = ${seasonId} AND lower(g.status) = 'final'
            AND g.home_score IS NOT NULL AND ${sql.unsafe(REGULAR_SEASON_SQL)}
        ), records AS (
          SELECT r.team_id, t.conference, COUNT(*) FILTER (WHERE r.won)::float8 / COUNT(*) AS pct
          FROM results r JOIN teams t ON t.team_id = r.team_id
          GROUP BY r.team_id, t.conference
        ), ranked AS (
          SELECT team_id,
                 RANK() OVER (PARTITION BY conference ORDER BY pct DESC)::int AS seed,
                 COUNT(*) OVER (PARTITION BY conference)::int AS conf_teams
          FROM records
        )
        SELECT seed, conf_teams FROM ranked
        WHERE team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
      ` as Promise<{ seed: number; conf_teams: number }[]>,

      // F: Between-games insights
      sql`
        SELECT
          insight_id::text AS insight_id,
          category,
          headline,
          detail,
          importance,
          proof_result
        FROM insights
        WHERE scope = 'between_games'
          AND is_active = true
        ORDER BY importance DESC
        LIMIT 10
      ` as Promise<InsightRow[]>,

      // H: When the data pipeline last ran (nightly post-game workflow or the
      //    game-night runner), else when the newest box score landed.
      sql`
        SELECT to_char(
          COALESCE(
            (SELECT (value #>> '{}')::timestamptz FROM app_kv WHERE key = 'pipeline:last_sync_at'),
            (SELECT MAX(created_at) FROM game_team_box_scores)
          ) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_sync_at
      ` as Promise<{ last_sync_at: string | null }[]>,

      // I: Next preseason game. all_games, not the games view: preseason games
      //    can be the next game (the live page polls them) but stay out of the
      //    upcoming schedule, records and everything else.
      sql`
        SELECT
          g.game_id::text AS game_id,
          g.game_date::text AS game_date,
          to_char(g.start_time_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_time_utc,
          g.home_team_id::text AS home_team_id,
          g.away_team_id::text AS away_team_id,
          ht.abbreviation AS home_abbr,
          at.abbreviation AS away_abbr,
          g.status
        FROM all_games g
        JOIN teams ht ON ht.team_id = g.home_team_id
        JOIN teams at ON at.team_id = g.away_team_id
        WHERE g.is_preseason
          AND (
            g.home_team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
            OR g.away_team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
          )
          AND g.game_date >= (now() AT TIME ZONE 'America/New_York')::date
          AND lower(g.status) <> 'final'
        ORDER BY g.start_time_utc ASC NULLS LAST, g.game_date ASC
        LIMIT 1
      ` as Promise<UpcomingGameRow[]>,
    ]);

    // ── team_snapshot ─────────────────────────────────────────────────────────

    const lacTeamRow = teamRows[0];
    if (!lacTeamRow) {
      return json(
        buildError('DATA_NOT_READY', 'LAC team record not found in database'),
        { status: 503 }
      );
    }

    const lacTeamIdStr = lacTeamRow.team_id;

    // Season record
    let seasonWins = 0;
    let seasonLosses = 0;
    for (const game of recordRows) {
      const lacIsHome = game.home_team_id === lacTeamIdStr;
      const lacScore = lacIsHome ? game.home_score : game.away_score;
      const oppScore = lacIsHome ? game.away_score : game.home_score;
      if (lacScore > oppScore) {
        seasonWins++;
      } else {
        seasonLosses++;
      }
    }

    // Last 10
    let last10Wins = 0;
    let last10Losses = 0;
    const last10GamesMapped: Array<{ game_id: number; opponent_abbr: string; game_date: string; margin: number }> = [];
    for (const game of last10Rows) {
      const lacIsHome = game.home_team_id === lacTeamIdStr;
      const lacScore = lacIsHome ? game.home_score : game.away_score;
      const oppScore = lacIsHome ? game.away_score : game.home_score;
      if (lacScore > oppScore) {
        last10Wins++;
      } else {
        last10Losses++;
      }
      last10GamesMapped.push({
        game_id: parseInt(game.game_id, 10), // same id as /api/history/games/{game_id}
        opponent_abbr: lacIsHome ? game.away_abbr : game.home_abbr,
        game_date: game.game_date,
        margin: lacScore - oppScore,
      });
    }

    // Ratings (null if no rows)
    const ratingsRow = ratingsRows[0] ?? null;

    const teamSnapshot = {
      team_abbr: 'LAC',
      season_id: seasonId,
      record: { wins: seasonWins, losses: seasonLosses },
      // Only when the whole conference has games (15 teams) — never fabricate.
      conference_seed: seedRows[0] && seedRows[0].conf_teams >= 15 ? seedRows[0].seed : null,
      net_rating: ratingsRow?.net_rating ?? null,
      off_rating: ratingsRow?.off_rating ?? null,
      def_rating: ratingsRow?.def_rating ?? null,
      last_10: { wins: last10Wins, losses: last10Losses },
      last10_games: last10GamesMapped,
    };

    // ── upcoming_schedule ─────────────────────────────────────────────────────

    const upcomingWithOdds = await Promise.all(
      upcomingRows.map(async (game: UpcomingGameRow) => {
        const lacIsHome = game.home_team_id === lacTeamIdStr;
        const opponentAbbr = lacIsHome ? game.away_abbr : game.home_abbr;
        const homeAway = lacIsHome ? 'home' : 'away';
        const odds = await getLatestOdds(game.game_id);
        // Present odds from LAC's perspective (shape consumed by NextGameHero / ScheduleTable)
        const oddsDisplay = odds ? {
          spread: lacIsHome ? odds.spread_home : odds.spread_away,
          moneyline: lacIsHome ? odds.moneyline_home : odds.moneyline_away,
          over_under: odds.total_points,
          captured_at: odds.captured_at,
        } : null;
        return {
          game_id: parseInt(game.game_id, 10),
          game_date: game.game_date,
          start_time_utc: game.start_time_utc,
          opponent_abbr: opponentAbbr,
          home_away: homeAway,
          status: game.status,
          odds: oddsDisplay,
        };
      })
    );

    // A preseason game is the next game when it comes first (no odds: books
    // rarely post preseason lines and odds sync never matches them).
    const preseasonRow = preseasonRows[0];
    const preseasonNext = preseasonRow
      ? {
          game_id: parseInt(preseasonRow.game_id, 10),
          game_date: preseasonRow.game_date,
          start_time_utc: preseasonRow.start_time_utc,
          opponent_abbr: preseasonRow.home_team_id === lacTeamIdStr ? preseasonRow.away_abbr : preseasonRow.home_abbr,
          home_away: preseasonRow.home_team_id === lacTeamIdStr ? 'home' : 'away',
          status: preseasonRow.status,
          odds: null,
          is_preseason: true,
        }
      : null;
    const regularNext = upcomingWithOdds[0] ?? null;
    const nextGame =
      preseasonNext && (!regularNext || tipKey(preseasonNext) < tipKey(regularNext)) ? preseasonNext : regularNext;

    // ── player_trends ─────────────────────────────────────────────────────────
    // Average minutes computed in JavaScript from the raw text array to avoid
    // complex SQL parsing; keeps the SQL portable and the logic testable.

    const playerTrends = playerTrendRows.map((row: PlayerTrendRow) => {
      const minutesArr: string[] = row.minutes_texts ?? [];
      const totalMinutes = minutesArr.reduce(
        (sum, m) => sum + minutesTextToDecimal(m),
        0
      );
      const gameCount = minutesArr.length || 1;
      const minutesAvg = totalMinutes / gameCount;

      return {
        player_id: parseInt(row.player_id, 10),
        // For headshots use nba_person_id (official NBA personId):
        // https://cdn.nba.com/headshots/nba/latest/1040x760/{nba_person_id}.png
        nba_player_id: row.nba_player_id ?? null,
        nba_person_id: row.nba_person_id ?? null,
        name: row.name,
        window_games: parseInt(row.game_count, 10),
        minutes_avg: Math.round(minutesAvg * 10) / 10,
        pts_avg: Math.round(((row.pts_avg ?? 0)) * 10) / 10,
        reb_avg: Math.round(((row.reb_avg ?? 0)) * 10) / 10,
        ast_avg: Math.round(((row.ast_avg ?? 0)) * 10) / 10,
        ts_pct: row.ts_pct == null ? null : Math.round(row.ts_pct * 1000) / 1000,
      };
    });

    // ── insights ──────────────────────────────────────────────────────────────

    const insights = insightRows.map((row: InsightRow) => ({
      insight_id: row.insight_id,
      category: row.category,
      headline: row.headline,
      detail: row.detail ?? null,
      importance: row.importance,
      proof: {
        summary: row.category,
        result: row.proof_result,
      },
    }));

    // ── Response ──────────────────────────────────────────────────────────────

    // source is 'mixed' when odds data is available alongside DB data
    const hasOdds = upcomingWithOdds.some((g) => g.odds !== null);
    const source = hasOdds ? 'mixed' : 'db';

    const payload = {
      meta: { ...buildMeta(source, 300), last_sync_at: lastSyncRows[0]?.last_sync_at ?? null },
      team_snapshot: teamSnapshot,
      next_game: nextGame,
      upcoming_schedule: upcomingWithOdds,
      player_trends: playerTrends,
      insights,
    };

    return json(payload, {
      headers: {
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (err) {
    console.error('[GET /api/home] Unexpected error:', err);
    return json(
      buildError('INTERNAL_ERROR', 'An unexpected error occurred'),
      { status: 500 }
    );
  }
}
