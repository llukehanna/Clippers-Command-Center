// scripts/lib/franchise/write-common.ts
// Types and SQL helpers shared by the franchise writer (write.ts) and its people half (write-people.ts).
import type { Db } from '../history/write.js';

export type WriteMode =
  | {
      kind: 'import';
      /** Source prefixes this run owns (e.g. 'bbref:', 'wiki:', 'override:'). */
      importSources: string[];
      /** Seasons (start years) the cache holds pages for. Required: pruning never reaches past them. */
      seasons: number[];
      /**
       * Prune honors with no season (Hall of Fame, retired numbers) the dataset doesn't carry. Default true; false for a
       * run over part of the cached seasons, which can't resolve every honoree.
       */
      pruneUndatedHonors?: boolean;
    }
  | { kind: 'job'; job: 'nightly' | 'weekly' };

export interface SkippedRow { table: string; reason: string; row: unknown }

export interface WriteResult {
  inserted: Record<string, number>;
  updated: Record<string, number>;
  deleted: Record<string, number>;
  /** People merged from an `nba:` key into their BBRef row. */
  merged: number;
  skipped: SkippedRow[];
}

type Value = string | number | boolean | null | string[] | ReturnType<Db['json']>;
export type Row = Record<string, Value>;

const BATCH = 500;
export const chunks = <T>(xs: T[], n = BATCH): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

export function bump(c: Record<string, number>, table: string, n: number): void {
  if (n) c[table] = (c[table] ?? 0) + n;
}

/** Last row wins per key, so one INSERT … ON CONFLICT never touches a row twice. */
export function dedupe(rows: Row[], key: string[]): Row[] {
  const m = new Map<string, Row>();
  for (const r of rows) m.set(JSON.stringify(key.map((k) => r[k])), r);
  return [...m.values()];
}

/**
 * INSERT … ON CONFLICT (key) DO UPDATE, only where something differs (so a repeat write changes nothing).
 * 'overwrite' takes the new value (or keeps the old one for `keep` columns when the new one is null);
 * 'fill' only fills nulls. Identifiers are our own constants (postgres.js reads `AS` before a row helper as a
 * select, so no table alias).
 */
export async function upsert(
  tx: Db, table: string, key: string[], rows: Row[], how: 'overwrite' | 'fill', keep: string[] = [],
): Promise<{ ins: number; upd: number }> {
  let ins = 0, upd = 0;
  const all = dedupe(rows, key);
  if (!all.length) return { ins, upd };
  const cols = Object.keys(all[0]);
  const rest = cols.filter((c) => !key.includes(c));
  const expr = (c: string) =>
    how === 'fill' ? `COALESCE(${table}.${c}, EXCLUDED.${c})` : keep.includes(c) ? `COALESCE(EXCLUDED.${c}, ${table}.${c})` : `EXCLUDED.${c}`;
  const set = rest.map((c) => `${c} = ${expr(c)}`).join(', ');
  const differs = `(${rest.map((c) => `${table}.${c}`).join(', ')}) IS DISTINCT FROM (${rest.map(expr).join(', ')})`;
  for (const batch of chunks(all)) {
    const res = await tx<{ ins: boolean }[]>`
      INSERT INTO ${tx.unsafe(table)} ${tx(batch as never, cols)}
      ON CONFLICT (${tx.unsafe(key.join(', '))}) DO UPDATE SET ${tx.unsafe(set)} WHERE ${tx.unsafe(differs)}
      RETURNING (xmax = 0) AS ins`;
    for (const r of res) if (r.ins) ins++; else upd++;
  }
  return { ins, upd };
}
