// scripts/lib/insights/verify.ts
// Re-runs the stored proof of every active batch insight and checks that the
// stored proof_result rows are still returned — i.e. that each claim is still
// backed by the data. Insights written before positional proof params
// ({"$1": …}) existed are skipped (reported as `legacy`).
import { sql } from '../db.js';
import { positionalParams, proofStillHolds } from './proof-utils.js';

export interface VerifyResult {
  checked: number;
  legacy: number;
  failures: { insight_id: string; headline: string; reason: string }[];
}

export async function verifyActiveInsights(): Promise<VerifyResult> {
  const insights = await sql<{
    insight_id: string; headline: string; proof_sql: string; proof_params: unknown; proof_result: unknown[];
  }[]>`
    SELECT insight_id::text, headline, proof_sql, proof_params, proof_result
    FROM insights
    WHERE is_active AND scope IN ('between_games', 'historical')
  `;

  const result: VerifyResult = { checked: 0, legacy: 0, failures: [] };
  for (const ins of insights) {
    const params = positionalParams(ins.proof_params);
    if (params === null) {
      result.legacy++;
      continue;
    }
    result.checked++;
    try {
      const fresh = await sql.unsafe(ins.proof_sql, params as (string | number | boolean | null)[]);
      if (!Array.isArray(ins.proof_result) || ins.proof_result.length === 0) {
        result.failures.push({ ...ins, reason: 'empty proof_result' });
      } else if (!proofStillHolds(ins.proof_result, [...fresh])) {
        result.failures.push({ ...ins, reason: 'stored proof rows not returned by proof_sql' });
      }
    } catch (err) {
      result.failures.push({ ...ins, reason: `proof_sql failed: ${(err as Error).message}` });
    }
  }
  return result;
}
