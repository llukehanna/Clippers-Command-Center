// scripts/lib/insights/engine/store.ts
// insights writes for the v2 engine (spec §2.8): upsert by key, scoped stale
// deactivation, and the one-time clean cut of legacy rows.
import type { FrameType, Surface } from '../../../../src/lib/insights/types';
import { sql } from '../../db.js';
import type { InsightDraft, PriorState } from './types.js';

type Json = Parameters<typeof sql.json>[0];
const json = (v: unknown) => sql.json(v as Json);
const big = (v: string | null) => (v !== null ? sql`${v}::bigint` : null);

/** Stored state per key for novelty (first emission and how long the claim has been unchanged). */
export async function loadPrior(): Promise<Map<string, PriorState>> {
  const rows = await sql<{ proof_hash: string; first: string; headline: string; frame_type: string | null; unchanged_since: string | null }[]>`
    SELECT proof_hash,
           (first_emitted_at AT TIME ZONE 'America/Los_Angeles')::date::text AS first,
           headline, frame->>'type' AS frame_type, score_parts->>'unchanged_since' AS unchanged_since
    FROM insights
    WHERE surface IS NOT NULL AND proof_hash IS NOT NULL AND first_emitted_at IS NOT NULL`;
  return new Map(rows.map((r) => [r.proof_hash, {
    firstEmittedAt: r.first, headline: r.headline, frameType: r.frame_type as FrameType | null, unchangedSince: r.unchanged_since,
  }]));
}

export async function upsertInsight(d: InsightDraft): Promise<void> {
  await sql`
    INSERT INTO insights (
      scope, surface, team_id, game_id, player_id, season_id, category, headline, detail, importance,
      proof_sql, proof_params, proof_result, proof_hash, frame, evidence, entities, score_parts, first_emitted_at
    ) VALUES (
      ${d.scope}, ${d.surface}, ${big(d.team_id)}, ${big(d.game_id)}, ${big(d.player_id)}, ${d.season_id},
      ${d.category}, ${d.headline}, ${d.detail}, ${d.importance},
      ${d.proof_sql}, ${json(d.proof_params)}, ${json(d.proof_result)}, ${d.key},
      ${json(d.frame)}, ${d.evidence ? json(d.evidence) : null}, ${json(d.entities)}, ${json(d.score_parts)}, now()
    )
    ON CONFLICT (proof_hash) WHERE proof_hash IS NOT NULL DO UPDATE SET
      scope = EXCLUDED.scope, surface = EXCLUDED.surface, team_id = EXCLUDED.team_id,
      game_id = EXCLUDED.game_id, player_id = EXCLUDED.player_id, season_id = EXCLUDED.season_id,
      category = EXCLUDED.category, headline = EXCLUDED.headline, detail = EXCLUDED.detail,
      importance = EXCLUDED.importance, proof_sql = EXCLUDED.proof_sql, proof_params = EXCLUDED.proof_params,
      proof_result = EXCLUDED.proof_result, frame = EXCLUDED.frame, evidence = EXCLUDED.evidence,
      entities = EXCLUDED.entities, score_parts = EXCLUDED.score_parts,
      first_emitted_at = COALESCE(insights.first_emitted_at, EXCLUDED.first_emitted_at),
      is_active = TRUE, updated_at = now()
  `;
}

/**
 * Deactivates this detector's rows that the run did not re-emit: same surface
 * and categories and, for postgame, only the games the run covered — so a
 * single-game run never touches another game's insights (spec §5.1).
 */
export async function deactivateStale(
  scope: { surface: Surface; categories: readonly string[]; gameIds: string[] | null },
  keptKeys: string[],
): Promise<number> {
  const result = await sql`
    UPDATE insights SET is_active = FALSE, updated_at = now()
    WHERE surface = ${scope.surface}
      AND category = ANY(${[...scope.categories]}::text[])
      AND is_active
      ${scope.gameIds ? sql`AND game_id = ANY(${scope.gameIds}::bigint[])` : sql``}
      AND (proof_hash IS NULL OR proof_hash <> ALL(${keptKeys}::text[]))
  `;
  return result.count;
}

/** The clean cut (spec §2.8): v1 batch rows have no surface. Live rows are never touched. */
export async function deactivateLegacy(): Promise<number> {
  const result = await sql`
    UPDATE insights SET is_active = FALSE, updated_at = now()
    WHERE surface IS NULL AND scope IN ('between_games', 'historical') AND is_active
  `;
  return result.count;
}
