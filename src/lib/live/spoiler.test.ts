import { describe, it, expect } from 'vitest';
import {
  addFrame,
  addOffsetSample,
  clampDelay,
  clockOffset,
  frameDeviceTime,
  isOldEnough,
  OFFSET_SAMPLES,
  offsetSample,
  pageFramePlayed,
  parseStoredDelay,
  pickFrame,
  pushFramePlayed,
  syncDelay,
  type Frame,
} from './spoiler';

/** A frame known only by its arrival (device clock). */
const A = (arrived: number, value: number): Frame<number> => ({ played: null, arrived, value });
/** A frame with a play time (server clock) and an arrival (device clock). */
const P = (played: number, arrived: number, value: number): Frame<number> => ({ played, arrived, value });
const arrivals = (frames: Frame<number>[]) => frames.map((f) => f.arrived);

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
  it('keeps frames in arrival order', () => {
    expect(arrivals(addFrame([A(10, 1), A(30, 3)], A(20, 2), 30))).toEqual([10, 20, 30]);
  });
  it('puts a frame that arrived at the same time after the existing one', () => {
    expect(addFrame([A(10, 1)], A(10, 2), 10).map((f) => f.value)).toEqual([1, 2]);
  });
  it('drops frames that arrived over 150 s ago but keeps the newest of those as a floor', () => {
    const frames = addFrame([A(10_000, 1), A(40_000, 2), A(60_000, 3)], A(190_000, 4), 200_000);
    expect(arrivals(frames)).toEqual([40_000, 60_000, 190_000]);
  });
  it('keeps a replayed frame with an old play time: pruning goes by arrival', () => {
    const frames = addFrame([], P(10_000, 200_000, 1), 200_000);
    expect(frames).toHaveLength(1);
  });
});

describe('isOldEnough / pickFrame', () => {
  it('shows the newest frame at least `delay` old by arrival (device clock)', () => {
    const frames = [A(1_000, 1), A(5_000, 2), A(9_000, 3)];
    expect(pickFrame(frames, 10_000, 0, 0)?.value).toBe(3);
    expect(pickFrame(frames, 10_000, 0, 2_000)?.value).toBe(2);
    expect(pickFrame(frames, 10_000, 0, 6_000)?.value).toBe(1);
  });
  it('holds (null) while nothing is that old yet', () => {
    expect(pickFrame([A(1_000, 1), A(9_000, 3)], 10_000, 0, 9_500)).toBeNull();
    expect(pickFrame([], 10_000, 0, 0)).toBeNull();
  });
  it('lets a play time qualify a frame that arrived recently, compared in the server clock', () => {
    // Device 2 s ahead of the server (offset 2 000). Played at server 1 000,
    // i.e. device 3 000; arrived at device 9 500.
    const f = P(1_000, 9_500, 7);
    expect(isOldEnough(f, 10_000, 2_000, 7_000)).toBe(true); // 1 000 ≤ 10 000 − 2 000 − 7 000
    expect(isOldEnough(f, 10_000, 2_000, 7_500)).toBe(false);
    // An over-estimated offset only makes it later.
    expect(isOldEnough(f, 10_000, 3_000, 7_000)).toBe(false);
  });

  it('never qualifies a fresh poll early after a stale CDN copy inflated the first offset sample', () => {
    // Clocks in sync, delay 8 s. The first /api/live response is a 10 s stale
    // CDN copy: its sample says the device is 10 s ahead.
    const T = 1_000_000;
    const delay = 8_000;
    let samples = addOffsetSample([], offsetSample(T - 20_000, T - 30_000));
    expect(clockOffset(samples)).toBe(10_000);
    // A fresh poll arrives at T with a basket observed at T − 3 s, and its own
    // sample (0.1 s of network) lowers the offset.
    const frame = P(pageFramePlayed(new Date(T - 3_000).toISOString(), false)!, T, 42);
    samples = addOffsetSample(samples, offsetSample(T, T - 100));
    const offset = clockOffset(samples);
    expect(offset).toBe(100);
    // Stamping the arrival into server time with the old 10 s offset would
    // have dated it T − 10 s and shown it at T − 2 s (on arrival): 5 s before
    // the TV shows it at T − 3 s + 8 s. Compared each in its own clock, it
    // qualifies only once its play is 8 s old in the server's time…
    for (let now = T; now < T + 5_100; now += 100) expect(isOldEnough(frame, now, offset, delay)).toBe(false);
    expect(isOldEnough(frame, T + 5_100, offset, delay)).toBe(true);
    // …which is never before the TV shows it (T + 5 s) — and it's no earlier than
    // arrival + delay on the arrival side either.
    expect(frame.arrived + delay).toBeGreaterThan(T + 5_000);
    expect(pickFrame([frame], T + 4_000, offset, delay)).toBeNull();
  });

  it('counts an ESPN backup frame from its arrival only, whatever the offset', () => {
    const T = 1_000_000;
    const frame: Frame<number> = { played: pageFramePlayed('2026-10-22T02:40:00.000Z', true), arrived: T, value: 5 };
    expect(frame.played).toBeNull();
    // A huge (or negative) offset changes nothing: only arrival + delay counts.
    for (const offset of [0, 60_000, -60_000]) {
      expect(isOldEnough(frame, T + 7_999, offset, 8_000)).toBe(false);
      expect(isOldEnough(frame, T + 8_000, offset, 8_000)).toBe(true);
    }
  });
});

