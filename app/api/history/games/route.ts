// src/app/api/history/games/route.ts
// GET /api/history/games — Paginated list of LAC games for a season.
// Requires season_id query param. Uses cursor pagination (base64 JSON).

import { NextResponse } from 'next/server';
import { sql, LAC_NBA_TEAM_ID } from '@/src/lib/db.js';
import { buildMeta, buildError } from '@/src/lib/api-utils.js';

interface TeamRow {
  team_id: string;
}

interface GameRow {
  game_id: string;
  game_date: string;
  home_team_id: string;
  away_team_id: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  home_abbr: string;
  away_abbr: string;
}

interface CursorPayload {
  game_date: string;
  game_id: string;
}

function encodeCursor(game_date: string, game_id: string): string {
  return Buffer.from(JSON.stringify({ game_date, game_id })).toString('base64');
}

function decodeCursor(cursor: string): CursorPayload {
  return JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as CursorPayload;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    // --- Required param: season_id ---
    const seasonIdParam = url.searchParams.get('season_id');
    if (!seasonIdParam) {
      return NextResponse.json(
        buildError('BAD_REQUEST', 'season_id query parameter is required'),
        { status: 400 }
      );
    }
    const seasonId = parseInt(seasonIdParam, 10);
    if (isNaN(seasonId)) {
      return NextResponse.json(
        buildError('BAD_REQUEST', 'season_id must be a valid integer'),
        { status: 400 }
      );
    }

    // --- Optional params ---
    const limitParam = url.searchParams.get('limit');
    const rawLimit = limitParam ? parseInt(limitParam, 10) : 82;
    const limit = Math.min(isNaN(rawLimit) ? 82 : rawLimit, 200);

    const cursorParam = url.searchParams.get('cursor');
    const homeAwayFilter = url.searchParams.get('home_away'); // 'home' | 'away' | null
    const resultFilter = url.searchParams.get('result');      // 'W' | 'L' | null

    // Resolve LAC internal team_id
    const [lacTeamRow] = await sql<TeamRow[]>`
      SELECT team_id::text AS team_id
      FROM teams
      WHERE nba_team_id = ${LAC_NBA_TEAM_ID}
      LIMIT 1
    `;

    if (!lacTeamRow) {
      return NextResponse.json(
        buildError('INTERNAL_ERROR', 'LAC team record not found in teams table'),
        { status: 500 }
      );
    }

    const lacTeamId = lacTeamRow.team_id;

    // Decode cursor if provided
    let cursorDate: string | null = null;
    let cursorGameId: string | null = null;
    if (cursorParam) {
      try {
        const decoded = decodeCursor(cursorParam);
        cursorDate = decoded.game_date;
        cursorGameId = decoded.game_id;
      } catch {
        return NextResponse.json(
          buildError('BAD_REQUEST', 'Invalid cursor'),
          { status: 400 }
        );
      }
    }

    // Build SQL query with optional cursor and filter clauses
    // We fetch limit+1 rows to detect if there's a next page
    const fetchLimit = limit + 1;

    let games: GameRow[];

    if (cursorDate && cursorGameId) {
      // With cursor: (game_date, game_id) < (cursor_date, cursor_id) for DESC ordering
      if (homeAwayFilter === 'home') {
        games = await sql<GameRow[]>`
          SELECT
            g.game_id::text       AS game_id,
            g.game_date::text     AS game_date,
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
          WHERE (g.home_team_id = ${lacTeamId}::bigint OR g.away_team_id = ${lacTeamId}::bigint)
            AND g.season_id = ${seasonId}
            AND (g.game_date, g.game_id) < (${cursorDate}::date, ${cursorGameId}::bigint)
            AND g.home_team_id = ${lacTeamId}::bigint
          ORDER BY g.game_date DESC, g.game_id DESC
          LIMIT ${fetchLimit}
        `;
      } else if (homeAwayFilter === 'away') {
        games = await sql<GameRow[]>`
          SELECT
            g.game_id::text       AS game_id,
            g.game_date::text     AS game_date,
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
          WHERE (g.home_team_id = ${lacTeamId}::bigint OR g.away_team_id = ${lacTeamId}::bigint)
            AND g.season_id = ${seasonId}
            AND (g.game_date, g.game_id) < (${cursorDate}::date, ${cursorGameId}::bigint)
            AND g.away_team_id = ${lacTeamId}::bigint
          ORDER BY g.game_date DESC, g.game_id DESC
          LIMIT ${fetchLimit}
        `;
      } else {
        games = await sql<GameRow[]>`
          SELECT
            g.game_id::text       AS game_id,
            g.game_date::text     AS game_date,
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
          WHERE (g.home_team_id = ${lacTeamId}::bigint OR g.away_team_id = ${lacTeamId}::bigint)
            AND g.season_id = ${seasonId}
            AND (g.game_date, g.game_id) < (${cursorDate}::date, ${cursorGameId}::bigint)
          ORDER BY g.game_date DESC, g.game_id DESC
          LIMIT ${fetchLimit}
        `;
      }
    } else {
      // No cursor — first page
      if (homeAwayFilter === 'home') {
        games = await sql<GameRow[]>`
          SELECT
            g.game_id::text       AS game_id,
            g.game_date::text     AS game_date,
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
          WHERE (g.home_team_id = ${lacTeamId}::bigint OR g.away_team_id = ${lacTeamId}::bigint)
            AND g.season_id = ${seasonId}
            AND g.home_team_id = ${lacTeamId}::bigint
          ORDER BY g.game_date DESC, g.game_id DESC
          LIMIT ${fetchLimit}
        `;
      } else if (homeAwayFilter === 'away') {
        games = await sql<GameRow[]>`
          SELECT
            g.game_id::text       AS game_id,
            g.game_date::text     AS game_date,
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
          WHERE (g.home_team_id = ${lacTeamId}::bigint OR g.away_team_id = ${lacTeamId}::bigint)
            AND g.season_id = ${seasonId}
            AND g.away_team_id = ${lacTeamId}::bigint
          ORDER BY g.game_date DESC, g.game_id DESC
          LIMIT ${fetchLimit}
        `;
      } else {
        games = await sql<GameRow[]>`
          SELECT
            g.game_id::text       AS game_id,
            g.game_date::text     AS game_date,
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
          WHERE (g.home_team_id = ${lacTeamId}::bigint OR g.away_team_id = ${lacTeamId}::bigint)
            AND g.season_id = ${seasonId}
          ORDER BY g.game_date DESC, g.game_id DESC
          LIMIT ${fetchLimit}
        `;
      }
    }

    // Detect next page and slice
    const hasMore = games.length > limit;
    const pageGames = hasMore ? games.slice(0, limit) : games;

    // Build next_cursor from last row's game_date + game_id
    let nextCursor: string | null = null;
    if (hasMore && pageGames.length > 0) {
      const lastRow = pageGames[pageGames.length - 1];
      nextCursor = encodeCursor(lastRow.game_date, lastRow.game_id);
    }

    // Map each game to API shape, applying result filter if needed
    const gameItems = pageGames
      .map((g) => {
        const isHome = g.home_team_id === lacTeamId;
        const homeAway: 'home' | 'away' = isHome ? 'home' : 'away';
        const opponentAbbr = isHome ? g.away_abbr : g.home_abbr;
        const lacScore = isHome ? g.home_score : g.away_score;
        const oppScore = isHome ? g.away_score : g.home_score;

        // Determine result: W/L based on scores (null if game not final or scores absent)
        let result: 'W' | 'L' | null = null;
        if (lacScore !== null && oppScore !== null) {
          result = lacScore > oppScore ? 'W' : 'L';
        }

        return {
          game_id: g.game_id,
          game_date: g.game_date,
          opponent_abbr: opponentAbbr,
          home_away: homeAway,
          result,
          final_score:
            lacScore !== null && oppScore !== null
              ? { team: lacScore, opp: oppScore }
              : null,
          status: g.status,
        };
      })
      // Apply result filter AFTER mapping (filter param doesn't affect SQL for simplicity)
      .filter((g) => {
        if (!resultFilter) return true;
        return g.result === resultFilter;
      });

    return NextResponse.json(
      {
        meta: buildMeta('db', 86400),
        games: gameItems,
        next_cursor: nextCursor,
      },
      {
        headers: { 'Cache-Control': 'public, max-age=86400' },
      }
    );
  } catch (err) {
    console.error('[GET /api/history/games]', err);
    return NextResponse.json(
      buildError('INTERNAL_ERROR', 'Unexpected server error'),
      { status: 500 }
    );
  }
}
