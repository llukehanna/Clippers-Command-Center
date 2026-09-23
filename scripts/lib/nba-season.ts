// scripts/lib/nba-season.ts
// League-wide NBA data access shared by the schedule and league-ingest scripts:
//   - the current season's league schedule (cdn.nba.com static schedule files)
//   - every possible game id of a season (for past seasons, whose schedule is
//     only on stats.nba.com — which blocks cloud IPs)
//   - raw cdn.nba.com box score fetches that return null for missing games
//     instead of falling back to stats.nba.com like nba-live-client does.

import type { NBABoxscoreResponse } from '../../src/lib/types/live.js';
import { seasonIdFromSeasonYear } from './schedule-utils.js';

// ── Schedule (current season) ────────────────────────────────────────────────

export interface NBATeamSchedule {
  teamId: number;
  teamCity: string;
  teamName: string;
  teamTricode: string;
  teamSlug: string;
  wins?: number;
  losses?: number;
  score?: number;
}

export interface NBAScheduleGame {
  gameId: string;
  gameCode: string;
  gameStatus: number; // 1=scheduled, 2=in_progress, 3=final
  gameStatusText: string;
  gameLabel?: string;
  gameDateEst: string;
  gameDateTimeUTC: string;
  homeTeam: NBATeamSchedule;
  awayTeam: NBATeamSchedule;
}

export interface NBAScheduleResponse {
  leagueSchedule: {
    seasonYear: string;
    gameDates: { gameDate: string; games: NBAScheduleGame[] }[];
  };
}

// Both CDN files hold the current season's full league schedule. _1 is tried
// first; _2 is kept as a fallback. Override with NBA_SCHEDULE_URL if the CDN moves.
const SCHEDULE_URLS = process.env.NBA_SCHEDULE_URL
  ? [process.env.NBA_SCHEDULE_URL]
  : [
      'https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json',
      'https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_2.json',
    ];

const CDN_HEADERS = {
  Accept: 'application/json',
  Referer: 'https://www.nba.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

/**
 * The current season's league schedule. Fetches every candidate file and keeps
 * the one for the latest season (around the October rollover the files may
 * not flip on the same day).
 */
export async function fetchCurrentSchedule(
  log: (msg: string) => void = console.log
): Promise<NBAScheduleResponse> {
  const errors: string[] = [];
  let best: { data: NBAScheduleResponse; seasonId: number; url: string } | null = null;
  for (const url of SCHEDULE_URLS) {
    try {
      const res = await fetch(url, { headers: CDN_HEADERS, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) {
        errors.push(`${url} → HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as NBAScheduleResponse;
      const seasonId = seasonIdFromSeasonYear(data?.leagueSchedule?.seasonYear);
      if (seasonId === null) {
        errors.push(`${url} → unrecognized seasonYear ${JSON.stringify(data?.leagueSchedule?.seasonYear)}`);
        continue;
      }
      if (!best || seasonId > best.seasonId) best = { data, seasonId, url };
    } catch (err) {
      errors.push(`${url} → ${(err as Error).message}`);
    }
  }
  if (!best) throw new Error(`NBA CDN schedule unavailable: ${errors.join('; ')}`);
  if (errors.length > 0) log(`WARN: ${errors.join('; ')}`);
  log(`Schedule source: ${best.url}`);
  return best.data;
}

/** Flatten a schedule to its games. */
export function scheduleGames(schedule: NBAScheduleResponse): NBAScheduleGame[] {
  return schedule.leagueSchedule.gameDates.flatMap((d) => d.games);
}

// ── Game ids ──────────────────────────────────────────────────────────────────

export const REGULAR_SEASON_GAMES = 1230;

/**
 * Every game id that can exist in a season: regular season (00 2 YY 00001..01230),
 * play-in (00 5 YY 00 R S 1 — round 1 series 0..3, round 2 series 0..1) and
 * playoffs (00 4 YY 00 R S G — rounds 1..4 with 8/4/2/1 series, games 1..7).
 * Ids that don't exist (unplayed playoff games) simply 403/404 on the CDN.
 */
export function candidateGameIds(seasonId: number): string[] {
  const yy = String(seasonId % 100).padStart(2, '0');
  const ids: string[] = [];
  for (let n = 1; n <= REGULAR_SEASON_GAMES; n++) ids.push(`002${yy}${String(n).padStart(5, '0')}`);
  for (const [round, count] of [[1, 4], [2, 2]] as const) {
    for (let series = 0; series < count; series++) ids.push(`005${yy}00${round}${series}1`);
  }
  [8, 4, 2, 1].forEach((count, i) => {
    for (let series = 0; series < count; series++) {
      for (let game = 1; game <= 7; game++) ids.push(`004${yy}00${i + 1}${series}${game}`);
    }
  });
  return ids;
}

// ── Box scores ───────────────────────────────────────────────────────────────

export type CdnBoxscoreResult =
  | { status: 'ok'; boxscore: NBABoxscoreResponse }
  | { status: 'missing'; http: number }      // 403/404: game doesn't exist (yet)
  | { status: 'error'; message: string };     // network / 5xx / bad JSON

/** One cdn.nba.com box score. Never throws. */
export async function fetchCdnBoxscore(gameId10: string): Promise<CdnBoxscoreResult> {
  try {
    const res = await fetch(`https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${gameId10}.json`, {
      headers: CDN_HEADERS,
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 403 || res.status === 404) return { status: 'missing', http: res.status };
    if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` };
    return { status: 'ok', boxscore: (await res.json()) as NBABoxscoreResponse };
  } catch (err) {
    return { status: 'error', message: (err as Error).message };
  }
}

/**
 * Map `items` through `fn` with at most `concurrency` calls in flight,
 * preserving input order in the result.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}
