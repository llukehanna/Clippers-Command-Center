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
