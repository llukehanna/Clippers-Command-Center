import { describe, it, expect } from 'vitest';
import { binomialTail, restDays, restSituations } from './stats';

describe('binomialTail', () => {
  it('gives the chance of a last-10 record at least this extreme', () => {
    expect(binomialTail(10, 8, 0.5, true)).toBeCloseTo(56 / 1024, 12);
    expect(binomialTail(10, 2, 0.5, false)).toBeCloseTo(56 / 1024, 12);
    expect(binomialTail(10, 0, 0.5, true)).toBeCloseTo(1, 12);
  });
});

describe('rest', () => {
  it('counts days of rest (0 = back-to-back)', () => {
    expect(restDays('2026-11-17', '2026-11-18')).toBe(0);
    expect(restDays('2026-11-15', '2026-11-18')).toBe(2);
    expect(restDays(null, '2026-11-18')).toBeNull();
  });
  it('names back-to-backs and real rest edges, not offseason gaps', () => {
    expect(restSituations(0, 2)).toEqual(['lac_b2b', 'rest_edge']);
    expect(restSituations(3, 0)).toEqual(['opp_b2b', 'rest_edge']);
    expect(restSituations(1, 1)).toEqual([]);
    expect(restSituations(280, 280)).toEqual([]);
    expect(restSituations(0, null)).toEqual(['lac_b2b']);
  });
});
