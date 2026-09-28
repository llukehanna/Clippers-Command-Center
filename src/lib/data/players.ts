// src/lib/data/players.ts — moved from app/api/players/route.ts; the route and server pages both call loadPlayers().
// app/api/players/route.ts
// GET /api/players — Returns the LAC roster for a season.
// players table has NO team_id column — team membership comes from LAC box
// scores and player_team_stints (written by finalization for every team).
//
// Query params:
//   season_id       — season start year (e.g. 2025 = 2025-26). Defaults to the
//                     DB-derived display season (see src/lib/season.ts).
//   active_only     — default true: only players with players.is_active = true.
//                     Pass 'false' to include inactive players.
//   include_traded  — 'true': return everyone with an LAC association in the
//                     season (ignores active_only) and flag is_traded = true for
//                     players whose most recent game/stint that season was with
//                     another team.

import { json, type ApiResult } from './result';
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

export async function loadPlayers(url: URL): Promise<ApiResult> {
  try {
        const activeOnly = url.searchParams.get('active_only') !== 'false';
    const includeTraded = url.searchParams.get('include_traded') === 'true';

    const seasonParam = parseSeasonIdParam(url.searchParams.get('season_id'));
    if (seasonParam === null) {
      return json(
        buildError('BAD_REQUEST', 'season_id must be a 4-digit season start year'),
        { status: 400 }
      );
    }
    const seasonId = seasonParam ?? (await getDisplaySeasonId());

    // Roster = players with any LAC association in the season (box score or
    // stint) whose MOST RECENT event that season — a game played, or a stint
    // start (finalization records LAC players who sat out, too) — was with LAC.
    // Players traded away drop off (or are flagged with include_traded);
    // players acquired mid-season are included. Starts from LAC's own rows,
    // so it never scans the whole league.
    const rows = await sql<PlayerRow[]>`
      WITH lac AS (
        SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID}
      ), candidates AS (
        SELECT pb.player_id
        FROM game_player_box_scores pb
        JOIN games g ON g.game_id = pb.game_id
        WHERE pb.team_id = (SELECT team_id FROM lac) AND g.season_id = ${seasonId}
        UNION
        SELECT s.player_id
        FROM player_team_stints s
        WHERE s.team_id = (SELECT team_id FROM lac) AND s.season_id = ${seasonId}
      ), events AS (
        SELECT pb.player_id, pb.team_id, g.game_date AS event_date, 1 AS priority
        FROM game_player_box_scores pb
        JOIN games g ON g.game_id = pb.game_id
        WHERE g.season_id = ${seasonId} AND pb.player_id IN (SELECT player_id FROM candidates)
        UNION ALL
        SELECT s.player_id, s.team_id, s.start_date, 0
        FROM player_team_stints s
        WHERE s.season_id = ${seasonId} AND s.start_date IS NOT NULL
          AND s.player_id IN (SELECT player_id FROM candidates)
      ), latest AS (
        SELECT DISTINCT ON (player_id) player_id, team_id
        FROM events
        ORDER BY player_id, event_date DESC, priority DESC
      )
      SELECT
        p.player_id::text,
        p.nba_player_id::text,
        p.display_name,
        p.position,
        p.is_active,
        (COALESCE(l.team_id, (SELECT team_id FROM lac)) <> (SELECT team_id FROM lac)) AS is_traded
      FROM candidates c
      JOIN players p ON p.player_id = c.player_id
      LEFT JOIN latest l ON l.player_id = c.player_id
      ORDER BY p.display_name ASC
    `;

    const roster = rows.filter((r) =>
      includeTraded ? true : !r.is_traded && (!activeOnly || r.is_active)
    );
    if (!includeTraded) for (const r of roster) delete r.is_traded;

    return json(
      {
        meta: buildMeta('db', 3600),
        season_id: seasonId,
        players: roster,
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=3600',
        },
      }
    );
  } catch (err) {
    console.error('[GET /api/players] Unexpected error:', err);
    return json(buildError('INTERNAL_ERROR', 'Failed to fetch players'), {
      status: 500,
    });
  }
}
