import { describe, expect, it } from 'vitest';
import { fmtDate, fmtShort, gapSpan, monthsBetween, seasonText, spanLabel, yearsBetween, yearsSpan } from './time';

describe('time helpers', () => {
  it.each([
    ['2018-03-26', '2026-11-15', '8½ years'],
    ['2021-12-04', '2026-11-13', '4½ years'],
    ['2026-03-01', '2026-11-15', '8 months'], // 8 months 14 days: down, not up,
    ['2025-11-01', '2026-11-15', '1 year'],
  ])('spanLabel(%s, %s) = %s', (a, b, out) => {
    expect(spanLabel(a, b)).toBe(out);
  });

  it('spanLabel never reads 12 months and never rounds up to a year', () => {
    expect(spanLabel('2025-11-20', '2026-11-15')).toBe('11 months');
    expect(spanLabel('2025-11-15', '2026-11-15')).toBe('1 year');
  });

  it('rounds DOWN to the half-year: 1.76 years reads 1½', () => {
    // Feb 10, 2025 -> Nov 13, 2026 is 1 year 9 months (1.76 years)
    expect(gapSpan('2025-02-10', '2026-11-13')).toEqual({ n: 1, unit: 'year', half: true });
    expect(spanLabel('2025-02-10', '2026-11-13')).toBe('1½ years');
    // 2 years less a day is still 1½
    expect(spanLabel('2024-11-14', '2026-11-13')).toBe('1½ years');
    expect(spanLabel('2024-11-13', '2026-11-13')).toBe('2 years');
    expect(yearsSpan(1.76)).toEqual({ n: 1, unit: 'year', half: true });
    expect(yearsSpan(4.99)).toEqual({ n: 4, unit: 'year', half: true });
    expect(yearsSpan(2)).toEqual({ n: 2, unit: 'year', half: false });
  });

  it('under a year: whole months down, then weeks from 14 days, then days', () => {
    expect(monthsBetween('2026-03-26', '2026-11-15')).toBe(7);
    expect(gapSpan('2026-05-14', '2026-11-13')).toEqual({ n: 5, unit: 'month', half: false });
    expect(gapSpan('2026-10-31', '2026-11-29')).toEqual({ n: 4, unit: 'week', half: false });
    expect(gapSpan('2026-11-01', '2026-11-13')).toEqual({ n: 12, unit: 'day', half: false });
    expect(yearsSpan(0.4)).toEqual({ n: 4, unit: 'month', half: false });
    expect(yearsSpan(0.05)).toEqual({ n: 2, unit: 'week', half: false });
  });

  it('yearsBetween is days / 365.25', () => {
    expect(yearsBetween('2025-01-01', '2026-01-01')).toBeCloseTo(365 / 365.25, 6);
  });

  it('formats dates without timezone drift', () => {
    expect(fmtDate('2018-03-26')).toBe('Mar 26, 2018');
    expect(fmtShort('2026-11-15')).toBe('Nov 15');
  });

  it('seasonText uses an en dash', () => {
    expect(seasonText(2025)).toBe('2025–26');
    expect(seasonText(1999)).toBe('1999–00');
  });
});
