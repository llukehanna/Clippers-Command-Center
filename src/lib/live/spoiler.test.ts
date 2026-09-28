import { describe, it, expect } from 'vitest';
import {
  addFrame,
  addOffsetSample,
  clampDelay,
  clockOffset,
  frameTime,
  OFFSET_SAMPLES,
  offsetSample,
  pageFrameTime,
  parseStoredDelay,
  pickFrame,
  pushFrameTime,
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
  it('dates a frame by its play, shifted into the arrival clock, never later than it arrived', () => {
    const observed = '2026-10-22T02:40:00.000Z';
    const played = Date.parse(observed);
    expect(frameTime(observed, 250, played + 5_000)).toBe(played + 250);
    expect(frameTime(observed, 250, played + 100)).toBe(played + 100);
    expect(frameTime(null, 250, 42)).toBe(42);
    expect(frameTime('not a date', 250, 42)).toBe(42);
  });
});

describe('offsetSample', () => {
  it('is receive time minus the server stamp, from a number or an ISO string', () => {
    expect(offsetSample(10_000, 9_200)).toBe(800);
    expect(offsetSample(Date.parse('2026-10-22T02:40:01.000Z'), '2026-10-22T02:40:00.000Z')).toBe(1_000);
  });
  it('is NaN (ignored by addOffsetSample) without a usable stamp', () => {
    for (const stamp of [null, undefined, 'nope']) {
      const sample = offsetSample(10_000, stamp);
      expect(Number.isNaN(sample)).toBe(true);
      expect(addOffsetSample([5], sample)).toEqual([5]);
    }
  });
});

describe('pushFrameTime', () => {
  const observed = '2026-10-22T02:40:00.000Z';
  const played = Date.parse(observed);
  it('dates a pushed state by its play, capped at when the hub relayed it', () => {
    expect(pushFrameTime(observed, played + 3_000, played + 9_000)).toBe(played);
    expect(pushFrameTime(observed, played - 500, played + 9_000)).toBe(played - 500);
  });
  it('falls back to the hub-clock arrival without hub_at or a play time', () => {
    expect(pushFrameTime(observed, undefined, played + 2_000)).toBe(played);
    expect(pushFrameTime(null, undefined, 42)).toBe(42);
    expect(pushFrameTime(null, 1_234, 9_999)).toBe(1_234);
  });

  it('keeps a hub replay at its play-time spacing', () => {
    // The device clock runs 2 s ahead of the hub; 50 ms network. On connect the
    // hub resends 15 stored messages (a basket every 10 s over the last 140 s,
    // each relayed 4 s after its play) with their original hub_at, all at T.
    const T = 1_000_000;
    const skew = 2_000;
    const replay = Array.from({ length: 15 }, (_, i) => {
      const hubAt = T - skew - 140_000 + i * 10_000;
      return { score: i * 2, hubAt, observed: new Date(hubAt - 4_000).toISOString() };
    });
    let samples: number[] = [];
    let frames: Frame<number>[] = [];
    for (const m of replay) {
      const receivedAt = T + 50;
      samples = addOffsetSample(samples, offsetSample(receivedAt, m.hubAt));
      const hubNow = receivedAt - clockOffset(samples);
      frames = addFrame(frames, { at: pushFrameTime(m.observed, m.hubAt, hubNow), value: m.score }, hubNow);
    }
    // Every replayed frame sits at its own play time, 10 s apart.
    expect(frames.map((f) => f.value)).toEqual(replay.map((m) => m.score));
    expect(ats(frames)).toEqual(replay.map((m) => Date.parse(m.observed)));
    // The offset has converged on the newest replayed message's sample.
    const offset = clockOffset(samples);
    expect(offset).toBe(T + 50 - replay[14].hubAt);
    // One second after connect a 30 s delay already has a frame: the play that
    // happened at least 30 s ago in the hub's clock.
    const frameNow = T + 1_000 - offset;
    const picked = pickFrame(frames, frameNow, 30_000);
    expect(picked).not.toBeNull();
    expect(Date.parse(replay.find((m) => m.score === picked!.value)!.observed)).toBeLessThanOrEqual(frameNow - 30_000);
    expect(picked!.value).toBe(22);
    // …and an 8 s delay shows the newest play that is at least 8 s old.
    expect(pickFrame(frames, frameNow, 8_000)!.value).toBe(26);
  });
});

describe('pageFrameTime', () => {
  const observed = '2026-10-22T02:40:00.000Z';
  const played = Date.parse(observed);
  it('dates a payload by its play, never later than it arrived', () => {
    expect(pageFrameTime(observed, played + 6_000, false)).toBe(played);
    expect(pageFrameTime(observed, played - 1_000, false)).toBe(played - 1_000);
    expect(pageFrameTime(null, 777, false)).toBe(777);
  });
  it('dates an ESPN backup overlay by its arrival', () => {
    expect(pageFrameTime(observed, played + 6_000, true)).toBe(played + 6_000);
  });
});
