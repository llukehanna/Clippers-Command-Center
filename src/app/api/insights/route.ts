// src/app/api/insights/route.ts
// GET /api/insights — Returns active insights filtered by scope.
// Powers the rotating insight tile system across all dashboard states.

import { NextResponse } from 'next/server';
import { sql } from '../../../lib/db.js';
import { buildMeta, buildError } from '../../../lib/api-utils.js';

const VALID_SCOPES = ['live', 'between_games', 'historical'] as const;
type InsightScope = (typeof VALID_SCOPES)[number];

interface InsightRow {
  insight_id: string;
  scope: InsightScope;
  category: string;
  headline: string;
  detail: string;
  importance: number;
  proof_result: Record<string, unknown>;
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const scope = url.searchParams.get('scope');
    const gameId = url.searchParams.get('game_id');
    const playerId = url.searchParams.get('player_id');
    const limitParam = Math.min(
      parseInt(url.searchParams.get('limit') ?? '10', 10) || 10,
      50
    );

    // Validate scope — required param
    if (!scope) {
      return NextResponse.json(
        buildError('BAD_REQUEST', 'scope param is required'),
        { status: 400 }
      );
    }

    if (!VALID_SCOPES.includes(scope as InsightScope)) {
      return NextResponse.json(
        buildError(
          'BAD_REQUEST',
          `scope must be one of: ${VALID_SCOPES.join(', ')}`
        ),
        { status: 400 }
      );
    }

    const rows = await sql<InsightRow[]>`
      SELECT
        insight_id::text AS insight_id,
        scope,
        category,
        headline,
        detail,
        importance,
        proof_result
      FROM insights
      WHERE is_active = true
        AND scope = ${scope}
        ${gameId ? sql`AND game_id = ${gameId}::bigint` : sql``}
        ${playerId ? sql`AND player_id = ${playerId}::bigint` : sql``}
      ORDER BY importance DESC, created_at DESC
      LIMIT ${limitParam}
    `;

    const insights = rows.map((row) => ({
      insight_id: row.insight_id,
      scope: row.scope,
      category: row.category,
      headline: row.headline,
      detail: row.detail,
      importance: row.importance,
      proof: {
        summary: row.category,
        result: row.proof_result,
      },
    }));

    return NextResponse.json(
      { meta: buildMeta('db', 30), insights },
      { headers: { 'Cache-Control': 'public, max-age=30' } }
    );
  } catch (err) {
    console.error('[GET /api/insights] Unexpected error:', err);
    return NextResponse.json(
      buildError('INTERNAL_ERROR', 'Failed to fetch insights'),
      { status: 500 }
    );
  }
}
