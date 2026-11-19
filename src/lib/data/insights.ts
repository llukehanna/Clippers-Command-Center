// src/lib/data/insights.ts — moved from app/api/insights/route.ts; the route and server pages both call loadInsights().
// app/api/insights/route.ts
// GET /api/insights — Returns active insights filtered by scope.
// Powers the rotating insight tile system across all dashboard states.

import { json, type ApiResult } from './result';
import { sql } from '@/src/lib/db';
import { buildMeta, buildError } from '@/src/lib/api-utils';
import { SURFACES, type Surface } from '../insights/types';
import { INSIGHT_ROW_COLUMNS, INSIGHT_ROW_FROM, barFilter, type InsightDbRow } from './insight-quality';

const VALID_SCOPES = ['live', 'between_games', 'historical'] as const;
type InsightScope = (typeof VALID_SCOPES)[number];

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const NUMERIC_ID = /^\d+$/;

export async function loadInsights(url: URL): Promise<ApiResult> {
  try {
    const scope = url.searchParams.get('scope');
    const surface = url.searchParams.get('surface');
    const gameId = url.searchParams.get('game_id');
    const playerId = url.searchParams.get('player_id');
    const rawLimit = parseInt(url.searchParams.get('limit') ?? '10', 10);
    const limitParam = Math.min(
      Math.max(Number.isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit, 1),
      MAX_LIMIT
    );

    // Validate scope — required param
    if (!scope && !surface) {
      return json(
        buildError('BAD_REQUEST', 'scope or surface param is required'),
        { status: 400 }
      );
    }

    if (surface !== null && !SURFACES.includes(surface as Surface)) {
      return json(
        buildError('BAD_REQUEST', `surface must be one of: ${SURFACES.join(', ')}`),
        { status: 400 }
      );
    }

    if (scope && !VALID_SCOPES.includes(scope as InsightScope)) {
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
        ${scope ? sql`AND i.scope = ${scope}` : sql``}
        ${surface ? sql`AND i.surface = ${surface}` : sql``}
        ${surface === 'player' ? sql`` : sql`AND (i.surface IS NULL OR i.surface <> 'player')`}
        ${gameId ? sql`AND i.game_id = ${gameId}::bigint` : sql``}
        ${playerId ? sql`AND i.player_id = ${playerId}::bigint` : sql``}
      ORDER BY i.importance DESC, i.created_at DESC
      LIMIT ${Math.min(limitParam * 3, MAX_LIMIT * 3)}
    `;

    // Only cards and notes are shown (Ruling 11); the SQL order (importance DESC, created_at DESC) is kept.
    const { cards, notes } = await barFilter(rows);
    const verdicts = new Map<string, 'card' | 'note'>();
    for (const r of cards) verdicts.set(r.insight_id, 'card');
    for (const r of notes) verdicts.set(r.insight_id, 'note');
    const kept = new Map([...cards, ...notes].map((r) => [r.insight_id, r]));
    const insights = rows
      .filter((r) => kept.has(r.insight_id))
      .map((r) => kept.get(r.insight_id)!)
      .slice(0, limitParam)
      .map((row) => ({
        insight_id: row.insight_id,
        scope: row.scope,
        category: row.category,
        headline: row.headline,
        detail: row.detail,
        importance: row.importance,
        surface: row.surface,
        verdict: verdicts.get(row.insight_id)!,
        frame: row.frame,
        evidence: row.evidence,
        entities: row.entities,
        updated_at: row.updated_at,
        player_id: row.player_id,
        game_id: row.game_id,
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
