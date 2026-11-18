// scripts/lib/game-night-logic.ts
// Pure decision logic for scripts/game-night.ts's poll loop, extracted so it's
// unit-testable without pulling in the DB (game-night.ts itself imports ./db.js
// and can't be unit-tested directly).
//
// The bug this guards against: the FINAL tick's phase delay is 0
// (scripts/lib/live-cadence.ts's PHASE_DELAY_MS.FINAL), and a save can fail
// (transient DB error) on the very tick that reaches FINAL. Finalizing and
// exiting on that tick anyway would leave live_state on the pre-buzzer doc —
// so a failed-save FINAL tick keeps polling instead, with a floored delay
// (never 0), until either a later tick's save succeeds or a bounded number of
// attempts is reached, at which point it finalizes anyway so the game still
// gets its box scores.

import type { LivePhase } from '../../src/lib/types/live-state';

export const FINAL_SAVE_MAX_ATTEMPTS = 10;
const FINAL_RETRY_DELAY_MS = 3_000;

export interface GameNightTick {
  final: boolean;
  saved: boolean;
  hasDoc: boolean; // r.doc !== null
  delayMs: number;
}

export type GameNightAction =
  | { type: 'continue'; sleepMs: number }
  | { type: 'finalize'; forced: boolean };

export interface GameNightDecision {
  action: GameNightAction;
  /** Carry this into the next call's `finalAttempts` argument. */
  finalAttempts: number;
}

/**
 * Decides what the poll loop should do after a tick, given how many
 * consecutive final-but-unsaved ticks have happened so far.
 *
 * - Not a final tick (or a final tick with no doc yet): keep polling at the
 *   tick's own delay; reset the attempt counter.
 * - Final and saved: finalize now.
 * - Final but not saved, under the attempt bound: keep polling at
 *   max(delayMs, FINAL_RETRY_DELAY_MS) so a 0 ms FINAL delay never spins hot.
 * - Final but not saved, attempt bound reached: finalize anyway (forced) so
 *   the game still gets its box scores even if live_state never catches up.
 */
export function decideGameNightAction(r: GameNightTick, finalAttempts: number): GameNightDecision {
  if (!r.final || !r.hasDoc) {
    return { action: { type: 'continue', sleepMs: r.delayMs }, finalAttempts: 0 };
  }
  if (r.saved) {
    return { action: { type: 'finalize', forced: false }, finalAttempts };
  }
  const attempts = finalAttempts + 1;
  if (attempts >= FINAL_SAVE_MAX_ATTEMPTS) {
    return { action: { type: 'finalize', forced: true }, finalAttempts: attempts };
  }
  return {
    action: { type: 'continue', sleepMs: Math.max(r.delayMs, FINAL_RETRY_DELAY_MS) },
    finalAttempts: attempts,
  };
}

// ── Picking up fixes mid-run ─────────────────────────────────────────────────
// A run checks out main at launch and can then sleep for hours before tip, so
// a fix merged after launch would never reach it (on Nov 4 one landed 28
// minutes after tip and the game stayed dark). The runner polls origin/main
// and, when runner code changed, hands the game to a successor run on the new
// code (it resumes from live_state).

/** Paths whose change means a running runner is on stale code. */
export const RUNNER_CODE_PATHS = ['scripts', 'src/lib', 'package.json', 'package-lock.json'];
export const CODE_CHECK_MS = 2 * 60_000;

/** Runs git with these args and resolves to its exit code. */
export type Git = (args: string[]) => Promise<number>;

/** True when origin/main has runner code this checkout doesn't. A failed fetch is "no". */
export async function mainHasNewRunnerCode(git: Git): Promise<boolean> {
  if ((await git(['fetch', '--quiet', '--depth=1', 'origin', 'main'])) !== 0) return false;
  return (await git(['diff', '--quiet', 'HEAD', 'FETCH_HEAD', '--', ...RUNNER_CODE_PATHS])) === 1;
}

/**
 * When a run that has seen new runner code may hand the game off. The
 * successor waits in the workflow's concurrency group until this run exits,
 * then needs ~45 s to boot (checkout, npm ci) — a gap fans see as "data
 * delayed". So mid-game the hand-off waits for a break in play (halftime, a
 * period end, a timeout or review), where nothing is missed. A run that keeps
 * failing hands off right away: it may be the bug the new code fixes (one
 * failed tick is just a feed blip). TIP_WATCH waits: the tip is the moment
 * fans are watching for.
 */
export const HAND_OFF_FAILURES = 3;

export function handOffMomentOk(phase: LivePhase | null, consecutiveFailures: number): boolean {
  if (consecutiveFailures >= HAND_OFF_FAILURES) return true;
  return phase === null || phase === 'PREGAME' || phase === 'HALFTIME' || phase === 'STOPPAGE';
}

// ── Finalizing when the NBA refuses box scores ───────────────────────────────
// Right after some games cdn.nba.com answers the box score with a 403 and the
// stats.nba.com fallback times out from cloud IPs (Nov 13 and Nov 15); hours
// later the nightly post-game pipeline gets it. So the runner keeps retrying
// while it has time left, and gives up quietly when it doesn't.

export const FINALIZE_RETRY_MS = 15 * 60_000;
/** Time kept back after the last retry for the job to finish cleanly. */
const FINALIZE_MARGIN_MS = 5 * 60_000;

/** Delay before the next finalize attempt, or null when the run is out of time. */
export function finalizeRetryDelay(elapsedMs: number, maxRuntimeMs: number): number | null {
  return maxRuntimeMs - elapsedMs >= FINALIZE_RETRY_MS + FINALIZE_MARGIN_MS ? FINALIZE_RETRY_MS : null;
}
