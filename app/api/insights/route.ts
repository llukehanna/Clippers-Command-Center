// app/api/insights/route.ts
// GET /api/insights — Returns active insights filtered by scope.
// Powers the rotating insight tile system across all dashboard states.

import { NextResponse } from 'next/server';
import { sql } from '@/src/lib/db';
import { buildMeta, buildError } from '@/src/lib/api-utils';

const VALID_SCOPES = ['live', 'between_games', 'historical'] as const;
type InsightScope = (typeof VALID_SCOPES)[number];

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const NUMERIC_ID = /^\d+$/;

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
    const rawLimit = parseInt(url.searchParams.get('limit') ?? '10', 10);
    const limitParam = Math.min(
      Math.max(Number.isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit, 1),
      MAX_LIMIT
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

    // game_id / player_id are cast to bigint in SQL — reject non-numeric input
    // up front so bad params return 400 instead of a DB cast error (500).
    if (gameId !== null && !NUMERIC_ID.test(gameId)) {
      return NextResponse.json(
        buildError('BAD_REQUEST', 'game_id must be a numeric id'),
        { status: 400 }
      );
    }
    if (playerId !== null && !NUMERIC_ID.test(playerId)) {
      return NextResponse.json(
        buildError('BAD_REQUEST', 'player_id must be a numeric id'),
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
