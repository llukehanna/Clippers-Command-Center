// scripts/lib/live-cadence.ts
// How often the live runner polls the NBA CDN (Live v2 spec §3). Pure: the
// poller feeds in what it last saw, this decides the game phase and the delay
// until the next play-by-play request.

import type { LivePhase } from '../../src/lib/types/live-state';

export const PHASE_DELAY_MS: Record<LivePhase, number> = {
  PREGAME: 30_000,
  TIP_WATCH: 10_000,
  LIVE: 3_000,
  CLUTCH: 2_000,
  STOPPAGE: 8_000,
  HALFTIME: 8_000,
  FINAL: 0,
};
/** Halftime is 15 minutes; nothing happens for the first 10. */
export const HALFTIME_QUIET_MS = 10 * 60_000;
export const HALFTIME_QUIET_DELAY_MS = 30_000;
/** Once the game is live, the scoreboard only feeds other games and cross-checks status. */
export const SCOREBOARD_EVERY_MS = 60_000;
/** The CDN scoreboard rolls over mid-morning ET; before tip a game can be missing. */
export const NOT_LISTED_DELAY_MS = 60_000;
/** The runner rewrites live_state at least this often so /api/live can tell quiet from dead. */
export const HEARTBEAT_MS = 15_000;
/** A misconfigured max-age must not stall live polling. */
export const FRESHNESS_FLOOR_CAP_MS = 15_000;

const CLUTCH_CLOCK_SEC = 300;
const CLUTCH_MARGIN = 10;
const BACKOFF_BASE_MS = 3_000;
const BACKOFF_MAX_MS = 60_000;
const STOPPAGE_TYPES = new Set(['timeout', 'instantreplay', 'stoppage']);

export interface LastAction {
  actionType: string;
  subType: string;
  period: number;
}

export function isPeriodEnd(a: LastAction | null): boolean {
  return a !== null && a.actionType.toLowerCase() === 'period' && a.subType.toLowerCase() === 'end';
}

export interface PhaseInput {
  gameStatus: number;        // 1 scheduled, 2 live, 3 final
  now: number;               // ms epoch
  tipAt: number | null;      // scheduled tip, ms epoch
  period: number;
  clockSec: number;          // seconds left in the period
  margin: number;            // home − away
  lastAction: LastAction | null;
}

export function classifyPhase(i: PhaseInput): LivePhase {
  if (i.gameStatus >= 3) return 'FINAL';
  if (i.gameStatus <= 1) return i.tipAt !== null && i.now >= i.tipAt ? 'TIP_WATCH' : 'PREGAME';
  if (isPeriodEnd(i.lastAction)) return i.lastAction!.period === 2 ? 'HALFTIME' : 'STOPPAGE';
  if (i.period >= 4 && i.clockSec <= CLUTCH_CLOCK_SEC && Math.abs(i.margin) <= CLUTCH_MARGIN) return 'CLUTCH';
  if (i.lastAction && STOPPAGE_TYPES.has(i.lastAction.actionType.toLowerCase())) return 'STOPPAGE';
  return 'LIVE';
}

export interface DelayInput {
  phase: LivePhase;
  phaseSince: number;        // when the current phase began, ms epoch
  now: number;
  failures: number;          // consecutive failed ticks
  notBeforeMs: number;       // the heartbeat URL's cached copy expires at this ms epoch (0 = unknown)
  random?: () => number;     // jitter source, 0..1
}

export function nextDelayMs(i: DelayInput): number {
  if (i.failures > 0) {
    const base = Math.min(BACKOFF_BASE_MS * 2 ** (i.failures - 1), BACKOFF_MAX_MS);
    const jitter = 0.8 + 0.4 * (i.random ?? Math.random)();
    return Math.min(Math.round(base * jitter), BACKOFF_MAX_MS);
  }
  let delay = PHASE_DELAY_MS[i.phase];
  if (i.phase === 'HALFTIME' && i.now - i.phaseSince < HALFTIME_QUIET_MS) delay = HALFTIME_QUIET_DELAY_MS;
  const floor = Math.min(Math.max(0, i.notBeforeMs - i.now), FRESHNESS_FLOOR_CAP_MS);
  return Math.max(delay, floor);
}
