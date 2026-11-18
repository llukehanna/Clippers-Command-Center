import { describe, it, expect } from 'vitest';
import { flowFromSeries, periodEnds, periodsReached } from './flow-from-series';
import { pregameLacWinProb } from './win-prob';

const MODEL = { expected: 3, sigma: 13 };

describe('periodEnds / periodsReached', () => {
  it('lists regulation and overtime buzzers', () => {
    expect(periodEnds(4)).toEqual([720, 1440, 2160, 2880]);
    expect(periodEnds(6)).toEqual([720, 1440, 2160, 2880, 3180, 3480]);
  });
  it('extends the period count when the series runs into overtime', () => {
    expect(periodsReached([[0, 0], [2900, 2]], 4)).toBe(5);
    expect(periodsReached([[0, 0], [100, 2]], 4)).toBe(4);
  });
});

describe('flowFromSeries', () => {
  const series: [number, number][] = [[0, 0], [30, 2], [60, 4], [90, 7], [100, 9], [200, 6], [800, -1], [2870, 5]];
  const flow = flowFromSeries(series, 4, MODEL, new Map([[100, 'Kawhi Leonard makes 2-pt jump shot']]));

  it('starts at the tip with the pregame win probability', () => {
    expect(flow.points[0]).toEqual({ t: 0, m: 0, wp: Math.round(pregameLacWinProb(3, 13) * 1000) / 1000, a: 0, d: '' });
  });
  it('adds a point at every period end with the margin at that moment', () => {
    const ends = flow.points.filter((p) => [720, 1440, 2160, 2880].includes(p.t));
    expect(ends.map((p) => p.m)).toEqual([6, -1, -1, 5]);
    expect(flow.markers.filter((m) => m.kind === 'period_end')).toHaveLength(4);
  });
  it('ends at certainty for the winner', () => {
    expect(flow.points.at(-1)).toMatchObject({ t: 2880, m: 5, wp: 1 });
  });
  it('marks runs of 8+, lead changes and the largest leads', () => {
    expect(flow.markers).toContainEqual({ kind: 'run', t: 100, t_start: 30, side: 'lac', pts: 9 });
    expect(flow.markers).toContainEqual({ kind: 'lead_change', t: 800, side: 'opp' });
    expect(flow.markers).toContainEqual({ kind: 'lead_change', t: 2870, side: 'lac' });
    expect(flow.markers).toContainEqual({ kind: 'max_lead', t: 100, side: 'lac', margin: 9 });
    expect(flow.markers).toContainEqual({ kind: 'max_lead', t: 800, side: 'opp', margin: 1 });
  });
  it('attaches play descriptions by elapsed second', () => {
    expect(flow.points.find((p) => p.t === 100)?.d).toBe('Kawhi Leonard makes 2-pt jump shot');
    expect(flow.points.find((p) => p.t === 30)?.d).toBe('');
  });
  it('keeps markers sorted by time', () => {
    const ts = flow.markers.map((m) => m.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });
});
