// scripts/backfill-schedule-nba.ts
// Seeds / refreshes the games table from the NBA CDN league schedule (no BDL
// required). Upserts all LAC non-preseason games of the CURRENT season as
// published by the CDN; the season is derived from the response's
// leagueSchedule.seasonYear (e.g. "2026-27" → 2026), never hardcoded.
//
// Why this matters: finalization calls cdn.nba.com with the official NBA game
// id, so every LAC game needs an NBA-format nba_game_id. Rows first inserted
// by sync-schedule (balldontlie ids) are matched on (game_date, home, away)
// and adopt the NBA id — see upsertGameRow() in lib/upserts.ts.
//
// Past seasons: --season=2025-26 reads that season's schedule from
// stats.nba.com (scheduleleaguev2, same leagueSchedule shape) — the CDN files
// only carry the current season. stats.nba.com may block some cloud IPs.
//
// Run via: npm run backfill-schedule-nba [-- --season=2025-26]
//
// Safe to re-run — idempotent upserts, never creates duplicate game rows.

import { sql } from './lib/db.js';
import { upsertSeasons, upsertGameRow } from './lib/upserts.js';
import {
  currentSeasonId,
  isNbaFormatGameId,
  isPlayoffNbaGameId,
  seasonIdFromSeasonYear,
  seasonLabel,
} from './lib/schedule-utils.js';

const LAC_TRICODE = 'LAC';

// Both CDN files hold the current season's full league schedule. _1 is tried
// first; _2 is the file this script originally used (known to work) and is
// kept as a fallback. Override with NBA_SCHEDULE_URL if the CDN moves.
const SCHEDULE_URLS = process.env.NBA_SCHEDULE_URL
  ? [process.env.NBA_SCHEDULE_URL]
  : [
      'https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json',
      'https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_2.json',
    ];

interface NBATeamSchedule {
  teamId: number;
  teamCity: string;
  teamName: string;
  teamTricode: string;
  teamSlug: string;
  wins?: number;
  losses?: number;
  score?: number;
}

