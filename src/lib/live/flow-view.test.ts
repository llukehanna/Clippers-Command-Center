import { describe, it, expect } from 'vitest';
import { flowDomainEnd, flowRows, flowSummary, largestLeadText, marginDomain, marginText, markersOf, modelFitNote, periodTicks, tickLabel } from './flow-view';
import type { LiveFlow, LiveWinProb, WpCalibration } from '../types/live-state';

const flow = (ts: [number, number][], markers: LiveFlow['markers'] = []): LiveFlow => ({
  points: ts.map(([t, m]) => ({ t, m, wp: 0.625, a: t, d: `play ${t}` })),
  markers,
});

describe('flow-view', () => {
  it('splits the margin into a lead area and a trail area, WP in percent', () => {
    expect(flowRows(flow([[10, 3], [20, -2]]))).toEqual([
      { t: 10, lead: 3, trail: 0, m: 3, wp: 62.5, d: 'play 10' },
      { t: 20, lead: 0, trail: -2, m: -2, wp: 62.5, d: 'play 20' },
    ]);
  });

  it('ends the axis at regulation, or at the end of the last overtime reached', () => {
    expect(flowDomainEnd(flow([[0, 0], [2000, 4]]))).toBe(2880);
    expect(flowDomainEnd(flow([[2990, 1]]))).toBe(3180);
    expect(flowDomainEnd(flow([[3180, 1]]))).toBe(3180);
    expect(flowDomainEnd(flow([[3181, 1]]))).toBe(3480);
  });

  it('ticks and labels each period start', () => {
    expect(periodTicks(2880)).toEqual([0, 720, 1440, 2160]);
    expect(periodTicks(3480)).toEqual([0, 720, 1440, 2160, 2880, 3180]);
    expect([0, 2160, 2880, 3180].map(tickLabel)).toEqual(['Q1', 'Q4', 'OT', '2OT']);
  });

  it('keeps the margin axis symmetric, in steps of 5, at least ±5', () => {
    expect(marginDomain(flow([[0, 0], [10, 3]]))).toEqual([-5, 5]);
    expect(marginDomain(flow([[0, 0], [10, -12]]))).toEqual([-15, 15]);
  });

  it('names the margin', () => {
    expect(marginText(4, 'SAC')).toBe('LAC +4');
    expect(marginText(-3, 'SAC')).toBe('SAC +3');
    expect(marginText(0, 'SAC')).toBe('Tied');
  });

  it('summarizes lead changes and the largest leads, and filters markers by kind', () => {
    const f = flow([[0, 0]], [
      { kind: 'lead_change', t: 100, side: 'opp' },
      { kind: 'max_lead', t: 200, side: 'lac', margin: 9 },
      { kind: 'lead_change', t: 300, side: 'lac' },
      { kind: 'max_lead', t: 150, side: 'opp', margin: 4 },
    ]);
    expect(flowSummary(f)).toEqual({ leadChanges: 2, lac: { margin: 9, t: 200 }, opp: { margin: 4, t: 150 } });
    expect(markersOf(f, 'lead_change').map((m) => m.t)).toEqual([100, 300]);
  });

  it('labels the largest leads whichever side led', () => {
    const lac = { margin: 9, t: 200 };
    const opp = { margin: 4, t: 150 };
    expect(largestLeadText({ leadChanges: 1, lac, opp }, 'SAC')).toBe('Largest lead LAC +9 · SAC +4');
    expect(largestLeadText({ leadChanges: 0, lac, opp: null }, 'SAC')).toBe('Largest lead LAC +9');
    expect(largestLeadText({ leadChanges: 0, lac: null, opp }, 'SAC')).toBe('Largest lead SAC +4');
    expect(largestLeadText({ leadChanges: 0, lac: null, opp: null }, 'SAC')).toBeNull();
  });
});

describe('modelFitNote', () => {
  const cal = (over: Partial<WpCalibration> = {}): WpCalibration => ({
    sigma: 21.8, brier: 0.178, n_games: 576, n_samples: 27_648, fitted_at: '2026-09-29T09:40:00Z', reliability: [], ...over,
  });
  const wp = (over: Partial<LiveWinProb> = {}): LiveWinProb => ({
    lac: 0.6, model: 'stern-v1', sigma: 12.5, expected_margin: 3.5, expected_source: 'spread', calibration: null, ...over,
  });
  const homeFit = { sigma: 21.7, brier: 0.1781, n_games: 573 };

  it("names the fit for the game's source of E", () => {
    expect(modelFitNote(wp({ expected_source: 'home_court', sigma: 21.7, calibration: cal({ sigma_by_source: { home_court: homeFit } }) })))
      .toEqual({ kind: 'fit', basis: 'home_court', n_games: 573, brier: 0.1781 });
  });
  it("says a spread game is on the default σ until spread games have their own fit", () => {
    expect(modelFitNote(wp({ calibration: cal({ sigma_by_source: { home_court: homeFit } }) }))).toEqual({ kind: 'default_until_spread_fit' });
  });
  it('falls back to the overall fit for a calibration without per-source fits', () => {
    expect(modelFitNote(wp({ sigma: 21.8, calibration: cal() }))).toEqual({ kind: 'fit', basis: 'all', n_games: 576, brier: 0.178 });
  });
  it('is uncalibrated without a calibration', () => {
    expect(modelFitNote(wp())).toEqual({ kind: 'uncalibrated' });
  });
});
