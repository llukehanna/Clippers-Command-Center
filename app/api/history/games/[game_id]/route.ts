// src/app/api/history/games/[game_id]/route.ts
// GET /api/history/games/{game_id} — Game detail with box score and insights.
// Box score available:false for pre-Phase-7 games (no game_player_box_scores rows).
// Insights queried from `insights` table (NOT `generated_insights`).

import { NextResponse } from 'next/server';
import { sql } from '@/src/lib/db';
import { buildMeta, buildError } from '@/src/lib/api-utils';

// Box score stat columns as defined by API_SPEC.md
const BOX_SCORE_COLUMNS = ['MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', 'FG', '3PT', 'FT', '+/-'];

interface GameDetailRow {
  game_id: string;
  game_date: string;
  season_id: number;
  home_team_id: string;
  away_team_id: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  home_abbr: string;
  away_abbr: string;
}

interface BoxScoreCountRow {
  cnt: number;
}

interface PlayerBoxRow {
  player_id: string;
  display_name: string;
  team_id: string;
  minutes: string | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  plus_minus: number | null;
  fg_made: number | null;
  fg_attempted: number | null;
  fg3_made: number | null;
  fg3_attempted: number | null;
  ft_made: number | null;
  ft_attempted: number | null;
}

interface InsightRow {
  insight_id: string;
  scope: string;
  category: string;
  headline: string;
  detail: string;
  importance: number;
  proof_result: unknown;
}

function formatFraction(made: number | null, att: number | null): string {
  return `${made ?? 0}-${att ?? 0}`;
}

function buildTeamTotals(players: PlayerBoxRow[]): Record<string, unknown> {
  const pts = players.reduce((sum, p) => sum + (p.points ?? 0), 0);
  const reb = players.reduce((sum, p) => sum + (p.rebounds ?? 0), 0);
  const ast = players.reduce((sum, p) => sum + (p.assists ?? 0), 0);
  const to = players.reduce((sum, p) => sum + (p.turnovers ?? 0), 0);
  const fgMade = players.reduce((sum, p) => sum + (p.fg_made ?? 0), 0);
  const fgAtt = players.reduce((sum, p) => sum + (p.fg_attempted ?? 0), 0);
  const fg3Made = players.reduce((sum, p) => sum + (p.fg3_made ?? 0), 0);
  const fg3Att = players.reduce((sum, p) => sum + (p.fg3_attempted ?? 0), 0);
  const ftMade = players.reduce((sum, p) => sum + (p.ft_made ?? 0), 0);
  const ftAtt = players.reduce((sum, p) => sum + (p.ft_attempted ?? 0), 0);

  return {
    PTS: pts,
    REB: reb,
    AST: ast,
    TO: to,
    FG: formatFraction(fgMade, fgAtt),
    '3PT': formatFraction(fg3Made, fg3Att),
    FT: formatFraction(ftMade, ftAtt),
  };
}

