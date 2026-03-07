// src/app/api/home/route.ts
// GET /api/home — Between-Games Dashboard endpoint.
//
// Returns team snapshot, upcoming schedule with odds, player trends, and insights.
// Implements the /api/home contract from Docs/API_SPEC.md.
// SLA: < 300ms (all DB queries run in parallel via Promise.all).

import { NextResponse } from 'next/server';
import { sql, LAC_NBA_TEAM_ID } from '@/src/lib/db';
import { buildMeta, buildError } from '@/src/lib/api-utils';
import { getLatestOdds } from '@/src/lib/odds';

// ─── Season derivation ────────────────────────────────────────────────────────
// NBA seasons span calendar years. Month < 6 means we're in the spring portion
// of the season that started the prior year.
// Example: March 2026 → season_id 2025 (the 2025-26 season).

function currentSeasonId(): number {
  const now = new Date();
  return now.getMonth() < 6
    ? now.getFullYear() - 1
    : now.getFullYear();
}

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
  name: string;
  game_count: string;
  minutes_texts: string[];
  pts_avg: number | null;
  reb_avg: number | null;
  ast_avg: number | null;
}

interface InsightRow {
  insight_id: string;
  category: string;
  headline: string;
  detail: string | null;
  importance: number;
  proof_result: unknown;
}

// ─── GET handler ──────────────────────────────────────────────────────────────

