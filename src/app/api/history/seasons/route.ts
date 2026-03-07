// src/app/api/history/seasons/route.ts
// GET /api/history/seasons — Available season IDs derived from the games table.
// No hardcoding — always reflects actual data in DB.

import { NextResponse } from 'next/server';
import { sql } from '../../../../lib/db.js';
import { buildMeta, buildError } from '../../../../lib/api-utils.js';

interface SeasonRow {
  season_id: number;
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

export async function GET() {
  try {
    const rows = await sql<SeasonRow[]>`
      SELECT DISTINCT season_id
      FROM games
      ORDER BY season_id ASC
    `;

    const seasons = rows.map((r) => ({
      season_id: r.season_id,
      label: seasonLabel(r.season_id),
    }));

    return NextResponse.json(
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
    return NextResponse.json(
      buildError('INTERNAL_ERROR', 'Unexpected server error'),
      { status: 500 }
    );
  }
}
