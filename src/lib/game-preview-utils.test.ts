import { describe, it, expect } from 'vitest';
import { daysSince, lacSpreadSeries, latestLacLine, sparklinePath, type OddsRow } from './game-preview-utils';

const r = (t: string, home: number | null, ml: number | null = null): OddsRow => ({
  captured_at: t, spread_home: home, spread_away: home == null ? null : -home, moneyline_home: ml, moneyline_away: ml == null ? null : -ml, total_points: 224.5,
});

describe('lacSpreadSeries / latestLacLine', () => {
  const rows = [r('2026-11-18T12:00:00Z', -2.5, -130), r('2026-11-19T00:00:00Z', null), r('2026-11-19T12:00:00Z', -1.5, -120)];
  it('reads the Clippers side for home and away games', () => {
    expect(lacSpreadSeries(rows, true).map((p) => p.spread)).toEqual([-2.5, -1.5]);
    expect(lacSpreadSeries(rows, false).map((p) => p.spread)).toEqual([2.5, 1.5]);
  });
  it('returns the latest snapshot from the Clippers side', () => {
    expect(latestLacLine(rows, false)).toEqual({ spread: 1.5, moneyline: 120, over_under: 224.5, captured_at: '2026-11-19T12:00:00Z' });
    expect(latestLacLine([], true)).toBeNull();
  });
});

describe('daysSince', () => {
  it('counts calendar days, 1 being a back-to-back', () => {
    expect(daysSince('2026-11-20', '2026-11-19')).toBe(1);
    expect(daysSince('2026-11-20', '2026-11-17')).toBe(3);
    expect(daysSince('2026-11-20', null)).toBeNull();
  });
});

describe('sparklinePath', () => {
  it('maps the range onto the box, highest value at the top', () => {
    expect(sparklinePath([0, 1], 10, 10, 0)).toBe('M0.0,10.0 L10.0,0.0');
    expect(sparklinePath([2, 2, 2], 20, 10, 0)).toBe('M0.0,5.0 L10.0,5.0 L20.0,5.0');
    expect(sparklinePath([1], 10, 10)).toBe('');
  });
});
