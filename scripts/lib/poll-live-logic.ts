// scripts/lib/poll-live-logic.ts
// Pure helper functions and testable cycle unit for the live polling loop.
// Zero DB imports — helpers are pure; runPollCycle only calls fetchScoreboard.
// Imported by scripts/poll-live.ts (Plan 04).

import type { ScoreboardGame } from '../../src/lib/types/live.js';
import { fetchScoreboard } from './nba-live-client';

export const LAC_TEAM_ID = 1610612746;
const BACKOFF_CEILING_MS = 60_000;

/**
 * Exponential backoff calculation.
 * failureCount=0 returns baseMs unchanged (Math.pow(2, 0) === 1).
 * Caps at BACKOFF_CEILING_MS (60 seconds).
 */
export function calculateBackoff(failureCount: number, baseMs: number): number {
  return Math.min(baseMs * Math.pow(2, failureCount), BACKOFF_CEILING_MS);
}

/**
 * Returns true if the given game involves the Clippers (LAC).
 */
export function isClippersGame(game: ScoreboardGame): boolean {
  return (
    game.homeTeam.teamId === LAC_TEAM_ID ||
    game.awayTeam.teamId === LAC_TEAM_ID
  );
}

/**
 * Finds the Clippers game in today's scoreboard games array.
 * Returns null if no Clippers game is present.
 */
export function findClippersGame(games: ScoreboardGame[]): ScoreboardGame | null {
  return games.find(isClippersGame) ?? null;
}

/**
 * Maps NBA gameStatus number to a human-readable label for console logging.
 * 1=PRE (scheduled), 2=LIVE (in progress), 3=FINAL
 */
export function gameStatusLabel(status: number): string {
  if (status === 1) return 'PRE';
  if (status === 2) return 'LIVE';
  if (status === 3) return 'FINAL';
  return 'UNKNOWN';
}

/**
 * Run a single poll cycle against the NBA CDN scoreboard.
 * Manages the failure counter: increments on error, resets to 0 on success.
 *
 * Returns the updated failureCount after this cycle.
 * On success: 0 (reset).
 * On failure: previousFailureCount + 1.
 *
 * Exported for unit-testing the backoff/reset behavior without running the
 * full pollLoop (which has DB side-effects and a while(true) loop).
 */
export async function runPollCycle(
  previousFailureCount: number,
  deps: { fetchScoreboard: () => ReturnType<typeof fetchScoreboard> } = { fetchScoreboard }
): Promise<number> {
  try {
    await deps.fetchScoreboard();
    return 0; // success → reset counter
  } catch {
    return previousFailureCount + 1; // failure → increment counter
  }
}
