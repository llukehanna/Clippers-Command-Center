// scripts/lib/insights/engine/query.ts
// The production Runner: one parameterized statement → plain rows.
import { sql } from '../../db.js';
import type { ProofQuery, Row } from './types.js';

export async function runQuery(q: ProofQuery): Promise<Row[]> {
  const rows = await sql.unsafe(q.sql, q.params as (string | number | boolean | null)[]);
  return rows.map((r) => ({ ...r }) as Row);
}
