// src/app/api/players/route.ts
// GET /api/players — Returns the LAC roster, filtered via player_team_stints.
// players table has NO team_id column — team membership comes from player_team_stints.

import { NextResponse } from 'next/server';
import { sql, LAC_NBA_TEAM_ID } from '@/src/lib/db';
import { buildMeta, buildError } from '@/src/lib/api-utils';

function getSeasonStartDate(): string {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed: January = 0, June = 5
  const year = month < 6 ? now.getFullYear() - 1 : now.getFullYear();
  return `${year}-10-01`;
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const activeOnly = url.searchParams.get('active_only') !== 'false';
    const includeTraded = url.searchParams.get('include_traded') === 'true';

    let rows: Array<{
      player_id: string;
      nba_player_id: string;
      display_name: string;
      position: string;
      is_active: boolean;
      is_traded?: boolean;
    }>;

    if (includeTraded) {
      const seasonStart = getSeasonStartDate();
      rows = await sql<
        Array<{
          player_id: string;
          nba_player_id: string;
          display_name: string;
          position: string;
          is_active: boolean;
          is_traded: boolean;
        }>
      >`
        SELECT DISTINCT
          p.player_id::text,
          p.nba_player_id::text,
          p.display_name,
          p.position,
          p.is_active,
          NOT p.is_active AS is_traded
        FROM players p
        WHERE EXISTS (
          SELECT 1 FROM player_team_stints pts
          JOIN teams t ON pts.team_id = t.team_id
          WHERE pts.player_id = p.player_id
            AND t.nba_team_id = ${LAC_NBA_TEAM_ID}
            AND pts.start_date >= ${seasonStart}
        )
        ORDER BY p.display_name ASC
      `;
    } else if (activeOnly) {
      rows = await sql<
        Array<{
          player_id: string;
          nba_player_id: string;
          display_name: string;
          position: string;
          is_active: boolean;
        }>
      >`
        SELECT DISTINCT
          p.player_id::text,
          p.nba_player_id::text,
          p.display_name,
          p.position,
          p.is_active
        FROM players p
        WHERE EXISTS (
          SELECT 1 FROM player_team_stints pts
          JOIN teams t ON pts.team_id = t.team_id
          WHERE pts.player_id = p.player_id
            AND t.nba_team_id = ${LAC_NBA_TEAM_ID}
        )
        AND p.is_active = true
        ORDER BY p.display_name ASC
      `;
    } else {
      rows = await sql<
        Array<{
          player_id: string;
          nba_player_id: string;
          display_name: string;
          position: string;
          is_active: boolean;
        }>
      >`
        SELECT DISTINCT
          p.player_id::text,
          p.nba_player_id::text,
          p.display_name,
          p.position,
          p.is_active
        FROM players p
        WHERE EXISTS (
          SELECT 1 FROM player_team_stints pts
          JOIN teams t ON pts.team_id = t.team_id
          WHERE pts.player_id = p.player_id
            AND t.nba_team_id = ${LAC_NBA_TEAM_ID}
        )
        ORDER BY p.display_name ASC
      `;
    }

    return NextResponse.json(
      {
        meta: buildMeta('db', 3600),
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
