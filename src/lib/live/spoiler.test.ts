import { describe, it, expect } from 'vitest';
import {
  addFrame,
  addOffsetSample,
  clampDelay,
  clockOffset,
  frameTime,
  OFFSET_SAMPLES,
  parseStoredDelay,
  pickFrame,
  syncDelay,
  type Frame,
} from './spoiler';

const F = (at: number, value: number): Frame<number> => ({ at, value });
const ats = (frames: Frame<number>[]) => frames.map((f) => f.at);

describe('clampDelay / parseStoredDelay', () => {
  it('keeps whole seconds between 0 and 120', () => {
    expect(clampDelay(7_400)).toBe(7_000);
    expect(clampDelay(7_600)).toBe(8_000);
    expect(clampDelay(-5)).toBe(0);
    expect(clampDelay(999_999)).toBe(120_000);
    expect(clampDelay(Number.NaN)).toBe(0);
  });
  it('reads a stored value defensively', () => {
    expect(parseStoredDelay('30000')).toBe(30_000);
    expect(parseStoredDelay(null)).toBe(0);
    expect(parseStoredDelay('abc')).toBe(0);
    expect(parseStoredDelay('500000')).toBe(120_000);
  });
});

describe('addFrame', () => {
  it('keeps frames in play order, even when one arrives late', () => {
    expect(ats(addFrame([F(10, 1), F(30, 3)], F(20, 2), 30))).toEqual([10, 20, 30]);
  });
  it('puts a frame with the same time after the existing one', () => {
    expect(addFrame([F(10, 1)], F(10, 2), 10).map((f) => f.value)).toEqual([1, 2]);
  });
  it('drops frames older than 150 s but keeps the newest of those as a floor', () => {
    const frames = addFrame([F(10_000, 1), F(40_000, 2), F(60_000, 3)], F(190_000, 4), 200_000);
    expect(ats(frames)).toEqual([40_000, 60_000, 190_000]);
  });
});

describe('pickFrame', () => {
  const frames = [F(1_000, 1), F(5_000, 2), F(9_000, 3)];
  it('shows the newest frame at least `delay` old', () => {
    expect(pickFrame(frames, 10_000, 0)?.value).toBe(3);
    expect(pickFrame(frames, 10_000, 2_000)?.value).toBe(2);
    expect(pickFrame(frames, 10_000, 6_000)?.value).toBe(1);
  });
  it('holds (null) while nothing is that old yet', () => {
    expect(pickFrame(frames, 10_000, 9_500)).toBeNull();
    expect(pickFrame([], 10_000, 0)).toBeNull();
  });
});

describe('syncDelay', () => {
  // value = total points on the scoreboard
  const frames = [F(1_000, 10), F(3_000, 10), F(5_000, 12), F(8_000, 12), F(9_000, 15)];
  it('measures from the newest basket at or before the tap', () => {
    expect(syncDelay(frames, 29_000, (v) => v)).toBe(20_000);
    expect(syncDelay(frames, 8_500, (v) => v)).toBe(4_000); // 3.5 s rounds to 4
  });
  it('is null without a basket, or when scores are unknown', () => {
    expect(syncDelay([F(1_000, 10), F(2_000, 10)], 5_000, (v) => v)).toBeNull();
    expect(syncDelay(frames, 29_000, () => null)).toBeNull();
  });
  it('never exceeds the maximum delay', () => {
    expect(syncDelay(frames, 500_000, (v) => v)).toBe(120_000);
  });
});

describe('clock offset', () => {
  it('keeps the last 20 samples and ignores non-numbers', () => {
    let s: number[] = [];
    for (let i = 0; i < 25; i++) s = addOffsetSample(s, i);
    expect(s).toHaveLength(OFFSET_SAMPLES);
    expect(s[0]).toBe(5);
    expect(addOffsetSample(s, Number.NaN)).toBe(s);
  });
  it('uses the smallest sample, 0 before any', () => {
    expect(clockOffset([300, 120, 900])).toBe(120);
    expect(clockOffset([])).toBe(0);
  });
  it('dates a frame by its play, in device time, never later than it arrived', () => {
    const observed = '2026-10-22T02:40:00.000Z';
    const played = Date.parse(observed);
    expect(frameTime(observed, 250, played + 5_000)).toBe(played + 250);
    expect(frameTime(observed, 250, played + 100)).toBe(played + 100);
    expect(frameTime(null, 250, 42)).toBe(42);
    expect(frameTime('not a date', 250, 42)).toBe(42);
  });
});
