import crypto from 'crypto';

/**
 * The shape every batch category module returns.
 * proof_sql, proof_params, and proof_result are required — rows
 * without all three are rejected before upsert (guardProofResult).
 */
export interface InsightRow {
  scope: 'between_games' | 'historical';
  team_id: string | null;       // bigint stored as text; cast back on insert
  game_id: string | null;
  player_id: string | null;
  season_id: number | null;
  category: 'milestone' | 'rare_event' | 'streak' | 'league_comparison' | 'opponent_context';
  headline: string;
  detail: string | null;
  importance: number;           // 0–100
  proof_sql: string;            // parameterized SQL with $1, $2... placeholders
  proof_params: Record<string, unknown>;
  proof_result: unknown[];      // must be non-empty or row is rejected
  proof_hash: string;           // SHA-256 hex of (proof_sql, proof_params, proof_result)
}

/**
 * makeProofHash — deterministic SHA-256 fingerprint of the SQL + params + result tuple.
 *
 * Accepts either positional (sql, params, result) or null for params/result.
 * Null values are coerced to empty string before hashing.
 */
export function makeProofHash(
  proofSql: string | null,
  proofParams: unknown,
  proofResult: unknown
): string {
  const sqlPart = proofSql ?? '';
  const paramsPart = proofParams != null ? JSON.stringify(proofParams) : '';
  const resultPart = proofResult != null ? JSON.stringify(proofResult) : '';
  const raw = [sqlPart, paramsPart, resultPart].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * guardProofResult — returns false when proof_result is empty.
 * Callers check the return value and skip upsert when false.
 */
export function guardProofResult(proof_result: unknown[]): boolean {
  return proof_result.length > 0;
}

/**
 * computeImportance — pure formula: base + rarity_boost + recency_boost, capped at 100.
 *
 * Base scores:
 *   milestone=80, rare_event=78, streak=72, league_comparison=65, opponent_context=60
 *
 * Rarity boost (percentileRank 0–100):
 *   >= 99 → +15;  >= 95 → +5;  null → +0
 *
 * Recency boost (gameDateMs = Date.getTime()):
 *   <= 7 days → +10;  <= 30 days → +5;  else +0
 */
export function computeImportance(
  category: InsightRow['category'],
  percentileRank: number | null,
  gameDateMs: number
): number {
  const base: Record<InsightRow['category'], number> = {
    milestone: 80,
    rare_event: 78,
    streak: 72,
    league_comparison: 65,
    opponent_context: 60,
  };

  let score = base[category] ?? 50;

  // Rarity boost
  if (percentileRank !== null) {
    if (percentileRank >= 99) score += 15;
    else if (percentileRank >= 95) score += 5;
  }

  // Recency boost
  const ageDays = (Date.now() - gameDateMs) / 86_400_000;
  if (ageDays <= 7) score += 10;
  else if (ageDays <= 30) score += 5;

  return Math.min(100, score);
}
