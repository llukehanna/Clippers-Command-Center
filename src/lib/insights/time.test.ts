import { describe, expect, it } from 'vitest';
import { fmtDate, fmtShort, seasonText, spanLabel, yearsBetween } from './time';

describe('time helpers', () => {
  it.each([
    ['2018-03-26', '2026-11-15', '8½ years'],
    ['2021-12-04', '2026-11-13', '5 years'],
    ['2026-03-01', '2026-11-15', '9 months'],
    ['2025-11-01', '2026-11-15', '1 year'],
  ])('spanLabel(%s, %s) = %s', (a, b, out) => {
    expect(spanLabel(a, b)).toBe(out);
  });

  it('spanLabel never reads 12 months', () => {
    expect(spanLabel('2025-11-20', '2026-11-15')).toBe('1 year');
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
