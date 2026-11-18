import { describe, it, expect } from 'vitest';
import { shotZone, toCourt, zoneSummary, type Shot } from './shots';

const shot = (x: number, y: number, made: boolean, value: 2 | 3): Shot => ({ x, y, made, value, player_id: '1', player: 'A' });

describe('shotZone', () => {
  it('classifies twos by distance and paint box', () => {
    expect(shotZone(25, 1, 2)).toBe('rim');
    expect(shotZone(28, 2, 2)).toBe('rim');
    expect(shotZone(25, 10, 2)).toBe('paint');
    expect(shotZone(31, 12, 2)).toBe('paint');
    expect(shotZone(10, 15, 2)).toBe('mid');
    expect(shotZone(25, 18, 2)).toBe('mid');
  });
  it('splits threes into corner and above the break', () => {
    expect(shotZone(2, 5, 3)).toBe('corner3');
    expect(shotZone(48, 8, 3)).toBe('corner3');
    expect(shotZone(25, 26, 3)).toBe('above3');
    expect(shotZone(5, 14, 3)).toBe('above3');
  });
});

describe('toCourt', () => {
  it('puts the hoop 5.25 ft off the baseline at 10 units per foot', () => {
    expect(toCourt(25, 0)).toEqual({ cx: 250, cy: 52.5 });
    expect(toCourt(0, 10)).toEqual({ cx: 0, cy: 152.5 });
  });
});

describe('zoneSummary', () => {
  it('counts makes and attempts for every zone in a fixed order', () => {
    const out = zoneSummary([shot(25, 1, true, 2), shot(25, 1, false, 2), shot(2, 5, true, 3)]);
    expect(out).toEqual([
      { zone: 'rim', made: 1, att: 2 },
      { zone: 'paint', made: 0, att: 0 },
      { zone: 'mid', made: 0, att: 0 },
      { zone: 'corner3', made: 1, att: 1 },
      { zone: 'above3', made: 0, att: 0 },
    ]);
  });
});