describe('syncDelay', () => {
  // value = total points on the scoreboard; arrival-only frames
  const frames = [A(1_000, 10), A(3_000, 10), A(5_000, 12), A(8_000, 12), A(9_000, 15)];
  it('measures from the newest basket at or before the tap', () => {
    expect(syncDelay(frames, 29_000, 0, (v) => v)).toBe(20_000);
    expect(syncDelay(frames, 8_500, 0, (v) => v)).toBe(4_000); // 3.5 s rounds to 4
  });
  it('uses the play time, shifted into the device clock, when it is earlier than the arrival', () => {
    // Played at server 2 000 (device 2 500 with offset 500), arrived 6 000.
    const f = [P(1_000, 5_000, 10), P(2_000, 6_000, 12)];
    expect(frameDeviceTime(f[1], 500)).toBe(2_500);
    expect(syncDelay(f, 12_500, 500, (v) => v)).toBe(10_000);
    // With an inflated offset the arrival is the tighter bound.
    expect(frameDeviceTime(f[1], 9_000)).toBe(6_000);
    expect(syncDelay(f, 12_500, 9_000, (v) => v)).toBe(7_000); // 6.5 s rounds to 7
  });
  it('is null without a basket, or when scores are unknown', () => {
    expect(syncDelay([A(1_000, 10), A(2_000, 10)], 5_000, 0, (v) => v)).toBeNull();
    expect(syncDelay(frames, 29_000, 0, () => null)).toBeNull();
  });
  it('never exceeds the maximum delay', () => {
    expect(syncDelay(frames, 500_000, 0, (v) => v)).toBe(120_000);
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

describe('pushFramePlayed', () => {
  const observed = '2026-10-22T02:40:00.000Z';
  const played = Date.parse(observed);
  it('is the play time, capped at when the hub relayed it', () => {
    expect(pushFramePlayed(observed, played + 3_000)).toBe(played);
    expect(pushFramePlayed(observed, played - 500)).toBe(played - 500);
  });
  it('uses whichever server stamp exists, and is null (arrival only) with neither', () => {
    expect(pushFramePlayed(observed, undefined)).toBe(played);
    expect(pushFramePlayed(null, 1_234)).toBe(1_234);
    expect(pushFramePlayed(null, undefined)).toBeNull();
    expect(pushFramePlayed('not a date', undefined)).toBeNull();
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
      frames = addFrame(frames, { played: pushFramePlayed(m.observed, m.hubAt), arrived: receivedAt, value: m.score }, receivedAt);
    }
    // Every replayed frame keeps its own play time, 10 s apart, in order.
    expect(frames.map((f) => f.value)).toEqual(replay.map((m) => m.score));
    expect(frames.map((f) => f.played)).toEqual(replay.map((m) => Date.parse(m.observed)));
    // The offset has converged on the newest replayed message's sample.
    const offset = clockOffset(samples);
    expect(offset).toBe(T + 50 - replay[14].hubAt);
    // One second after connect a 30 s delay already has a frame: the play that
    // happened at least 30 s ago in the hub's clock.
    const now = T + 1_000;
    const picked = pickFrame(frames, now, offset, 30_000);
    expect(picked!.value).toBe(22);
    expect(picked!.played!).toBeLessThanOrEqual(now - offset - 30_000);
    // …and an 8 s delay shows the newest play that is at least 8 s old.
    expect(pickFrame(frames, now, offset, 8_000)!.value).toBe(26);
  });
});

describe('pageFramePlayed', () => {
  it('is the payload’s play time, or null for an ESPN backup overlay or an unknown play', () => {
    const observed = '2026-10-22T02:40:00.000Z';
    expect(pageFramePlayed(observed, false)).toBe(Date.parse(observed));
    expect(pageFramePlayed(observed, true)).toBeNull();
    expect(pageFramePlayed(null, false)).toBeNull();
  });
});
