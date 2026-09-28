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

// ── Game matching, clock math, snapshot extras ──────────────────────────────

/**
 * The scoreboard game for a specific games row, matched on the official NBA
 * game id (games.nba_game_id is stored without leading zeros). Never falls
 * back to "any Clippers game": on back-to-back nights that would write
 * tonight's score onto yesterday's row.
 */
export function matchScoreboardGame(
  games: ScoreboardGame[],
  nbaGameId: string | number | bigint
): ScoreboardGame | null {
  const target = Number(nbaGameId);
  if (!Number.isFinite(target)) return null;
  return games.find((g) => Number(g.gameId) === target) ?? null;
}

const REGULATION_PERIOD_SECONDS = 12 * 60;
const OVERTIME_PERIOD_SECONDS = 5 * 60;

/** "PT04M32.00S" → 272 (seconds remaining in the period); '' → 0. */
export function clockSecondsRemaining(isoClock: string | null | undefined): number {
  const m = /PT(?:(\d+)M)?(?:([\d.]+)S)?/.exec(isoClock ?? '');
  if (!m || (!m[1] && !m[2])) return 0;
  return Number(m[1] ?? 0) * 60 + Math.floor(Number(m[2] ?? 0));
}

/** Seconds of game time elapsed at (period, clock). Overtime periods are 5 minutes. */
export function gameElapsedSeconds(period: number, isoClock: string | null | undefined): number {
  if (period <= 0) return 0;
  const length = period <= 4 ? REGULATION_PERIOD_SECONDS : OVERTIME_PERIOD_SECONDS;
  const before =
    Math.min(period - 1, 4) * REGULATION_PERIOD_SECONDS +
    Math.max(0, period - 5) * OVERTIME_PERIOD_SECONDS;
  return before + (length - Math.min(length, clockSecondsRemaining(isoClock)));
}

export interface PlayByPlayActionLike {
  actionNumber: number;
  period: number;
  clock: string;
  teamId: number;
  teamTricode?: string;
  scoreHome: string;
  scoreAway: string;
}

export interface RecentScoringEvent {
  team_id: string;
  team_tricode?: string;
  points: number;
  event_time_seconds: number;
}

/**
 * Scoring plays in the last `lookbackSeconds` of game time. Points come from
 * the change in the running score (scoreHome/scoreAway) between actions — the
 * CDN's pointsTotal is a player's running total, not points on the play — and
 * each action's time uses its OWN period.
 */
export function extractRecentScoring(
  actions: PlayByPlayActionLike[],
  current: { period: number; clock: string },
  teams: { homeTeamId: number; awayTeamId: number; homeTricode?: string; awayTricode?: string },
  lookbackSeconds = 120
): RecentScoringEvent[] {
  const cutoff = gameElapsedSeconds(current.period, current.clock) - lookbackSeconds;
  const events: RecentScoringEvent[] = [];
  let home = 0;
  let away = 0;
  for (const a of [...actions].sort((x, y) => x.actionNumber - y.actionNumber)) {
    const h = Number.parseInt(a.scoreHome, 10);
    const w = Number.parseInt(a.scoreAway, 10);
    if (!Number.isFinite(h) || !Number.isFinite(w)) continue;
    const t = gameElapsedSeconds(a.period, a.clock);
    if (h > home && t >= cutoff) {
      events.push({ team_id: String(teams.homeTeamId), team_tricode: teams.homeTricode, points: h - home, event_time_seconds: t });
    }
    if (w > away && t >= cutoff) {
      events.push({ team_id: String(teams.awayTeamId), team_tricode: teams.awayTricode, points: w - away, event_time_seconds: t });
    }
    home = Math.max(home, h);
    away = Math.max(away, w);
  }
  return events;
}

export interface OtherGame {
  game_id: string;
  status: 'scheduled' | 'in_progress' | 'final';
  status_text: string;
  period: number;
  clock: string;
  start_time_utc: string | null;
  home: { abbreviation: string; score: number };
  away: { abbreviation: string; score: number };
}

/** Tonight's other NBA games from the scoreboard, for the live page's ticker. */
export function summarizeOtherGames(games: ScoreboardGame[], excludeGameId: string): OtherGame[] {
  return games
    .filter((g) => g.gameId !== excludeGameId)
    .map((g) => ({
      game_id: g.gameId,
      status: g.gameStatus === 3 ? 'final' : g.gameStatus === 2 ? 'in_progress' : 'scheduled',
      status_text: g.gameStatusText,
      period: g.period,
      clock: g.gameClock,
      start_time_utc: g.gameTimeUTC || null,
      home: { abbreviation: g.homeTeam.teamTricode, score: g.homeTeam.score },
      away: { abbreviation: g.awayTeam.teamTricode, score: g.awayTeam.score },
    }));
}

/** Per-period line score from the scoreboard teams: [{ period, home, away }]. */
export function lineScore(game: ScoreboardGame): { period: number; home: number; away: number }[] {
  const away = new Map((game.awayTeam.periods ?? []).map((p) => [p.period, p.score]));
  return (game.homeTeam.periods ?? []).map((p) => ({ period: p.period, home: p.score, away: away.get(p.period) ?? 0 }));
}
