// scripts/lib/insights/verify.ts
// Re-runs the stored proof of every active batch insight and checks that the
// stored proof_result rows are still returned — i.e. that each claim is still
// backed by the data. Insights written before positional proof params
// ({"$1": …}) existed are skipped (reported as `legacy`).
//
// A failing FROZEN postgame row (past season, or older than the postgame
// window — see frozen.ts) is deactivated and reported as `retired`; every other
// failing row stays a failure.
import { sql } from '../db.js';
import { positionalParams, proofStillHolds } from './proof-utils.js';
import { isFrozenPostgame } from './frozen.js';
import { laToday } from './engine/dates.js';

interface Problem { insight_id: string; headline: string; reason: string }

export interface VerifyResult {
  checked: number;
  legacy: number;
  failures: Problem[];
  retired: Problem[];
}

export async function verifyActiveInsights(today: string = laToday()): Promise<VerifyResult> {
  const insights = await sql<{
    insight_id: string; headline: string; proof_sql: string; proof_params: unknown; proof_result: unknown[];
    surface: string | null; game_date: string | null; season_id: number | null;
  }[]>`
    SELECT i.insight_id::text, i.headline, i.proof_sql, i.proof_params, i.proof_result, i.surface,
           g.game_date::text AS game_date, g.season_id::int AS season_id
    FROM insights i LEFT JOIN games g ON g.game_id = i.game_id
    WHERE i.is_active AND i.scope IN ('between_games', 'historical')
  `;

  const result: VerifyResult = { checked: 0, legacy: 0, failures: [], retired: [] };
  for (const ins of insights) {
    const params = positionalParams(ins.proof_params);
    if (params === null) {
      result.legacy++;
      continue;
    }
    result.checked++;
    const fail = async (reason: string) => {
      const problem = { insight_id: ins.insight_id, headline: ins.headline, reason };
      if (isFrozenPostgame(ins, today)) {
        await sql`UPDATE insights SET is_active = FALSE, updated_at = now() WHERE insight_id = ${ins.insight_id}::uuid`;
        result.retired.push(problem);
      } else {
        result.failures.push(problem);
      }
    };
    let reason: string | null = null;
    try {
      const fresh = await sql.unsafe(ins.proof_sql, params as (string | number | boolean | null)[]);
      if (!Array.isArray(ins.proof_result) || ins.proof_result.length === 0) reason = 'empty proof_result';
      else if (!proofStillHolds(ins.proof_result, [...fresh])) reason = 'stored proof rows not returned by proof_sql';
    } catch (err) {
      reason = `proof_sql failed: ${(err as Error).message}`;
    }
    if (reason !== null) await fail(reason);
  }
  return result;
}
