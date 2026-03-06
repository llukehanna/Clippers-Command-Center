// scripts/lib/nba-live-client.ts
// NBA CDN live data HTTP client + clock parsing utilities.
// Mirrors bdl-client.ts pattern: timeout, AbortController, typed generics.

import type {
  NBAScoreboardResponse,
  NBABoxscoreResponse,
  NBAPlayByPlayResponse,
} from '../../src/lib/types/live.js';

const NBA_CDN = 'https://cdn.nba.com/static/json/liveData';
const REQUEST_TIMEOUT_MS = 15_000;

// ── Clock parsing utilities ───────────────────────────────────────────────────

/**
 * Converts NBA ISO 8601 gameClock ("PT04M32.00S") to display format "4:32".
 * Returns "0:00" for empty string (game not in progress) or invalid input.
 */
export function parseNBAClock(isoClock: string): string {
  const match = isoClock.match(/PT(\d+)M([\d.]+)S/);
  if (!match) return '0:00';
  const min = parseInt(match[1], 10);
  const sec = Math.floor(parseFloat(match[2]));
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

/**
 * Converts NBA ISO 8601 gameClock to seconds remaining in the period.
 * Used to build ScoringEvent.event_time_seconds from play-by-play actions.
 * Returns 0 for empty string or invalid input.
 */
export function clockToSecondsRemaining(isoClock: string): number {
  const match = isoClock.match(/PT(\d+)M([\d.]+)S/);
  if (!match) return 0;
  return parseInt(match[1], 10) * 60 + Math.floor(parseFloat(match[2]));
}

// ── NBA CDN fetch ─────────────────────────────────────────────────────────────

/** Fetches today's scoreboard from NBA CDN. */
export async function fetchScoreboard(): Promise<NBAScoreboardResponse> {
  return nbaGet('/scoreboard/todaysScoreboard_00.json');
}

/** Fetches full live boxscore for a specific game. Used by finalize-games. */
export async function fetchBoxscore(gameId: string): Promise<NBABoxscoreResponse> {
  return nbaGet(`/boxscore/boxscore_${gameId}.json`);
}

/** Fetches play-by-play actions for a specific game. Used by poll-live for recent_scoring. */
export async function fetchPlayByPlay(gameId: string): Promise<NBAPlayByPlayResponse> {
  return nbaGet(`/playbyplay/playbyplay_${gameId}.json`);
}

async function nbaGet<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${NBA_CDN}${path}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`NBA CDN ${res.status}: ${path}`);
    return res.json() as Promise<T>;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`TIMEOUT after ${REQUEST_TIMEOUT_MS}ms: ${path}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
