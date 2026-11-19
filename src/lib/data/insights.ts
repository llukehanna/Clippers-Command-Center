// src/lib/data/insights.ts — moved from app/api/insights/route.ts; the route and server pages both call loadInsights().
// app/api/insights/route.ts
// GET /api/insights — Returns active insights filtered by scope.
// Powers the rotating insight tile system across all dashboard states.

import { json, type ApiResult } from './result';
import { sql } from '@/src/lib/db';
import { buildMeta, buildError } from '@/src/lib/api-utils';
import { INSIGHT_ROW_COLUMNS, INSIGHT_ROW_FROM, barFilter, type InsightDbRow } from './insight-quality';

const VALID_SCOPES = ['live', 'between_games', 'historical'] as const;
type InsightScope = (typeof VALID_SCOPES)[number];

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const NUMERIC_ID = /^\d+$/;

export async function loadInsights(url: URL): Promise<ApiResult> {
  try {
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
      return json(
        buildError('BAD_REQUEST', 'scope param is required'),
        { status: 400 }
      );
    }

    if (!VALID_SCOPES.includes(scope as InsightScope)) {
      return json(
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
      return json(
        buildError('BAD_REQUEST', 'game_id must be a numeric id'),
        { status: 400 }
      );
    }
    if (playerId !== null && !NUMERIC_ID.test(playerId)) {
      return json(
        buildError('BAD_REQUEST', 'player_id must be a numeric id'),
        { status: 400 }
      );
    }

    // Over-fetch 3x: the quality bar drops tags, merges and cuts, and the page still wants `limit` rows.
    const rows = await sql<InsightDbRow[]>`
      SELECT ${sql.unsafe(INSIGHT_ROW_COLUMNS)}
      FROM ${sql.unsafe(INSIGHT_ROW_FROM)}
      WHERE i.is_active = true
        AND i.scope = ${scope}
        AND (i.surface IS NULL OR i.surface <> 'player')
        ${gameId ? sql`AND i.game_id = ${gameId}::bigint` : sql``}
        ${playerId ? sql`AND i.player_id = ${playerId}::bigint` : sql``}
      ORDER BY i.importance DESC, i.created_at DESC
      LIMIT ${Math.min(limitParam * 3, MAX_LIMIT * 3)}
    `;

    // Only cards and notes are shown (Ruling 11); query order is importance DESC, so a stable sort keeps ties.
    const { cards, notes } = await barFilter(rows);
    const insights = [...cards, ...notes]
      .sort((a, b) => b.importance - a.importance)
      .slice(0, limitParam)
      .map((row) => ({
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

    return json(
      { meta: buildMeta('db', 30), insights },
      { headers: { 'Cache-Control': 'public, max-age=30' } }
    );
  } catch (err) {
    console.error('[GET /api/insights] Unexpected error:', err);
    return json(
      buildError('INTERNAL_ERROR', 'Failed to fetch insights'),
      { status: 500 }
    );
  }
}
