// app/api/history/games/route.ts
// GET /api/history/games — Paginated list of LAC games for a season.
// Requires season_id query param. Uses cursor pagination (base64 JSON).

import { NextResponse } from 'next/server';
import { sql, LAC_NBA_TEAM_ID } from '@/src/lib/db';
import { buildMeta, buildError } from '@/src/lib/api-utils';
import { calendarSeasonId, parseSeasonIdParam } from '@/src/lib/season';

const DEFAULT_LIMIT = 82;
const MAX_LIMIT = 200;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC_ID = /^\d+$/;

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
    const seasonId = parseSeasonIdParam(seasonIdParam);
    if (typeof seasonId !== 'number') {
      return NextResponse.json(
        buildError('BAD_REQUEST', 'season_id must be a valid integer'),
        { status: 400 }
      );
    }

    // --- Optional params ---
    const limitParam = url.searchParams.get('limit');
    const rawLimit = limitParam ? parseInt(limitParam, 10) : DEFAULT_LIMIT;
    const limit = Math.min(Math.max(isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit, 1), MAX_LIMIT);

    const cursorParam = url.searchParams.get('cursor');
    const homeAwayFilter = url.searchParams.get('home_away'); // 'home' | 'away' | null
    const resultFilter = url.searchParams.get('result');      // 'W' | 'L' | null

    if (resultFilter !== null && resultFilter !== 'W' && resultFilter !== 'L') {
      return NextResponse.json(
        buildError('BAD_REQUEST', "result must be 'W' or 'L'"),
        { status: 400 }
      );
    }

    // Decode + validate cursor before touching the DB (values are cast in SQL)
    let cursorDate: string | null = null;
    let cursorGameId: string | null = null;
    if (cursorParam) {
      try {
        const decoded = decodeCursor(cursorParam);
        if (!ISO_DATE.test(String(decoded.game_date)) || !NUMERIC_ID.test(String(decoded.game_id))) {
          throw new Error('malformed cursor');
        }
        cursorDate = decoded.game_date;
        cursorGameId = decoded.game_id;
      } catch {
        return NextResponse.json(
          buildError('BAD_REQUEST', 'Invalid cursor'),
          { status: 400 }
        );
      }
    }

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

    // All filters are applied in SQL *before* LIMIT so pages are always full
    // and next_cursor is correct (previously the W/L filter ran after slicing).
    // We fetch limit+1 rows to detect if there's a next page.
    const fetchLimit = limit + 1;

    // Keyset cursor: (game_date, game_id) < (cursor_date, cursor_id) for DESC ordering
    const cursorClause = cursorDate && cursorGameId
      ? sql`AND (g.game_date, g.game_id) < (${cursorDate}::date, ${cursorGameId}::bigint)`
      : sql``;

    const homeAwayClause =
      homeAwayFilter === 'home'
        ? sql`AND g.home_team_id = ${lacTeamId}::bigint`
        : homeAwayFilter === 'away'
          ? sql`AND g.away_team_id = ${lacTeamId}::bigint`
          : sql``;

    // W/L only exists for final games (status is lowercase 'final'; legacy rows
    // may be 'Final', hence lower()). NBA games cannot end tied, so L = not W.
    const resultClause =
      resultFilter === 'W'
        ? sql`AND lower(g.status) = 'final'
              AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
              AND (CASE WHEN g.home_team_id = ${lacTeamId}::bigint
                        THEN g.home_score > g.away_score
                        ELSE g.away_score > g.home_score END)`
        : resultFilter === 'L'
          ? sql`AND lower(g.status) = 'final'
                AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
                AND NOT (CASE WHEN g.home_team_id = ${lacTeamId}::bigint
                              THEN g.home_score > g.away_score
                              ELSE g.away_score > g.home_score END)`
          : sql``;

    const games = await sql<GameRow[]>`
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
        ${cursorClause}
        ${homeAwayClause}
        ${resultClause}
      ORDER BY g.game_date DESC, g.game_id DESC
      LIMIT ${fetchLimit}
    `;

    // Detect next page and slice
    const hasMore = games.length > limit;
    const pageGames = hasMore ? games.slice(0, limit) : games;

    // Build next_cursor from last row's game_date + game_id
    let nextCursor: string | null = null;
    if (hasMore && pageGames.length > 0) {
      const lastRow = pageGames[pageGames.length - 1];
      nextCursor = encodeCursor(lastRow.game_date, lastRow.game_id);
    }

    // Map each game to API shape
    const gameItems = pageGames.map((g) => {
      const isHome = g.home_team_id === lacTeamId;
      const homeAway: 'home' | 'away' = isHome ? 'home' : 'away';
      const opponentAbbr = isHome ? g.away_abbr : g.home_abbr;
      const lacScore = isHome ? g.home_score : g.away_score;
      const oppScore = isHome ? g.away_score : g.home_score;

      // Determine result: W/L only for final games. Status is stored lowercase
      // ('final'), with some legacy 'Final' rows — compare case-insensitively.
      // Scheduled games may have scores stored as 0 in the DB — never use those to infer W/L.
      const isFinal = g.status != null && g.status.toLowerCase() === 'final';
      let result: 'W' | 'L' | null = null;
      if (isFinal && lacScore !== null && oppScore !== null) {
        result = lacScore > oppScore ? 'W' : 'L';
      }

      return {
        game_id: g.game_id,
        game_date: g.game_date,
        opponent_abbr: opponentAbbr,
        home_away: homeAway,
        result,
        // Only surface a score for finalized games — scheduled games may have 0s stored
        final_score:
          isFinal && lacScore !== null && oppScore !== null
            ? { team: lacScore, opp: oppScore }
            : null,
        status: g.status,
      };
    });

    // Past seasons are immutable → cache for a day. The current (or a future)
    // season changes nightly as games finish → cache briefly.
    const ttlSeconds = seasonId >= calendarSeasonId() ? 300 : 86400;

    return NextResponse.json(
      {
        meta: buildMeta('db', ttlSeconds),
        games: gameItems,
        next_cursor: nextCursor,
      },
      {
        headers: { 'Cache-Control': `public, max-age=${ttlSeconds}` },
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
