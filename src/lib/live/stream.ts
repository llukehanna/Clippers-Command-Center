// src/lib/live/stream.ts
// Pure pieces of the /live connection manager (spec §6.2): reconnect policy,
// which tier is serving the page, and when to fall back to ESPN.

import type { LivePayload } from '../ui/types';

export type FeedSource = 'push' | 'poll' | 'backup' | 'idle';

export const RECONNECT_STEPS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;
export const FLAP_WINDOW_MS = 60_000;
export const FLAP_LIMIT = 3;
export const FLAP_PAUSE_MS = 60_000;
/** The runner saves at least every 15 s, so a doc built 30 s ago means push is stale. */
export const PUSH_FRESH_MS = 30_000;
/** Freshness compares the runner's clock with this device's; allow this much skew. */
export const CLOCK_SKEW_TOLERANCE_MS = 15_000;
export const HIDDEN_CLOSE_MS = 30_000;
export const PING_EVERY_MS = 25_000;
/** No message and no 'pong' for two ping intervals: the socket is dead even if it looks open. */
export const SOCKET_SILENT_MS = 2 * PING_EVERY_MS;
export const BACKUP_POLL_MS = 5_000;
/** Pre-tip → tip: how often /live refetches /api/live until it has the game. */
export const TIP_REFETCH_MS = 5_000;

export function reconnectDelay(attempt: number): number {
  return RECONNECT_STEPS_MS[Math.min(Math.max(attempt, 0), RECONNECT_STEPS_MS.length - 1)];
}

export function isFlapping(drops: number[], now: number): boolean {
  return drops.filter((t) => now - t < FLAP_WINDOW_MS).length >= FLAP_LIMIT;
}

export function socketIsSilent(lastHeardAt: number, now: number): boolean {
  return now - lastHeardAt >= SOCKET_SILENT_MS;
}

export function hubSocketUrl(hub: string, nbaGameId: string): string {
  return `${hub.replace(/\/+$/, '')}/ws/${Number(nbaGameId)}`;
}

/**
 * The game to stream, in the hub's canonical numeric form (`0022600093` →
 * `22600093`) so the id — and the socket — doesn't change at tip, when the
 * payload switches from `upcoming` to `game`.
 */
export function streamGameId(base?: LivePayload): string | null {
  const raw = base?.game?.nba_game_id ?? base?.upcoming?.nba_game_id ?? null;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? String(n) : null;
}

/**
 * Push is fresh while the runner built its doc recently. Judged by the doc's
 * own `fetched_at`, not arrival time: the hub replays up to ~150 s of history
 * on connect, and a replayed doc mustn't pass for live.
 */
export function isPushFresh(doc: { fetched_at: string } | null | undefined, now: number): boolean {
  if (!doc) return false;
  const built = Date.parse(doc.fetched_at);
  return Number.isFinite(built) && now - built < PUSH_FRESH_MS + CLOCK_SKEW_TOLERANCE_MS;
}

/**
 * Overlay push only when it's at least as new as the polled snapshot (both
 * server clocks). While the server reports DATA_DELAYED, the pushed doc must
 * be strictly newer: a doc no newer than the snapshot the server already calls
 * stale (a hub replay, or a device clock that runs slow) isn't live.
 */
export function pushIsCurrent(doc: { fetched_at: string }, base: LivePayload): boolean {
  const pushed = Date.parse(doc.fetched_at);
  if (!Number.isFinite(pushed)) return false;
  const polled = base.snapshot_captured_at ? Date.parse(base.snapshot_captured_at) : NaN;
  if (!Number.isFinite(polled)) return true;
  return base.state === 'DATA_DELAYED' ? pushed > polled : pushed >= polled;
}

/**
 * Which tier is feeding the page. `shown` is the payload on screen;
 * `pushFetchedAt` is the pushed doc's `fetched_at` when push is overlaid, else null.
 */
export function pickSource(i: { shown?: LivePayload; pushFetchedAt: string | null; now: number; backup: boolean }): FeedSource {
  if (!i.shown || i.shown.state === 'NO_ACTIVE_GAME' || !i.shown.game || i.shown.game.status === 'final') return 'idle';
  if (i.backup) return 'backup';
  if (i.pushFetchedAt !== null && isPushFresh({ fetched_at: i.pushFetchedAt }, i.now)) return 'push';
  return 'poll';
}

export function needsBackup(base: LivePayload | undefined, pushFresh: boolean): boolean {
  return base?.state === 'DATA_DELAYED' && !pushFresh && base.game?.status === 'in_progress';
}
