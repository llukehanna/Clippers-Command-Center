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

/** Headers required to avoid 403 from NBA CDN (expects browser-like requests). */
const NBA_CDN_HEADERS: HeadersInit = {
  Accept: 'application/json',
  Referer: 'https://www.nba.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

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

/** Fetches full live boxscore for a specific game. Used by poll-live and finalize-games. */
export async function fetchBoxscore(gameId: string): Promise<NBABoxscoreResponse> {
  const path = `/boxscore/boxscore_${gameId}.json`;
  const url = `${NBA_CDN}${path}`;
  console.log(`[nba-live] Box score URL: ${url}`);
  return nbaGet(path);
}

/** Fetches play-by-play actions for a specific game. Used by poll-live for recent_scoring. */
export async function fetchPlayByPlay(gameId: string): Promise<NBAPlayByPlayResponse> {
  return nbaGet(`/playbyplay/playbyplay_${gameId}.json`);
}

async function nbaGet<T>(path: string): Promise<T> {
  const url = `${NBA_CDN}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: NBA_CDN_HEADERS,
    });
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
