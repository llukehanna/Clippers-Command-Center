import { describe, it, expect } from 'vitest';
import { parseMinutes } from './advanced-stats';

describe('parseMinutes', () => {
  it('parses NBA ISO-8601 durations', () => {
    expect(parseMinutes('PT34M12.00S')).toBeCloseTo(34.2);
    expect(parseMinutes('PT05M')).toBe(5);
    expect(parseMinutes('PT45.00S')).toBeCloseTo(0.75);
    expect(parseMinutes('PT00M00.00S')).toBe(0);
  });

  it('parses mm:ss and bare minutes', () => {
    expect(parseMinutes('34:12')).toBeCloseTo(34.2);
    expect(parseMinutes('34')).toBe(34);
  });

  it('returns 0 for empty or junk', () => {
    expect(parseMinutes(null)).toBe(0);
    expect(parseMinutes('')).toBe(0);
    expect(parseMinutes('DNP')).toBe(0);
  });
});