interface NBAScheduleGame {
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

interface NBAScheduleDay {
  gameDate: string;
  games: NBAScheduleGame[];
}

interface NBAScheduleResponse {
  leagueSchedule: {
    seasonYear: string;
    gameDates: NBAScheduleDay[];
  };
}

function gameStatusToInternal(status: number): string {
  if (status === 3) return 'final';
  if (status === 2) return 'in_progress';
  return 'scheduled';
}

const STATS_HEADERS = {
  Accept: 'application/json',
  Referer: 'https://www.nba.com/',
  Origin: 'https://www.nba.com',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
};

/** A specific (usually past) season's schedule from stats.nba.com. */
async function fetchSeasonSchedule(seasonYear: string): Promise<NBAScheduleResponse> {
  const url = `https://stats.nba.com/stats/scheduleleaguev2?Season=${encodeURIComponent(seasonYear)}&LeagueID=00`;
  const res = await fetch(url, { headers: STATS_HEADERS, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`stats.nba.com schedule ${seasonYear} → HTTP ${res.status}`);
  const data = (await res.json()) as NBAScheduleResponse;
  const got = data?.leagueSchedule?.seasonYear;
  if (seasonIdFromSeasonYear(got) !== seasonIdFromSeasonYear(seasonYear)) {
    throw new Error(`stats.nba.com returned season ${JSON.stringify(got)}, expected ${seasonYear}`);
  }
  console.log(`[backfill-schedule-nba] Source: ${url}`);
  return data;
}

/**
 * Fetch every candidate schedule file and keep the one for the latest season
 * (around the October rollover the files may not flip on the same day).
 */
async function fetchSchedule(): Promise<NBAScheduleResponse> {
  const errors: string[] = [];
  let best: { data: NBAScheduleResponse; seasonId: number; url: string } | null = null;
  for (const url of SCHEDULE_URLS) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          Referer: 'https://www.nba.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
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
  if (errors.length > 0) console.warn(`[backfill-schedule-nba] WARN: ${errors.join('; ')}`);
  console.log(`[backfill-schedule-nba] Source: ${best.url}`);
  return best.data;
}

async function main(): Promise<void> {
  const seasonArg = process.argv.slice(2).find((a) => a.startsWith('--season='))?.split('=')[1] ?? null;
  if (seasonArg !== null && seasonIdFromSeasonYear(seasonArg) === null) {
    throw new Error(`Invalid --season value "${seasonArg}" (expected e.g. 2025-26)`);
  }

  console.log(`[backfill-schedule-nba] Fetching ${seasonArg ? `${seasonArg} schedule` : 'NBA CDN schedule'}...`);
  const data = seasonArg ? await fetchSeasonSchedule(seasonArg) : await fetchSchedule();

  // Determine season_id from the schedule (e.g., "2026-27" → 2026)
  const seasonYear = data.leagueSchedule.seasonYear;
  const seasonId = seasonIdFromSeasonYear(seasonYear)!; // validated by the fetchers
  console.log(`[backfill-schedule-nba] Season: ${seasonLabel(seasonId)} (season_id ${seasonId})`);
  if (!seasonArg && seasonId < currentSeasonId()) {
    // CDN has not rolled over to the new season yet — still safe to upsert.
    console.warn(
      `[backfill-schedule-nba] WARN: CDN schedule is for ${seasonLabel(seasonId)}, ` +
        `current season by date is ${seasonLabel(currentSeasonId())}`
    );
  }

  // Collect all LAC non-preseason games
  const lacGames: NBAScheduleGame[] = [];
  for (const day of data.leagueSchedule.gameDates) {
    for (const g of day.games) {
      const isLAC =
        g.homeTeam.teamTricode === LAC_TRICODE || g.awayTeam.teamTricode === LAC_TRICODE;
      const isPreseason = g.gameLabel?.toLowerCase().includes('preseason') || g.gameId.startsWith('001');
      if (!isLAC || isPreseason) continue;
      // Only ids finalization can use (regular season / play-in / playoffs).
      // Skips e.g. the NBA Cup final ("006…"), which doesn't count in stats.
      if (!isNbaFormatGameId(g.gameId, seasonId)) {
        console.warn(`  Skipping ${g.gameId}: not a stored game type`);
        continue;
      }
      lacGames.push(g);
    }
  }

  console.log(`[backfill-schedule-nba] Found ${lacGames.length} LAC games`);

  // games.season_id REFERENCES seasons — ensure the row exists first.
  await upsertSeasons([seasonId]);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const g of lacGames) {
    // Resolve internal team IDs by tricode (teams table uses BDL IDs, not official NBA IDs)
    const [homeTeamRow] = await sql<{ team_id: string }[]>`
      SELECT team_id::text FROM teams WHERE abbreviation = ${g.homeTeam.teamTricode}
    `;
    const [awayTeamRow] = await sql<{ team_id: string }[]>`
      SELECT team_id::text FROM teams WHERE abbreviation = ${g.awayTeam.teamTricode}
    `;

    if (!homeTeamRow || !awayTeamRow) {
      console.warn(`  Skipping ${g.gameId}: team not in DB (home=${g.homeTeam.teamTricode}, away=${g.awayTeam.teamTricode})`);
      skipped++;
      continue;
    }

    const status = gameStatusToInternal(g.gameStatus);
    const isFinal = status === 'final';

    const result = await upsertGameRow({
      nbaGameId: g.gameId,                    // "0022601199" → stored as 22601199
      seasonId,
      gameDate: g.gameDateEst.slice(0, 10),   // Eastern date, e.g. "2026-10-21"
      status,
      startTimeUtc: g.gameDateTimeUTC || null,
      homeTeamId: homeTeamRow.team_id,
      awayTeamId: awayTeamRow.team_id,
      // Schedule scores are 0 until a game is played; only trust them when final.
      homeScore: isFinal ? (g.homeTeam.score ?? null) : null,
      awayScore: isFinal ? (g.awayTeam.score ?? null) : null,
      period: null,
      clock: null,
      isPlayoffs: isPlayoffNbaGameId(g.gameId),
    });

    if (result === 'inserted') inserted++;
    else updated++;
  }

  console.log(`[backfill-schedule-nba] Done: ${inserted} inserted, ${updated} updated, ${skipped} skipped`);

  await sql.end();
}

main().catch(err => {
  console.error('[backfill-schedule-nba] Failed:', err);
  sql.end();
  process.exit(1);
});
