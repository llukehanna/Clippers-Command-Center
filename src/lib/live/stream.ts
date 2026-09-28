// src/lib/live/stream.ts
// Pure pieces of the /live connection manager (spec §6.2): reconnect policy,
// which tier is serving the page, and when to fall back to ESPN.

import type { LivePayload } from '../ui/types';

export type FeedSource = 'push' | 'poll' | 'backup' | 'idle';

export const RECONNECT_STEPS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;
export const FLAP_WINDOW_MS = 60_000;
export const FLAP_LIMIT = 3;
export const FLAP_PAUSE_MS = 60_000;
/** The runner saves at least every 15 s, so 30 s without a message means push is stale. */
export const PUSH_FRESH_MS = 30_000;
export const HIDDEN_CLOSE_MS = 30_000;
export const PING_EVERY_MS = 25_000;
export const BACKUP_POLL_MS = 5_000;

export function reconnectDelay(attempt: number): number {
  return RECONNECT_STEPS_MS[Math.min(Math.max(attempt, 0), RECONNECT_STEPS_MS.length - 1)];
}

export function isFlapping(drops: number[], now: number): boolean {
  return drops.filter((t) => now - t < FLAP_WINDOW_MS).length >= FLAP_LIMIT;
}

export function hubSocketUrl(hub: string, nbaGameId: string): string {
  return `${hub.replace(/\/+$/, '')}/ws/${Number(nbaGameId)}`;
}

export function streamGameId(base?: LivePayload): string | null {
  return base?.game?.nba_game_id ?? base?.upcoming?.nba_game_id ?? null;
}

export function pickSource(i: { base?: LivePayload; lastPushAt: number | null; now: number; backup: boolean }): FeedSource {
  if (i.backup) return 'backup';
  if (i.lastPushAt !== null && i.now - i.lastPushAt < PUSH_FRESH_MS) return 'push';
  if (!i.base || i.base.state === 'NO_ACTIVE_GAME') return 'idle';
  return 'poll';
}

export function needsBackup(base: LivePayload | undefined, pushFresh: boolean): boolean {
  return base?.state === 'DATA_DELAYED' && !pushFresh && base.game?.status === 'in_progress';
}
