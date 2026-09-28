// src/lib/live/spoiler.ts
// Spoiler sync (Live v2 spec §7.3). The page keeps what it showed over the
// last 150 s as frames keyed by when the real play happened, in the server's
// clock (the hub's, which /api/live and the NBA's play times share closely
// enough), and renders the newest frame at least `delay` old — so nothing
// shows before the fan's own TV or stream does. "Now" is converted into that
// clock with the measured offset at render time (device time − offset), so
// every frame benefits as the estimate improves and none needs re-stamping.
// Pure.

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
  at: number;                  // server-clock ms when the newest play in `value` happened
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

/** Inserts in `at` order and drops frames older than the buffer, keeping the newest of those as a floor. */
export function addFrame<T>(frames: Frame<T>[], frame: Frame<T>, now: number): Frame<T>[] {
  const next = [...frames];
  let i = next.length;
  while (i > 0 && next[i - 1].at > frame.at) i--;
  next.splice(i, 0, frame);
  const cutoff = now - SPOILER_BUFFER_MS;
  let first = 0;
  while (first + 1 < next.length && next[first + 1].at <= cutoff) first++;
  return first === 0 ? next : next.slice(first);
}

/** The newest frame at least `delayMs` old; null while nothing is that old yet. */
export function pickFrame<T>(frames: Frame<T>[], now: number, delayMs: number): Frame<T> | null {
  const limit = now - delayMs;
  for (let i = frames.length - 1; i >= 0; i--) if (frames[i].at <= limit) return frames[i];
  return null;
}

/**
 * "Sync to my screen": the fan tapped as their screen showed a basket. The
 * newest frame at or before the tap whose total score went up is that basket;
 * the delay is how long ago it happened. Null when no basket is buffered.
 */
export function syncDelay<T>(frames: Frame<T>[], tapAt: number, totalScore: (v: T) => number | null): number | null {
  for (let i = frames.length - 1; i > 0; i--) {
    if (frames[i].at > tapAt) continue;
    const after = totalScore(frames[i].value);
    const before = totalScore(frames[i - 1].value);
    if (after !== null && before !== null && after > before) return clampDelay(tapAt - frames[i].at);
  }
  return null;
}

export function addOffsetSample(samples: number[], sample: number): number[] {
  if (!Number.isFinite(sample)) return samples;
  return [...samples, sample].slice(-OFFSET_SAMPLES);
}

/**
 * Device clock minus the server's (plus the least network delay seen); 0
 * before any sample. Every sample is an upper bound of the true offset, so the
 * estimate only ever errs toward showing plays later.
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

/**
 * When the newest play in a state happened: `observedAt` shifted by `offset`
 * into the clock `receivedAt` is in, and never later than it arrived.
 */
export function frameTime(observedAt: string | null | undefined, offset: number, receivedAt: number): number {
  const played = observedAt ? Date.parse(observedAt) : Number.NaN;
  return Number.isFinite(played) ? Math.min(receivedAt, played + offset) : receivedAt;
}

/**
 * A pushed state's frame time (server clock). A play can't be later than the
 * hub relayed it, so `hubAt` caps it. That holds for the hub's replay on
 * connect too, which resends old messages with their original `hub_at` all at
 * once: each keeps its own play time instead of bunching at arrival. `hubNow`
 * (device receive time − offset) stands in when a message has no `hub_at`.
 */
export function pushFrameTime(observedAt: string | null | undefined, hubAt: number | undefined, hubNow: number): number {
  return frameTime(observedAt, 0, typeof hubAt === 'number' && Number.isFinite(hubAt) ? hubAt : hubNow);
}

/**
 * An on-screen payload's frame time (server clock). `arrivedAt` is when it
 * reached this device, in the server clock (receive time − offset). An ESPN
 * backup overlay has no play time: it counts from when it arrived.
 */
export function pageFrameTime(observedAt: string | null | undefined, arrivedAt: number, fromBackup: boolean): number {
  return fromBackup ? arrivedAt : frameTime(observedAt, 0, arrivedAt);
}
