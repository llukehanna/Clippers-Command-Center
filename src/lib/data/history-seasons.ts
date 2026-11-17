// src/lib/data/history-seasons.ts — moved from app/api/history/seasons/route.ts; the route and server pages both call loadHistorySeasons().
// app/api/history/seasons/route.ts
// GET /api/history/seasons — Seasons with at least one final LAC game, derived from the games table.
// No hardcoding — always reflects actual data in DB.

import { json, type ApiResult } from './result';
import { sql, LAC_NBA_TEAM_ID } from '@/src/lib/db';
import { buildMeta, buildError } from '@/src/lib/api-utils';

interface SeasonRow {
  season_id: number;
  team_name: string;
}

/**
 * Map a numeric season_id to a human-readable label.
 * E.g. 2024 → "2024-25", 2023 → "2023-24"
 */
function seasonLabel(seasonId: number): string {
  const next = seasonId + 1;
  const suffix = String(next).slice(-2);
  return `${seasonId}-${suffix}`;
}

export async function loadHistorySeasons(): Promise<ApiResult> {
  try {
    // Only seasons with at least one final LAC game — a freshly synced
    // schedule for an upcoming season must not become the (empty) default.
    const rows = await sql<SeasonRow[]>`
      SELECT DISTINCT g.season_id,
             COALESCE(e.city || ' ' || e.name, t.city || ' ' || t.name) AS team_name
      FROM games g
      JOIN teams t ON t.nba_team_id = ${LAC_NBA_TEAM_ID}
      LEFT JOIN team_era_names e ON e.team_id = t.team_id
       AND g.season_id >= e.first_season_id
       AND (e.last_season_id IS NULL OR g.season_id <= e.last_season_id)
      WHERE (g.home_team_id = t.team_id OR g.away_team_id = t.team_id)
        AND lower(g.status) = 'final'
        AND g.season_id IS NOT NULL
      ORDER BY g.season_id ASC
    `;

    const seasons = rows.map((r) => ({
      season_id: r.season_id,
      label: seasonLabel(r.season_id),
      team_name: r.team_name,
    }));

    return json(
      {
        meta: buildMeta('db', 86400),
        seasons,
      },
      {
        headers: { 'Cache-Control': 'public, max-age=86400' },
      }
    );
  } catch (err) {
    console.error('[GET /api/history/seasons]', err);
    return json(
      buildError('INTERNAL_ERROR', 'Unexpected server error'),
      { status: 500 }
    );
  }
}
