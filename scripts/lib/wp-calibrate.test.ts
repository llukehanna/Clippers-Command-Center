import { describe, it, expect } from 'vitest';
import {
  brier,
  calibrate,
  fitBySource,
  fitSigma,
  marginAt,
  MIN_GAMES,
  modelSigma,
  reliability,
  samplesFor,
  type CalGame,
  type Sample,
} from './wp-calibrate.js';
import { DEFAULT_SIGMA } from '../../src/lib/live/win-prob.js';
import type { WpCalibration } from '../../src/lib/types/live-state.js';

// Deterministic PRNG (mulberry32) and a Box–Muller normal draw, so the fit test is stable.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number): number {
  const u = 1 - r();
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Games that follow the model exactly: a random walk with drift E/48 and variance σ²/48 per minute. */
function simulate(n: number, sigma: number, seed: number): CalGame[] {
  const r = mulberry32(seed);
  return Array.from({ length: n }, () => {
    const expected = (r() - 0.5) * 16;
    let m = 0;
    const series: [number, number][] = [[0, 0]];
    for (let t = 60; t <= 2880; t += 60) {
      m += expected / 48 + (sigma / Math.sqrt(48)) * gauss(r);
      series.push([t, Math.round(m)]);
    }
    return { series, lacWon: m > 0, expected };
  });
}

describe('marginAt', () => {
  const series: [number, number][] = [[0, 0], [30, 2], [95, -1], [200, 4]];
  it('is the margin after the last change at or before t', () => {
    expect(marginAt(series, 0)).toBe(0);
    expect(marginAt(series, 29)).toBe(0);
    expect(marginAt(series, 30)).toBe(2);
    expect(marginAt(series, 120)).toBe(-1);
    expect(marginAt(series, 5000)).toBe(4);
    expect(marginAt([], 100)).toBe(0);
  });
});

describe('samplesFor', () => {
  it('samples every minute of regulation, from the tip', () => {
    const s = samplesFor({ series: [[0, 0], [700, 5]], lacWon: true, expected: 2 });
    expect(s).toHaveLength(48);
    expect(s[0]).toEqual({ margin: 0, period: 1, clockSec: 720, expected: 2, won: 1 });
    expect(s[12]).toEqual({ margin: 5, period: 2, clockSec: 720, expected: 2, won: 1 });
    expect(s[47]).toMatchObject({ period: 4, clockSec: 60 });
  });
});

describe('brier', () => {
  it('is ~0 for a sure thing that happened and ~1 for one that did not', () => {
    const sure: Sample = { margin: 30, period: 4, clockSec: 60, expected: 0, won: 1 };
    expect(brier([sure], 12)).toBeLessThan(1e-6);
    expect(brier([{ ...sure, won: 0 }], 12)).toBeGreaterThan(0.999);
  });
});

describe('fitSigma', () => {
  it('recovers σ from games simulated with it', () => {
    expect(Math.abs(fitSigma(simulate(1500, 12, 7).flatMap(samplesFor)).sigma - 12)).toBeLessThan(1);
    expect(Math.abs(fitSigma(simulate(1500, 15, 11).flatMap(samplesFor)).sigma - 15)).toBeLessThan(1);
  });

  it('reaches the high σ that swingy games without a spread produce', () => {
    // 2024-26 Clippers games with only a home-court expectation fit σ ≈ 18–22.
    expect(Math.abs(fitSigma(simulate(1500, 24, 13).flatMap(samplesFor)).sigma - 24)).toBeLessThan(1.5);
  });
});

describe('reliability', () => {
  it('bins every sample by predicted probability', () => {
    const samples = simulate(200, 12, 3).flatMap(samplesFor);
    const bins = reliability(samples, 12);
    expect(bins.reduce((n, b) => n + b.n, 0)).toBe(samples.length);
    for (const b of bins) {
      expect(b.n).toBeGreaterThan(0);
      expect(b.mean_p).toBeGreaterThanOrEqual(b.lo - 1e-9);
      expect(b.mean_p).toBeLessThanOrEqual(b.hi + 1e-9);
    }
  });
});

describe('calibrate', () => {
  it('reports the fit with its sample counts', () => {
    const games = simulate(100, 12, 5);
    const r = calibrate(games);
    expect(r.n_games).toBe(100);
    expect(r.n_samples).toBe(4800);
    expect(r.sigma).toBeGreaterThanOrEqual(8);
    expect(r.sigma).toBeLessThanOrEqual(30);
    expect(r.brier).toBeGreaterThan(0);
    expect(r.reliability.length).toBeGreaterThan(0);
  });
});

describe('fitBySource', () => {
  const spread = simulate(600, 11, 21).map((g) => ({ ...g, source: 'spread' as const }));
  const homeCourt = simulate(600, 15, 23).map((g) => ({ ...g, source: 'home_court' as const }));

  it('fits σ separately for each source of the pregame expectation', () => {
    const by = fitBySource([...spread, ...homeCourt]);
    expect(Math.abs(by.spread!.sigma - 11)).toBeLessThan(1);
    expect(Math.abs(by.home_court!.sigma - 15)).toBeLessThan(1);
    expect(by.spread!.n_games).toBe(600);
    expect(by.home_court!.n_games).toBe(600);
    expect(by.spread!.brier).toBeGreaterThan(0);
  });

  it(`skips a source with fewer than ${MIN_GAMES} games, and games without a source`, () => {
    const by = fitBySource([...spread, ...homeCourt.slice(0, MIN_GAMES - 1), ...simulate(80, 12, 29)]);
    expect(by.spread?.n_games).toBe(600);
    expect(by.home_court).toBeUndefined();
  });

  it('calibrate reports the overall fit plus each source', () => {
    const r = calibrate([...spread, ...homeCourt]);
    expect(r.n_games).toBe(1200);
    expect(r.sigma).toBeGreaterThan(r.sigma_by_source!.spread!.sigma);
    expect(r.sigma).toBeLessThan(r.sigma_by_source!.home_court!.sigma);
  });
});

describe('modelSigma', () => {
  const cal = (over: Partial<WpCalibration> = {}): WpCalibration => ({
    sigma: 13, brier: 0.15, n_games: 900, n_samples: 43_200, fitted_at: '2026-09-28T10:00:00Z', reliability: [], ...over,
  });
  const bySource = { spread: { sigma: 11.5, brier: 0.14, n_games: 300 }, home_court: { sigma: 14, brier: 0.16, n_games: 600 } };

  it("uses the σ fitted for the game's source of E", () => {
    expect(modelSigma(cal({ sigma_by_source: bySource }), 'spread')).toBe(11.5);
    expect(modelSigma(cal({ sigma_by_source: bySource }), 'home_court')).toBe(14);
  });
  it('falls back to the overall σ when that source has no (valid) fit', () => {
    expect(modelSigma(cal({ sigma_by_source: { home_court: bySource.home_court } }), 'spread')).toBe(13);
    expect(modelSigma(cal({ sigma_by_source: { spread: { ...bySource.spread, sigma: 0 } } }), 'spread')).toBe(13);
    expect(modelSigma(cal({ sigma_by_source: { spread: { ...bySource.spread, sigma: Number.NaN } } }), 'spread')).toBe(13);
    expect(modelSigma(cal(), 'spread')).toBe(13);
  });
  it('falls back to the default σ without a (valid) calibration', () => {
    expect(modelSigma(null, 'spread')).toBe(DEFAULT_SIGMA);
    expect(modelSigma(cal({ sigma: -1 }), 'home_court')).toBe(DEFAULT_SIGMA);
  });
});
