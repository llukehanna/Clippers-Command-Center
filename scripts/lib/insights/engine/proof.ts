// scripts/lib/insights/engine/proof.ts
// One proof statement per insight (spec §2.3): the fact's query and the
// frame's query become CTEs of a single SELECT whose rows are stored as
// proof_result and re-run by verify-insights. Pure.
import type { Param, ProofQuery } from './types.js';

export function shiftPlaceholders(text: string, offset: number): string {
  return offset === 0 ? text : text.replace(/\$(\d+)/g, (_m, n: string) => `$${Number(n) + offset}`);
}

/** Wraps a reference set as `WITH ref AS (...)`; `bind` appends a param and returns its cast placeholder. */
export function withRef(ref: ProofQuery, body: (bind: (v: Param, type: string) => string) => string): ProofQuery {
  const params: Param[] = [...ref.params];
  const bind = (v: Param, type: string) => {
    params.push(v);
    return `$${params.length}::${type}`;
  };
  const text = body(bind);
  return { sql: `WITH ref AS (\n${ref.sql}\n)\n${text}`, params };
}

export function combineProof(fact: ProofQuery, frame: ProofQuery | null): ProofQuery {
  let ctes = `WITH fact_rows AS (\n${fact.sql}\n)`;
  const selects = [`SELECT 'fact'::text AS part, to_jsonb(fact_rows) AS data FROM fact_rows`];
  if (frame) {
    ctes += `,\nframe_rows AS (\n${shiftPlaceholders(frame.sql, fact.params.length)}\n)`;
    selects.push(`SELECT 'frame'::text AS part, to_jsonb(frame_rows) AS data FROM frame_rows`);
  }
  return { sql: `${ctes}\n${selects.join('\nUNION ALL\n')}`, params: [...fact.params, ...(frame?.params ?? [])] };
}

export interface ProofPart { part: 'fact' | 'frame'; data: Record<string, unknown> }

/** This claim's fact rows (every `match` entry equal) plus every frame row; null when the claim has no row. */
export function selectProofRows(rows: ProofPart[], match: Record<string, string | number | boolean>): ProofPart[] | null {
  const entries = Object.entries(match);
  const facts = rows.filter((r) => r.part === 'fact' && entries.every(([k, v]) => String(r.data?.[k]) === String(v)));
  if (facts.length === 0) return null;
  return [...facts, ...rows.filter((r) => r.part === 'frame')];
}
