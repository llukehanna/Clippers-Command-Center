import { describe, it, expect } from 'vitest';
import { parseNBAClock, clockToSecondsRemaining } from './nba-live-client.js';

describe('parseNBAClock', () => {
  it('converts ISO 8601 clock to MM:SS', () => {
    expect(parseNBAClock('PT04M32.00S')).toBe('4:32');
  });

  it('converts clock at exactly 0:00', () => {
    expect(parseNBAClock('PT00M00.00S')).toBe('0:00');
  });

  it('returns 0:00 for empty string (game not in progress)', () => {
    expect(parseNBAClock('')).toBe('0:00');
  });

  it('converts double-digit minutes', () => {
    expect(parseNBAClock('PT12M00.00S')).toBe('12:00');
  });

  it('handles single-digit minute with zero-padded seconds', () => {
    expect(parseNBAClock('PT1M05.00S')).toBe('1:05');
  });
});

describe('clockToSecondsRemaining', () => {
  it('converts ISO 8601 clock to total seconds remaining', () => {
    expect(clockToSecondsRemaining('PT04M32.00S')).toBe(272);
  });

  it('returns 0 for zero clock', () => {
    expect(clockToSecondsRemaining('PT00M00.00S')).toBe(0);
  });

  it('returns 0 for empty string (game not in progress)', () => {
    expect(clockToSecondsRemaining('')).toBe(0);
  });

  it('converts 12 minutes to 720 seconds', () => {
    expect(clockToSecondsRemaining('PT12M00.00S')).toBe(720);
  });
});