export async function GET(_req: Request): Promise<NextResponse> {
  try {
    const seasonId = currentSeasonId();

    // ── Parallel queries (all run concurrently for < 300ms SLA) ─────────────
    // Team lookup is embedded as a subquery so we never store a bigint in JS.
    // Pattern consistent with src/app/api/live/route.ts.

    const [
      teamRows,
      ratingsRows,
      last10Rows,
      recordRows,
      upcomingRows,
      playerTrendRows,
      insightRows,
    ] = await Promise.all([
      // 0: LAC team record (need abbreviation and internal id for opponent lookup)
      sql`
        SELECT team_id::text AS team_id, abbreviation
        FROM teams
        WHERE nba_team_id = ${LAC_NBA_TEAM_ID}
      ` as Promise<TeamRow[]>,

      // A: Most recent rolling_team_stats row for LAC
      sql`
        SELECT
          net_rating::float8 AS net_rating,
          off_rating::float8 AS off_rating,
          def_rating::float8 AS def_rating
        FROM rolling_team_stats
        WHERE team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
        ORDER BY as_of_game_date DESC
        LIMIT 1
      ` as Promise<RatingsRow[]>,

      // B: Last 10 LAC final games (for last_10 W/L record)
      sql`
        SELECT
          home_team_id::text AS home_team_id,
          away_team_id::text AS away_team_id,
          home_score,
          away_score
        FROM games
        WHERE (
          home_team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
          OR away_team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
        )
          AND status = 'final'
        ORDER BY game_date DESC
        LIMIT 10
      ` as Promise<GameRecordRow[]>,

      // C: Season W/L record (all final games this season)
      sql`
        SELECT
          home_team_id::text AS home_team_id,
          away_team_id::text AS away_team_id,
          home_score,
          away_score
        FROM games
        WHERE (
          home_team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
          OR away_team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
        )
          AND status = 'final'
          AND season_id = ${seasonId}
        ORDER BY game_date DESC
      ` as Promise<GameRecordRow[]>,

      // D: Upcoming schedule (future LAC games, ordered by date)
      sql`
        SELECT
          g.game_id::text AS game_id,
          g.game_date::text AS game_date,
          g.start_time_utc::text AS start_time_utc,
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
          AND g.game_date >= CURRENT_DATE
          AND g.status != 'final'
        ORDER BY g.game_date ASC
        LIMIT 10
      ` as Promise<UpcomingGameRow[]>,

      // E: Player trends — top 8 by average minutes in last 10 LAC games.
      // minutes is stored as TEXT (e.g. "34:12" or "PT34M12.00S"), so we
      // collect the raw strings and parse them in JavaScript.
      sql`
        SELECT
          p.player_id::text AS player_id,
          p.display_name AS name,
          COUNT(*)::text AS game_count,
          array_agg(gpbs.minutes ORDER BY g.game_date DESC) AS minutes_texts,
          AVG(gpbs.points)::float8 AS pts_avg,
          AVG(gpbs.rebounds)::float8 AS reb_avg,
          AVG(gpbs.assists)::float8 AS ast_avg
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
              AND status = 'final'
            ORDER BY game_date DESC LIMIT 10
          )
        GROUP BY p.player_id, p.display_name
        ORDER BY AVG(
          CASE
            WHEN gpbs.minutes ~ '^PT'
              THEN COALESCE(
                (regexp_match(gpbs.minutes, 'PT(\d+(?:\.\d+)?)M'))[1]::float8,
                0
              ) + COALESCE(
                (regexp_match(gpbs.minutes, 'M(\d+(?:\.\d+)?)S'))[1]::float8,
                0
              ) / 60
            WHEN gpbs.minutes ~ '^\d+:\d+$'
              THEN split_part(gpbs.minutes, ':', 1)::float8
                   + split_part(gpbs.minutes, ':', 2)::float8 / 60
            ELSE gpbs.minutes::float8
          END
        ) DESC NULLS LAST
        LIMIT 8
      ` as Promise<PlayerTrendRow[]>,

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
    ]);

    // ── team_snapshot ─────────────────────────────────────────────────────────

    const lacTeamRow = teamRows[0];
    if (!lacTeamRow) {
      return NextResponse.json(
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
    for (const game of last10Rows) {
      const lacIsHome = game.home_team_id === lacTeamIdStr;
      const lacScore = lacIsHome ? game.home_score : game.away_score;
      const oppScore = lacIsHome ? game.away_score : game.home_score;
      if (lacScore > oppScore) {
        last10Wins++;
      } else {
        last10Losses++;
      }
    }

    // Ratings (null if no rows)
    const ratingsRow = ratingsRows[0] ?? null;

    const teamSnapshot = {
      team_abbr: 'LAC',
      season_id: seasonId,
      record: { wins: seasonWins, losses: seasonLosses },
      conference_seed: null, // No standings table — never fabricate
      net_rating: ratingsRow?.net_rating ?? null,
      off_rating: ratingsRow?.off_rating ?? null,
      def_rating: ratingsRow?.def_rating ?? null,
      last_10: { wins: last10Wins, losses: last10Losses },
    };

    // ── upcoming_schedule ─────────────────────────────────────────────────────

    const upcomingWithOdds = await Promise.all(
      upcomingRows.map(async (game: UpcomingGameRow) => {
        const lacIsHome = game.home_team_id === lacTeamIdStr;
        const opponentAbbr = lacIsHome ? game.away_abbr : game.home_abbr;
        const homeAway = lacIsHome ? 'home' : 'away';
        const odds = await getLatestOdds(game.game_id);
        return {
          game_id: parseInt(game.game_id, 10),
          game_date: game.game_date,
          start_time_utc: game.start_time_utc,
          opponent_abbr: opponentAbbr,
          home_away: homeAway,
          status: game.status,
          odds,
        };
      })
    );

    const nextGame = upcomingWithOdds[0] ?? null;

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
        name: row.name,
        window_games: parseInt(row.game_count, 10),
        minutes_avg: Math.round(minutesAvg * 10) / 10,
        pts_avg: Math.round(((row.pts_avg ?? 0)) * 10) / 10,
        reb_avg: Math.round(((row.reb_avg ?? 0)) * 10) / 10,
        ast_avg: Math.round(((row.ast_avg ?? 0)) * 10) / 10,
        // ts_pct not stored in game_player_box_scores; available post-game in
        // advanced_player_game_stats — omitted here rather than fabricating.
        ts_pct: null,
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
      meta: buildMeta(source, 300),
      team_snapshot: teamSnapshot,
      next_game: nextGame,
      upcoming_schedule: upcomingWithOdds,
      player_trends: playerTrends,
      insights,
    };

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (err) {
    console.error('[GET /api/home] Unexpected error:', err);
    return NextResponse.json(
      buildError('INTERNAL_ERROR', 'An unexpected error occurred'),
      { status: 500 }
    );
  }
}
