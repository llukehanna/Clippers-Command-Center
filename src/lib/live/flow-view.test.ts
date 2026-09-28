import { describe, it, expect } from 'vitest';
import { flowDomainEnd, flowRows, flowSummary, marginDomain, marginText, markersOf, periodTicks, tickLabel } from './flow-view';
import type { LiveFlow } from '../types/live-state';

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
});
