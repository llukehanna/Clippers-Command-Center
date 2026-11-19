// scripts/lib/insights/engine/stats.ts
// Small pure helpers for pregame facts.
import { daysBetween } from './dates.js';

function choose(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** P(X >= k) when `upper`, else P(X <= k), for X ~ Binomial(n, p). */
export function binomialTail(n: number, k: number, p: number, upper: boolean): number {
  let sum = 0;
  for (let i = 0; i <= n; i++) if (upper ? i >= k : i <= k) sum += choose(n, i) * p ** i * (1 - p) ** (n - i);
  return Math.min(1, sum);
}

/** Days off before the next game; 0 = second night of a back-to-back. */
export function restDays(lastGame: string | null, nextGame: string): number | null {
  return lastGame ? daysBetween(lastGame, nextGame) - 1 : null;
}

export type RestKind = 'lac_b2b' | 'opp_b2b' | 'rest_edge';
/** Beyond this, rest is a schedule gap (offseason, All-Star break), not an edge. */
export const MAX_REST_DAYS = 7;

export function restSituations(lacRest: number | null, oppRest: number | null): RestKind[] {
  const out: RestKind[] = [];
  if (lacRest === 0) out.push('lac_b2b');
  if (oppRest === 0) out.push('opp_b2b');
  if (lacRest !== null && oppRest !== null && lacRest <= MAX_REST_DAYS && oppRest <= MAX_REST_DAYS
      && Math.abs(lacRest - oppRest) >= 2 && Math.min(lacRest, oppRest) <= 1) out.push('rest_edge');
  return out;
}
