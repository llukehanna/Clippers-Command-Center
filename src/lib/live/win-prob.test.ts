import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SIGMA,
  elapsedSecs,
  expectedLacMargin,
  formatClock,
  formatGameTime,
  normalCdf,
  periodClockAt,
  periodName,
  remainingFraction,
  winProbability,
} from './win-prob';

describe('normalCdf', () => {
  it('matches known values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
    expect(normalCdf(1) + normalCdf(-1)).toBeCloseTo(1, 7);
  });
});

describe('game clock', () => {
  it('converts period and clock to elapsed seconds', () => {
    expect(elapsedSecs(1, 720)).toBe(0);
    expect(elapsedSecs(2, 272)).toBe(1168);
    expect(elapsedSecs(4, 0)).toBe(2880);
    expect(elapsedSecs(5, 300)).toBe(2880);
    expect(elapsedSecs(6, 0)).toBe(3480);
  });

  it('maps elapsed seconds back; a boundary belongs to the period it ends', () => {
    expect(periodClockAt(0)).toEqual({ period: 1, clockSec: 720 });
    expect(periodClockAt(720)).toEqual({ period: 1, clockSec: 0 });
    expect(periodClockAt(721)).toEqual({ period: 2, clockSec: 719 });
    expect(periodClockAt(2880)).toEqual({ period: 4, clockSec: 0 });
    expect(periodClockAt(2990)).toEqual({ period: 5, clockSec: 190 });
  });

  it('formats clocks and game times', () => {
    expect(formatClock(272)).toBe('4:32');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(1080)).toBe('18:00');
    expect(periodName(3)).toBe('Q3');
    expect(periodName(5)).toBe('OT');
    expect(periodName(6)).toBe('2OT');
    expect(formatGameTime(1168)).toBe('Q2 4:32');
    expect(formatGameTime(2990)).toBe('OT 3:10');
    expect(formatGameTime(3240)).toBe('2OT 4:00');
  });

  it('gives the fraction of regulation left, or of the OT period in overtime', () => {
    expect(remainingFraction(1, 720)).toBe(1);
    expect(remainingFraction(3, 360)).toBeCloseTo(1080 / 2880, 10);
    expect(remainingFraction(4, 0)).toBe(0);
    expect(remainingFraction(5, 300)).toBeCloseTo(300 / 2880, 10);
  });
});

describe('winProbability (stern-v1)', () => {
  const even = { expected: 0, sigma: DEFAULT_SIGMA };

  it('a tie with no time left is a coin flip — the game goes to overtime', () => {
    expect(winProbability({ ...even, margin: 0, period: 4, clockSec: 0 })).toBe(0.5);
    expect(winProbability({ margin: 0, period: 5, clockSec: 0, expected: 6, sigma: 12 })).toBe(0.5);
  });

  it('any lead with no time left is decided', () => {
    expect(winProbability({ ...even, margin: 1, period: 4, clockSec: 0 })).toBe(1);
    expect(winProbability({ ...even, margin: -1, period: 4, clockSec: 0 })).toBe(0);
  });

  it('a big lead late approaches 1', () => {
    expect(winProbability({ ...even, margin: 15, period: 4, clockSec: 60 })).toBeGreaterThan(0.999);
  });

  it('pregame equals Φ(E / σ)', () => {
    const p = winProbability({ margin: 0, period: 1, clockSec: 720, expected: 4.5, sigma: 12.5 });
    expect(p).toBeCloseTo(normalCdf(4.5 / 12.5), 10);
    expect(p).toBeCloseTo(0.6406, 3);
  });

  it('is symmetric between the two teams', () => {
    const a = winProbability({ margin: 6, period: 3, clockSec: 300, expected: 3, sigma: 12 });
    const b = winProbability({ margin: -6, period: 3, clockSec: 300, expected: -3, sigma: 12 });
    expect(a + b).toBeCloseTo(1, 10);
  });

  it("the favorite's edge in a tie fades as time runs out", () => {
    const at = (period: number, clockSec: number) => winProbability({ margin: 0, period, clockSec, expected: 5, sigma: 12 });
    expect(at(1, 720)).toBeGreaterThan(at(4, 360));
    expect(at(4, 360)).toBeGreaterThan(0.5);
  });
});

describe('expectedLacMargin', () => {
  it('is minus the Clippers spread', () => {
    expect(expectedLacMargin(-4.5, true)).toEqual({ expected: 4.5, source: 'spread' });
    expect(expectedLacMargin(3, false)).toEqual({ expected: -3, source: 'spread' });
    expect(expectedLacMargin(0, true)).toEqual({ expected: 0, source: 'spread' });
  });

  it('falls back to home court', () => {
    expect(expectedLacMargin(null, true)).toEqual({ expected: 2.5, source: 'home_court' });
    expect(expectedLacMargin(undefined, false)).toEqual({ expected: -2.5, source: 'home_court' });
  });
});
