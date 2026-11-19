// src/lib/data/insight-quality.ts
// Load-side glue for the insights quality bar: one context query per page, then applyBar.
// Fails closed (Ruling 8): a failed query is logged and never fails the page.

import { sql, LAC_NBA_TEAM_ID } from '@/src/lib/db';
import { applyBar, contextNeeds, type BarResult, type BarRow, type QualityContext } from '../insights/quality';
import { QUALITY_CONTEXT_SQL, qualityContextParams } from '../insights/quality-context-sql';
import type { EntityRef, SalienceClass } from '../insights/types';

export const INSIGHT_ROW_COLUMNS = `i.insight_id::text AS insight_id, i.scope::text AS scope, i.surface::text AS surface,
  i.category::text AS category, i.headline::text AS headline, i.detail::text AS detail,
  i.importance::int AS importance, i.game_id::text AS game_id, i.player_id::text AS player_id,
  i.season_id::int AS season_id, i.frame::jsonb AS frame, i.evidence::jsonb AS evidence,
  i.entities::jsonb AS entities, i.score_parts::jsonb AS score_parts, i.proof_result::jsonb AS proof_result,
  to_char(i.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at,
  ig.game_date::text AS game_date`;

export const INSIGHT_ROW_FROM = 'insights i LEFT JOIN games ig ON ig.game_id = i.game_id';

export interface InsightDbRow extends BarRow {
  scope: string;
  headline: string;
  importance: number;
  entities: EntityRef[] | null;
  score_parts: { salience_class?: SalienceClass } | null;
  updated_at: string;
}

/** Dates travel as 'YYYY-MM-DD' strings, never JS Dates (no timezone day shifts). */
function ymd(v: string | null): string | null {
  const x: unknown = v;
  return x instanceof Date ? x.toISOString().slice(0, 10) : v;
}

export async function loadQualityContext(rows: BarRow[]): Promise<Map<string, QualityContext>> {
  const out = new Map<string, QualityContext>();
  const needs = contextNeeds(rows);
  if (needs.length === 0) return out;
  try {
    const params = qualityContextParams(
      needs.map((n) => ({
        ...n, since_date: ymd(n.since_date), until_date: ymd(n.until_date), at_date: ymd(n.at_date),
      })),
      LAC_NBA_TEAM_ID,
    );
    const res = (await sql.unsafe(QUALITY_CONTEXT_SQL, params as never)) as unknown as Array<{
      insight_id: string; games_since: number | null; team_game_number: number | null;
    }>;
    for (const r of res) {
      out.set(r.insight_id, { games_since: r.games_since ?? null, team_game_number: r.team_game_number ?? null });
    }
  } catch (err) {
    console.error('[insights] quality context failed', err);
    return new Map();
  }
  return out;
}

export async function barFilter<T extends BarRow>(rows: T[]): Promise<BarResult<T>> {
  return applyBar(rows, await loadQualityContext(rows));
}
