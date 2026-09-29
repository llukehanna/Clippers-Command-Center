// scripts/lib/wp-calibrate.ts
// Fits σ for the stern-v1 win-probability model (Live v2 spec §7.1) by
// minimizing the Brier score over past Clippers games, sampled once a minute
// of regulation. Pure — scripts/calibrate-wp.ts does the database I/O.

import { DEFAULT_SIGMA, PERIOD_SECS, REGULATION_SECS, winProbability } from '../../src/lib/live/win-prob';
import type { ReliabilityBin, SourceFit, WpCalibration } from '../../src/lib/types/live-state';

/** app_kv key holding the fitted model (a WpCalibration). The runner reads it. */
export const WP_MODEL_KEY = 'wp:model';
export const SAMPLE_EVERY_SECS = 60;
/** Wide enough for games without a closing spread, whose team-strength gap lands in σ (fits of 18–22 seen). */
export const SIGMA_GRID = { min: 8, max: 30, step: 0.1 } as const;
/** A new fit may be at most this much worse (Brier) than the stored one. */
export const BRIER_TOLERANCE = 0.005;
/** Fewest games worth fitting σ over (overall, and per source of E). */
export const MIN_GAMES = 50;

export type ExpectedSource = 'spread' | 'home_court';
const SOURCES: ExpectedSource[] = ['spread', 'home_court'];

export interface CalGame {
  series: [number, number][];  // [elapsed_sec, lac_margin], ascending (game_flow.margin_series)
  lacWon: boolean;
  expected: number;            // pregame expected LAC margin
  source?: ExpectedSource;     // where `expected` came from; unset games count only in the overall fit
}

export interface Sample {
  margin: number;
  period: number;
  clockSec: number;
  expected: number;
  won: 0 | 1;
}

export interface CalibrationResult {
  sigma: number;
  brier: number;
  n_games: number;
  n_samples: number;
  reliability: ReliabilityBin[];
  sigma_by_source: Partial<Record<ExpectedSource, SourceFit>>;
}

const round = (x: number, places: number) => Math.round(x * 10 ** places) / 10 ** places;

/** The LAC margin after the last change at or before t. */
export function marginAt(series: [number, number][], t: number): number {
  let m = 0;
  for (const [at, margin] of series) {
    if (at > t) break;
    m = margin;
  }
  return m;
}

export function samplesFor(g: CalGame): Sample[] {
  const out: Sample[] = [];
  for (let t = 0; t < REGULATION_SECS; t += SAMPLE_EVERY_SECS) {
    const period = Math.floor(t / PERIOD_SECS) + 1;
    out.push({ margin: marginAt(g.series, t), period, clockSec: period * PERIOD_SECS - t, expected: g.expected, won: g.lacWon ? 1 : 0 });
  }
  return out;
}

function prob(s: Sample, sigma: number): number {
  return winProbability({ margin: s.margin, period: s.period, clockSec: s.clockSec, expected: s.expected, sigma });
}

export function brier(samples: Sample[], sigma: number): number {
  if (samples.length === 0) return NaN;
  let sum = 0;
  for (const s of samples) {
    const d = prob(s, sigma) - s.won;
    sum += d * d;
  }
  return sum / samples.length;
}

export function fitSigma(
  samples: Sample[],
  grid: { min: number; max: number; step: number } = SIGMA_GRID
): { sigma: number; brier: number } {
  let best = { sigma: grid.min, brier: Infinity };
  const steps = Math.round((grid.max - grid.min) / grid.step);
  for (let k = 0; k <= steps; k++) {
    const sigma = round(grid.min + k * grid.step, 3);
    const b = brier(samples, sigma);
    if (b < best.brier) best = { sigma, brier: b };
  }
  return best;
}

export function reliability(samples: Sample[], sigma: number, bins = 10): ReliabilityBin[] {
  const acc = Array.from({ length: bins }, (_, i) => ({ lo: i / bins, hi: (i + 1) / bins, n: 0, sumP: 0, wins: 0 }));
  for (const s of samples) {
    const p = prob(s, sigma);
    const b = acc[Math.min(bins - 1, Math.floor(p * bins))];
    b.n += 1;
    b.sumP += p;
    b.wins += s.won;
  }
  return acc
    .filter((b) => b.n > 0)
    .map((b) => ({ lo: b.lo, hi: b.hi, n: b.n, mean_p: round(b.sumP / b.n, 3), observed: round(b.wins / b.n, 3) }));
}

/** σ fitted separately over each source's games, for each source with at least `minGames`. */
export function fitBySource(games: CalGame[], minGames = MIN_GAMES): Partial<Record<ExpectedSource, SourceFit>> {
  const out: Partial<Record<ExpectedSource, SourceFit>> = {};
  for (const source of SOURCES) {
    const subset = games.filter((g) => g.source === source);
    if (subset.length < minGames) continue;
    const fit = fitSigma(subset.flatMap(samplesFor));
    out[source] = { sigma: fit.sigma, brier: round(fit.brier, 5), n_games: subset.length };
  }
  return out;
}

export function calibrate(games: CalGame[]): CalibrationResult {
  const samples = games.flatMap(samplesFor);
  const fit = fitSigma(samples);
  return {
    sigma: fit.sigma,
    brier: round(fit.brier, 5),
    n_games: games.length,
    n_samples: samples.length,
    reliability: reliability(samples, fit.sigma),
    sigma_by_source: fitBySource(games),
  };
}

const validSigma = (s: number | undefined): s is number => typeof s === 'number' && Number.isFinite(s) && s > 0;

/**
 * The σ the runner uses for a game: the fit for its source of E when there is
 * a valid one, else the overall fit, else the default. A spread game never
 * borrows the overall fit from a per-source calibration: that fit is mostly
 * home-court games, whose σ absorbs the team-strength gap the spread already
 * accounts for (2019–26 Clippers games fit ≈ 22), and would flatten its odds.
 */
export function modelSigma(calibration: WpCalibration | null, source: ExpectedSource): number {
  const bySource = calibration?.sigma_by_source?.[source]?.sigma;
  if (validSigma(bySource)) return bySource;
  if (source === 'spread' && calibration?.sigma_by_source) return DEFAULT_SIGMA;
  if (validSigma(calibration?.sigma)) return calibration.sigma;
  return DEFAULT_SIGMA;
}
