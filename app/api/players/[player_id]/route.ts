// src/app/api/players/[player_id]/route.ts
// GET /api/players/{player_id} — Player detail with trend summary, charts, splits, and game log.

import { NextResponse } from 'next/server';
import { sql } from '@/src/lib/db.js';
import { buildMeta, buildError } from '@/src/lib/api-utils.js';

type RollingRow = {
  window_games: number;
  as_of_game_date: string;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  ts_pct: number | null;
  efg_pct: number | null;
  minutes: number | null;
};

type BoxScoreRow = {
  game_id: string;
  game_date: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  player_team_id: string;
  opp_abbreviation: string;
  minutes: string | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  fg_made: number | null;
  fg_attempted: number | null;
  fg3_made: number | null;
  fg3_attempted: number | null;
  ft_made: number | null;
  ft_attempted: number | null;
  plus_minus: number | null;
};

type SplitAgg = {
  pts_avg: number | null;
  ts_pct: number | null;
};

function computeSplits(rows: BoxScoreRowWithTs[]): {
  home: SplitAgg;
  away: SplitAgg;
  wins: SplitAgg;
  losses: SplitAgg;
} | null {
  if (rows.length === 0) return null;

  function avg(values: (number | null)[]): number | null {
    const nums = values.filter((v): v is number => v !== null);
    if (nums.length === 0) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  const homeRows = rows.filter((r) => r.player_team_id === r.home_team_id);
  const awayRows = rows.filter((r) => r.player_team_id === r.away_team_id);
  const winRows = rows.filter((r) => {
    const isHome = r.player_team_id === r.home_team_id;
    const homeWon =
      r.home_score !== null && r.away_score !== null && r.home_score > r.away_score;
    const awayWon =
      r.home_score !== null && r.away_score !== null && r.away_score > r.home_score;
    return isHome ? homeWon : awayWon;
  });
  const lossRows = rows.filter((r) => {
    const isHome = r.player_team_id === r.home_team_id;
    const homeWon =
      r.home_score !== null && r.away_score !== null && r.home_score > r.away_score;
    const awayWon =
      r.home_score !== null && r.away_score !== null && r.away_score > r.home_score;
    return isHome ? !homeWon : !awayWon;
  });

  return {
    home: {
      pts_avg: avg(homeRows.map((r) => r.points)),
      ts_pct: avg(homeRows.map((r) => r.ts_pct_computed)),
    },
    away: {
      pts_avg: avg(awayRows.map((r) => r.points)),
      ts_pct: avg(awayRows.map((r) => r.ts_pct_computed)),
    },
    wins: {
      pts_avg: avg(winRows.map((r) => r.points)),
      ts_pct: avg(winRows.map((r) => r.ts_pct_computed)),
    },
    losses: {
      pts_avg: avg(lossRows.map((r) => r.points)),
      ts_pct: avg(lossRows.map((r) => r.ts_pct_computed)),
    },
  };
}

// Extended BoxScoreRow with computed ts_pct
type BoxScoreRowWithTs = BoxScoreRow & { ts_pct_computed: number | null };

function computeTs(row: BoxScoreRow): number | null {
  const pts = row.points ?? 0;
  const fga = row.fg_attempted ?? 0;
  const fta = row.ft_attempted ?? 0;
  const tsa = fga + 0.44 * fta;
  if (tsa === 0) return null;
  return pts / (2 * tsa);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ player_id: string }> }
): Promise<NextResponse> {
  try {
    const { player_id } = await params;
    // Validate player_id is a numeric string
    if (!/^\d+$/.test(player_id)) {
      return NextResponse.json(buildError('NOT_FOUND', 'Player not found'), { status: 404 });
    }

    // 1. Fetch the player
    const playerRows = await sql<
      Array<{ player_id: string; display_name: string; position: string | null }>
    >`
      SELECT
        player_id::text,
        display_name,
        position
      FROM players
      WHERE player_id = ${player_id}::bigint
    `;

    if (playerRows.length === 0) {
      return NextResponse.json(buildError('NOT_FOUND', 'Player not found'), { status: 404 });
    }

    const player = playerRows[0];

    // 2. Run parallel queries
    const [trendRows, chartRows, boxScoreRows] = await Promise.all([
      // A: Latest rolling stats (window=10) for trend summary
      sql<Array<RollingRow>>`
        SELECT
          window_games,
          as_of_game_date::text,
          points::float8    AS points,
          rebounds::float8  AS rebounds,
          assists::float8   AS assists,
          ts_pct::float8    AS ts_pct,
          efg_pct::float8   AS efg_pct,
          minutes::float8   AS minutes
        FROM rolling_player_stats
        WHERE player_id = ${player_id}::bigint
          AND window_games = 10
        ORDER BY as_of_game_date DESC
        LIMIT 1
      `,

      // B: All rolling stats for charts (ascending date)
      sql<Array<RollingRow>>`
        SELECT
          window_games,
          as_of_game_date::text,
          points::float8    AS points,
          rebounds::float8  AS rebounds,
          assists::float8   AS assists,
          ts_pct::float8    AS ts_pct,
          efg_pct::float8   AS efg_pct,
          minutes::float8   AS minutes
        FROM rolling_player_stats
        WHERE player_id = ${player_id}::bigint
        ORDER BY as_of_game_date ASC
      `,

      // C: Last 25 game log rows with game/team context
      sql<Array<BoxScoreRow>>`
        SELECT
          gpbs.game_id::text,
          g.game_date::text,
          g.home_team_id::text,
          g.away_team_id::text,
          g.home_score,
          g.away_score,
          gpbs.team_id::text  AS player_team_id,
          opp.abbreviation    AS opp_abbreviation,
          gpbs.minutes,
          gpbs.points,
          gpbs.rebounds,
          gpbs.assists,
          gpbs.steals,
          gpbs.blocks,
          gpbs.turnovers,
          gpbs.fg_made,
          gpbs.fg_attempted,
          gpbs.fg3_made,
          gpbs.fg3_attempted,
          gpbs.ft_made,
          gpbs.ft_attempted,
          gpbs.plus_minus
        FROM game_player_box_scores gpbs
        JOIN games g ON g.game_id = gpbs.game_id
        JOIN teams opp ON opp.team_id = (
          CASE
            WHEN gpbs.team_id = g.home_team_id THEN g.away_team_id
            ELSE g.home_team_id
          END
        )
        WHERE gpbs.player_id = ${player_id}::bigint
        ORDER BY g.game_date DESC
        LIMIT 25
      `,
    ]);

    // 3. Build trend_summary
    const trendSummary =
      trendRows.length === 0
        ? null
        : {
            window_games: trendRows[0].window_games,
            minutes_avg: trendRows[0].minutes,
            pts_avg: trendRows[0].points,
            reb_avg: trendRows[0].rebounds,
            ast_avg: trendRows[0].assists,
            ts_pct: trendRows[0].ts_pct,
            efg_pct: trendRows[0].efg_pct,
          };

    // 4. Build charts — empty arrays when no data, NEVER zeroes
    const charts = {
      rolling_pts: chartRows.map((r) => ({
        game_date: r.as_of_game_date,
        value: r.points,
      })),
      rolling_ts: chartRows.map((r) => ({
        game_date: r.as_of_game_date,
        value: r.ts_pct,
      })),
    };

    // 5. Build splits — compute ts_pct from raw shooting stats
    const boxScoreRowsWithTs: BoxScoreRowWithTs[] = boxScoreRows.map((r) => ({
      ...r,
      ts_pct_computed: computeTs(r),
    }));
    const splits = computeSplits(boxScoreRowsWithTs);

    // 6. Build game log
    const gameLog = boxScoreRows.map((r) => {
      const isHome = r.player_team_id === r.home_team_id;
      return {
        game_id: r.game_id,
        game_date: r.game_date,
        opp: r.opp_abbreviation,
        home_away: isHome ? 'home' : 'away',
        MIN: r.minutes ?? '',
        PTS: r.points ?? 0,
        REB: r.rebounds ?? 0,
        AST: r.assists ?? 0,
        FG: `${r.fg_made ?? 0}-${r.fg_attempted ?? 0}`,
        '3PT': `${r.fg3_made ?? 0}-${r.fg3_attempted ?? 0}`,
        FT: `${r.ft_made ?? 0}-${r.ft_attempted ?? 0}`,
        '+/-': r.plus_minus ?? 0,
      };
    });

    return NextResponse.json(
      {
        meta: buildMeta('mixed', 600),
        player,
        trend_summary: trendSummary,
        charts,
        splits,
        game_log: gameLog,
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=600',
        },
      }
    );
  } catch (err) {
    console.error('[GET /api/players/{player_id}] Unexpected error:', err);
    return NextResponse.json(buildError('INTERNAL_ERROR', 'Failed to fetch player detail'), {
      status: 500,
    });
  }
}
