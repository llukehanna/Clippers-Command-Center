// src/lib/live/win-prob.ts
// Win-probability model stern-v1 (Live v2 spec §7.1). The final LAC margin is
// Normal(m + E·r, σ²·r), so P(LAC wins) = Φ((m + E·r) / (σ·√r)): m is the
// current margin, E the pregame expected margin, r the fraction of regulation
// left (in overtime, the OT period's seconds left ÷ 2,880). A model estimate —
// σ is fitted by scripts/calibrate-wp.ts. Pure: shared by the runner, the
// calibration script and the UI.

export const PERIOD_SECS = 720;
export const OT_SECS = 300;
export const REGULATION_SECS = 4 * PERIOD_SECS;
/** Used until scripts/calibrate-wp.ts has stored a fitted σ. */
export const DEFAULT_SIGMA = 12.5;
/** Pregame expected margin when there's no spread: home court. */
export const HOME_COURT_MARGIN = 2.5;

/** Standard normal CDF via the Abramowitz–Stegun 7.1.26 erf approximation (|error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Game seconds elapsed with `clockSec` left in `period` (overtime periods are 5 minutes). */
export function elapsedSecs(period: number, clockSec: number): number {
  if (period <= 4) return (period - 1) * PERIOD_SECS + (PERIOD_SECS - clockSec);
  return REGULATION_SECS + (period - 5) * OT_SECS + (OT_SECS - clockSec);
}

/** The inverse of elapsedSecs. A boundary belongs to the period it ends (t = 720 → Q1 0:00). */
export function periodClockAt(t: number): { period: number; clockSec: number } {
  if (t <= 0) return { period: 1, clockSec: PERIOD_SECS };
  if (t <= REGULATION_SECS) {
    const period = Math.ceil(t / PERIOD_SECS);
    return { period, clockSec: period * PERIOD_SECS - t };
  }
  const ot = Math.ceil((t - REGULATION_SECS) / OT_SECS);
  return { period: 4 + ot, clockSec: REGULATION_SECS + ot * OT_SECS - t };
}

export function periodName(period: number): string {
  if (period <= 4) return `Q${period}`;
  return period === 5 ? 'OT' : `${period - 4}OT`;
}

export function formatClock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "Q2 4:32" for a game time in elapsed seconds. */
export function formatGameTime(t: number): string {
  const { period, clockSec } = periodClockAt(t);
  return `${periodName(period)} ${formatClock(clockSec)}`;
}

/** r in the model: regulation seconds left ÷ 2,880; in overtime, the OT period's seconds left ÷ 2,880. */
export function remainingFraction(period: number, clockSec: number): number {
  const left = period <= 4 ? (4 - period) * PERIOD_SECS + clockSec : clockSec;
  return Math.max(0, left) / REGULATION_SECS;
}

export interface WinProbInput {
  margin: number;              // LAC margin now
  period: number;
  clockSec: number;            // seconds left in the period
  expected: number;            // pregame expected LAC margin (E)
  sigma: number;
}

export function winProbability(i: WinProbInput): number {
  const r = remainingFraction(i.period, i.clockSec);
  if (r <= 0) return i.margin > 0 ? 1 : i.margin < 0 ? 0 : 0.5;
  return normalCdf((i.margin + i.expected * r) / (i.sigma * Math.sqrt(r)));
}

/** E from the Clippers' closing spread (−4.5 = favored by 4.5), else home court. */
export function expectedLacMargin(
  lacSpread: number | null | undefined,
  lacIsHome: boolean
): { expected: number; source: 'spread' | 'home_court' } {
  if (lacSpread != null && Number.isFinite(lacSpread)) return { expected: 0 - lacSpread, source: 'spread' };
  return { expected: lacIsHome ? HOME_COURT_MARGIN : -HOME_COURT_MARGIN, source: 'home_court' };
}
