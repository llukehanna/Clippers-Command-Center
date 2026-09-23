// app/api/players/route.ts
// GET /api/players — Returns the LAC roster for a season.
// players table has NO team_id column — team membership comes from
// player_team_stints (season-scoped) and, as a fallback because stints are not
// maintained by ingestion, LAC box scores in that season.
//
// Query params:
//   season_id       — season start year (e.g. 2025 = 2025-26). Defaults to the
//                     DB-derived display season (see src/lib/season.ts).
//   active_only     — default true: only players with players.is_active = true.
//                     Pass 'false' to include inactive players.
//   include_traded  — 'true': return everyone with an LAC association in the
//                     season (ignores active_only) and flag is_traded = true for
//                     players whose most recent box score that season was for
//                     another team.

import { NextResponse } from 'next/server';
import { sql, LAC_NBA_TEAM_ID } from '@/src/lib/db';
import { buildMeta, buildError } from '@/src/lib/api-utils';
import { getDisplaySeasonId, parseSeasonIdParam } from '@/src/lib/season';

interface PlayerRow {
  player_id: string;
  nba_player_id: string;
  display_name: string;
  position: string;
  is_active: boolean;
  is_traded?: boolean;
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const activeOnly = url.searchParams.get('active_only') !== 'false';
    const includeTraded = url.searchParams.get('include_traded') === 'true';

    const seasonParam = parseSeasonIdParam(url.searchParams.get('season_id'));
    if (seasonParam === null) {
      return NextResponse.json(
        buildError('BAD_REQUEST', 'season_id must be a 4-digit season start year'),
        { status: 400 }
      );
    }
    const seasonId = seasonParam ?? (await getDisplaySeasonId());

    // A player belongs to the LAC roster for a season if they have an LAC stint
    // for that season, or appeared in an LAC box score in that season.
    const lacInSeason = sql`
      (
        EXISTS (
          SELECT 1 FROM player_team_stints pts
          JOIN teams t ON pts.team_id = t.team_id
          WHERE pts.player_id = p.player_id
            AND t.nba_team_id = ${LAC_NBA_TEAM_ID}
            AND pts.season_id = ${seasonId}
        )
        OR EXISTS (
          SELECT 1 FROM game_player_box_scores gpbs
          JOIN games g ON g.game_id = gpbs.game_id
          JOIN teams t ON gpbs.team_id = t.team_id
          WHERE gpbs.player_id = p.player_id
            AND t.nba_team_id = ${LAC_NBA_TEAM_ID}
            AND g.season_id = ${seasonId}
        )
      )
    `;

    let rows: PlayerRow[];

    if (includeTraded) {
      rows = await sql<PlayerRow[]>`
        SELECT
          p.player_id::text,
          p.nba_player_id::text,
          p.display_name,
          p.position,
          p.is_active,
          COALESCE(
            (
              SELECT t.nba_team_id <> ${LAC_NBA_TEAM_ID}
              FROM game_player_box_scores gpbs
              JOIN games g ON g.game_id = gpbs.game_id
              JOIN teams t ON t.team_id = gpbs.team_id
              WHERE gpbs.player_id = p.player_id
                AND g.season_id = ${seasonId}
              ORDER BY g.game_date DESC, g.game_id DESC
              LIMIT 1
            ),
            false
          ) AS is_traded
        FROM players p
        WHERE ${lacInSeason}
        ORDER BY p.display_name ASC
      `;
    } else {
      rows = await sql<PlayerRow[]>`
        SELECT
          p.player_id::text,
          p.nba_player_id::text,
          p.display_name,
          p.position,
          p.is_active
        FROM players p
        WHERE ${lacInSeason}
          ${activeOnly ? sql`AND p.is_active = true` : sql``}
        ORDER BY p.display_name ASC
      `;
    }

    return NextResponse.json(
      {
        meta: buildMeta('db', 3600),
        season_id: seasonId,
        players: rows,
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=3600',
        },
      }
    );
  } catch (err) {
    console.error('[GET /api/players] Unexpected error:', err);
    return NextResponse.json(buildError('INTERNAL_ERROR', 'Failed to fetch players'), {
      status: 500,
    });
  }
}
