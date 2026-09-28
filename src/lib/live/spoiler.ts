// src/lib/live/spoiler.ts
// Spoiler sync (Live v2 spec §7.3). The page keeps what it showed over the
// last 150 s as frames and renders the newest frame at least `delay` old — so
// nothing shows before the fan's own TV or stream does.
//
// A frame carries two times, each in its own clock, and they're only ever
// compared in that clock:
// - `played`: when its newest play happened, in the server's clock (the NBA's
//   play time, capped by the hub's relay stamp). Compared against the device's
//   "now" minus the measured clock offset. The offset estimate only ever errs
//   high, which makes that comparison err late: safe.
// - `arrived`: when it reached this device, in the device's clock. Compared
//   against the device's own "now": exact, no offset involved. Converting an
//   arrival into server time instead would err *early* whenever the offset
//   estimate is high (a stale CDN copy inflates it by up to ~12 s), so it's
//   never done.
// A frame is old enough when either time is: the play is known to have
// happened `delay` ago, or the frame has been here that long. Pure.

export const SPOILER_BUFFER_MS = 150_000;
export const MAX_DELAY_MS = 120_000;
export const DELAY_STORAGE_KEY = 'ccc:spoiler-delay-ms';
export const DELAY_PRESETS = [
  { label: 'Off', ms: 0 },
  { label: 'TV', ms: 8_000 },
  { label: 'Stream', ms: 30_000 },
] as const;
/** Clock-offset samples kept; the smallest wins (it has the least network delay in it). */
export const OFFSET_SAMPLES = 20;

export interface Frame<T> {
  /** Server-clock ms of the newest play in `value`; null when unknown (an ESPN backup score). */
  played: number | null;
  /** Device-clock ms when `value` reached this device. */
  arrived: number;
  value: T;
}

/** Whole seconds, 0–120 s. */
export function clampDelay(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.min(MAX_DELAY_MS, Math.max(0, Math.round(ms / 1000) * 1000));
}

export function parseStoredDelay(raw: string | null): number {
  return raw === null ? 0 : clampDelay(Number(raw));
}

/**
 * Inserts in arrival order (device clock) and drops frames that arrived more
 * than 150 s before `now` (device clock), keeping the newest of those as a floor.
 */
export function addFrame<T>(frames: Frame<T>[], frame: Frame<T>, now: number): Frame<T>[] {
  const next = [...frames];
  let i = next.length;
  while (i > 0 && next[i - 1].arrived > frame.arrived) i--;
  next.splice(i, 0, frame);
  const cutoff = now - SPOILER_BUFFER_MS;
  let first = 0;
  while (first + 1 < next.length && next[first + 1].arrived <= cutoff) first++;
  return first === 0 ? next : next.slice(first);
}

/**
 * Whether a frame is at least `delayMs` old at device time `now`: its play
 * happened that long ago (server clock, via `offset` = device − server), or it
 * arrived that long ago (device clock).
 */
export function isOldEnough<T>(frame: Frame<T>, now: number, offset: number, delayMs: number): boolean {
  if (frame.arrived <= now - delayMs) return true;
  return frame.played !== null && frame.played <= now - offset - delayMs;
}

/** The newest frame at least `delayMs` old at device time `now`; null while nothing is that old yet. */
export function pickFrame<T>(frames: Frame<T>[], now: number, offset: number, delayMs: number): Frame<T> | null {
  for (let i = frames.length - 1; i >= 0; i--) if (isOldEnough(frames[i], now, offset, delayMs)) return frames[i];
  return null;
}

/**
 * The device-clock time a frame's play is known to have happened by: the
 * earlier of its play (shifted by `offset`) and its arrival.
 */
export function frameDeviceTime<T>(frame: Frame<T>, offset: number): number {
  return frame.played === null ? frame.arrived : Math.min(frame.played + offset, frame.arrived);
}

/**
 * "Sync to my screen": the fan tapped (device time `tapAt`) as their screen
 * showed a basket. The newest frame at or before the tap whose total score
 * went up is that basket; the delay is how long ago it happened. Null when no
 * basket is buffered.
 */
export function syncDelay<T>(
  frames: Frame<T>[],
  tapAt: number,
  offset: number,
  totalScore: (v: T) => number | null,
): number | null {
  for (let i = frames.length - 1; i > 0; i--) {
    const at = frameDeviceTime(frames[i], offset);
    if (at > tapAt) continue;
    const after = totalScore(frames[i].value);
    const before = totalScore(frames[i - 1].value);
    if (after !== null && before !== null && after > before) return clampDelay(tapAt - at);
  }
  return null;
}

export function addOffsetSample(samples: number[], sample: number): number[] {
  if (!Number.isFinite(sample)) return samples;
  return [...samples, sample].slice(-OFFSET_SAMPLES);
}

/**
 * Device clock minus the server's (plus the least network delay seen); 0
 * before any sample. Every sample over-estimates the true offset (network
 * time, or a stale CDN copy's old `generated_at`), so the smallest is the best
 * estimate and still errs high. That makes it safe for converting the device's
 * "now" into server time (a play then qualifies late, never early) — and
 * unsafe for converting an arrival time, which is why frames never do.
 */
export function clockOffset(samples: number[]): number {
  return samples.length ? Math.min(...samples) : 0;
}

/**
 * An offset sample from a server timestamp: device receive time minus when
 * the server stamped it (the hub's `hub_at`, or /api/live's `meta.generated_at`).
 * NaN (which addOffsetSample ignores) when the stamp is missing or unparsable.
 */
export function offsetSample(receivedAt: number, stampedAt: number | string | null | undefined): number {
  const stamped = typeof stampedAt === 'string' ? Date.parse(stampedAt) : (stampedAt ?? Number.NaN);
  return receivedAt - stamped;
}

function parsePlay(observedAt: string | null | undefined): number | null {
  const played = observedAt ? Date.parse(observedAt) : Number.NaN;
  return Number.isFinite(played) ? played : null;
}

/**
 * A pushed state's play time (server clock). A play can't be later than the
 * hub relayed it, so `hubAt` caps it (and stands in when `observedAt` is
 * missing). The hub's replay on connect resends old messages with their
 * original `hub_at` all at once, so each keeps its own play time instead of
 * bunching at arrival. Without either stamp it's null: the frame then counts
 * only from its arrival.
 */
export function pushFramePlayed(observedAt: string | null | undefined, hubAt: number | undefined): number | null {
  const played = parsePlay(observedAt);
  const relayed = typeof hubAt === 'number' && Number.isFinite(hubAt) ? hubAt : null;
  if (played === null) return relayed;
  return relayed === null ? played : Math.min(played, relayed);
}

/**
 * An on-screen payload's play time (server clock). An ESPN backup overlay has
 * none (null): it counts only from when it arrived.
 */
export function pageFramePlayed(observedAt: string | null | undefined, fromBackup: boolean): number | null {
  return fromBackup ? null : parsePlay(observedAt);
}