function mapPlayerRow(p: PlayerBoxRow) {
  return {
    id: p.player_id,          // Required by BoxScoreRow interface (used as React key)
    player_id: p.player_id,
    name: p.display_name,
    MIN: p.minutes ?? null,
    PTS: p.points ?? null,
    REB: p.rebounds ?? null,
    AST: p.assists ?? null,
    STL: p.steals ?? null,
    BLK: p.blocks ?? null,
    TO: p.turnovers ?? null,
    FG: formatFraction(p.fg_made, p.fg_attempted),
    '3PT': formatFraction(p.fg3_made, p.fg3_attempted),
    FT: formatFraction(p.ft_made, p.ft_attempted),
    '+/-': p.plus_minus ?? null,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ game_id: string }> }
) {
  try {
    const { game_id: gameIdParam } = await params;

    // Validate game_id is a valid bigint-like value
    const gameIdNum = parseInt(gameIdParam, 10);
    if (isNaN(gameIdNum) || String(gameIdNum) !== gameIdParam) {
      return NextResponse.json(
        buildError('BAD_REQUEST', 'game_id must be a valid integer'),
        { status: 400 }
      );
    }

    // Fetch game with team abbreviations
    const [game] = await sql<GameDetailRow[]>`
      SELECT
        g.game_id::text       AS game_id,
        g.game_date::text     AS game_date,
        g.season_id,
        g.home_team_id::text  AS home_team_id,
        g.away_team_id::text  AS away_team_id,
        g.status,
        g.home_score,
        g.away_score,
        ht.abbreviation       AS home_abbr,
        at.abbreviation       AS away_abbr
      FROM games g
      JOIN teams ht ON g.home_team_id = ht.team_id
      JOIN teams at ON g.away_team_id = at.team_id
      WHERE g.game_id = ${gameIdParam}::bigint
      LIMIT 1
    `;

    if (!game) {
      return NextResponse.json(
        buildError('NOT_FOUND', `Game ${gameIdParam} not found`),
        { status: 404 }
      );
    }

    // Check box score availability: any rows in game_player_box_scores for this game?
    const [countRow] = await sql<BoxScoreCountRow[]>`
      SELECT COUNT(*)::int AS cnt
      FROM game_player_box_scores
      WHERE game_id = ${gameIdParam}::bigint
    `;
    const available = (countRow?.cnt ?? 0) > 0;

    let boxScore: {
      columns: string[];
      teams: Array<{
        team_abbr: string;
        players: ReturnType<typeof mapPlayerRow>[];
        totals: Record<string, unknown>;
      }>;
      available: boolean;
    };

    if (available) {
      // Fetch all player box score rows for this game
      const playerRows = await sql<PlayerBoxRow[]>`
        SELECT
          p.player_id::text  AS player_id,
          p.display_name,
          pbs.team_id::text  AS team_id,
          pbs.minutes,
          pbs.points,
          pbs.rebounds,
          pbs.assists,
          pbs.steals,
          pbs.blocks,
          pbs.turnovers,
          pbs.plus_minus,
          pbs.fg_made,
          pbs.fg_attempted,
          pbs.fg3_made,
          pbs.fg3_attempted,
          pbs.ft_made,
          pbs.ft_attempted
        FROM game_player_box_scores pbs
        JOIN players p ON pbs.player_id = p.player_id
        WHERE pbs.game_id = ${gameIdParam}::bigint
        ORDER BY pbs.team_id, pbs.points DESC NULLS LAST
      `;

      // Split players by team
      const homePlayers = playerRows.filter((p) => p.team_id === game.home_team_id);
      const awayPlayers = playerRows.filter((p) => p.team_id === game.away_team_id);

      boxScore = {
        columns: BOX_SCORE_COLUMNS,
        teams: [
          {
            team_abbr: game.home_abbr,
            players: homePlayers.map(mapPlayerRow),
            totals: buildTeamTotals(homePlayers),
          },
          {
            team_abbr: game.away_abbr,
            players: awayPlayers.map(mapPlayerRow),
            totals: buildTeamTotals(awayPlayers),
          },
        ],
        available: true,
      };
    } else {
      // Pre-Phase-7 game: no box score data available
      boxScore = {
        columns: BOX_SCORE_COLUMNS,
        teams: [
          { team_abbr: game.home_abbr, players: [], totals: {} },
          { team_abbr: game.away_abbr, players: [], totals: {} },
        ],
        available: false,
      };
    }

    // Query insights from `insights` table (NOT `generated_insights`)
    const insightRows = await sql<InsightRow[]>`
      SELECT
        insight_id::text  AS insight_id,
        scope,
        category,
        headline,
        detail,
        importance,
        proof_result
      FROM insights
      WHERE game_id = ${gameIdParam}::bigint
        AND is_active = true
      ORDER BY importance DESC
    `;

    const insights = insightRows.map((r) => ({
      insight_id: r.insight_id,
      headline: r.headline,
      detail: r.detail,
      importance: r.importance,
      proof: {
        summary: r.category,
        result: r.proof_result,
      },
    }));

    return NextResponse.json(
      {
        meta: buildMeta('mixed', 86400),
        game: {
          game_id: game.game_id,
          game_date: game.game_date,
          season_id: game.season_id,
          home_team: { team_id: game.home_team_id, abbreviation: game.home_abbr },
          away_team: { team_id: game.away_team_id, abbreviation: game.away_abbr },
          status: game.status,
          home_score: game.home_score,
          away_score: game.away_score,
        },
        box_score: boxScore,
        insights,
      },
      {
        headers: { 'Cache-Control': 'public, max-age=86400' },
      }
    );
  } catch (err) {
    console.error('[GET /api/history/games/[game_id]]', err);
    return NextResponse.json(
      buildError('INTERNAL_ERROR', 'Unexpected server error'),
      { status: 500 }
    );
  }
}
