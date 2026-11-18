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

/** Positional proof parameters as stored in proof_params: { "$1": v1, "$2": v2, … }. */
export function paramsRecord(params: readonly unknown[]): Record<string, unknown> {
  return Object.fromEntries(params.map((v, i) => [`$${i + 1}`, v]));
}

/** 1 → "1st", 2 → "2nd", 11 → "11th", 23 → "23rd". */
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/** Highest threshold in `thresholds` that `value` has reached, or null. */
export function highestThreshold(value: number, thresholds: readonly number[]): number | null {
  let best: number | null = null;
  for (const t of thresholds) if (value >= t && (best === null || t > best)) best = t;
  return best;
}

/** Fixed-point number for headlines: 27.08 → "27.1", 0.6123 as pct → "61.2%". */
export function fmt(value: number, digits = 1): string {
  return value.toFixed(digits);
}
export function pct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

// ── Proof verification (pure; used by verify.ts) ─────────────────────────────

/** Canonical JSON (sorted keys) so row comparison ignores key order. */
/**
 * A float aggregate as a proof column: rounded to 6 decimals, so float noise
 * from row order can't make a re-run of the proof differ from the stored rows.
 */
export function proofValue(expr: string): string {
  return `ROUND((${expr})::numeric, 6)::float8`;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Positional params from {"$1": v1, "$2": v2}, or null when not in that form. */
export function positionalParams(params: unknown): unknown[] | null {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) return null;
  const entries = Object.entries(params as Record<string, unknown>);
  if (entries.length === 0) return [];
  const out: unknown[] = [];
  for (const [k, v] of entries) {
    const m = /^\$(\d+)$/.exec(k);
    if (!m) return null;
    out[Number(m[1]) - 1] = v;
  }
  return out.length === entries.length ? out : null;
}

/** True when every stored row appears in the fresh result. */
export function proofStillHolds(stored: unknown[], fresh: unknown[]): boolean {
  const freshSet = new Set(fresh.map((r) => canonical(JSON.parse(JSON.stringify(r)))));
  return stored.every((r) => freshSet.has(canonical(r)));
}
