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
  proof_hash: string;           // dedup key: makeInsightKey(category, entity ids, season, metricKey)
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
 * makeInsightKey — stable identity of a logical insight, stored in proof_hash
 * and used for ON CONFLICT (proof_hash) dedup in generate-insights.
 *
 * Per 06-CONTEXT.md ("Deduplication Strategy") the key is
 * (category, team_id, player_id, game_id, season_id, metric_key) — it must NOT
 * include proof_result (or anything else that changes nightly), otherwise every
 * run inserts a new row instead of updating the existing one. metricKey names
 * the claim (e.g. "scoring_streak_20", "clippers_off_rank_last10") and must
 * likewise exclude run-dependent values such as today's date.
 */
export function makeInsightKey(
  row: Pick<InsightRow, 'category' | 'team_id' | 'player_id' | 'game_id' | 'season_id'>,
  metricKey: string
): string {
  const raw = [
    'insight-v2',
    row.category,
    row.team_id ?? '',
    row.player_id ?? '',
    row.game_id ?? '',
    row.season_id ?? '',
    metricKey,
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Attach the dedup key (see makeInsightKey) to an otherwise complete insight row. */
export function withInsightKey(row: Omit<InsightRow, 'proof_hash'>, metricKey: string): InsightRow {
  return { ...row, proof_hash: makeInsightKey(row, metricKey) };
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

/** Minimum teams with current rolling stats before a league rank is meaningful. */
export const MIN_LEAGUE_TEAMS = 20;

/**
 * isReportableLeagueRank — true when a "rank N of total" claim is safe to show:
 * a valid rank within the league size, at least MIN_LEAGUE_TEAMS teams ranked,
 * and (optionally) rank within the top `topN`.
 */
export function isReportableLeagueRank(
  rank: number,
  totalTeams: number,
  topN: number = Number.POSITIVE_INFINITY
): boolean {
  if (!Number.isFinite(rank) || !Number.isFinite(totalTeams)) return false;
  if (totalTeams < MIN_LEAGUE_TEAMS) return false;
  return rank >= 1 && rank <= totalTeams && rank <= topN;
}
