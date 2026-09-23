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
// only carry the current season. stats.nba.com blocks many cloud IPs (it
// times out from GitHub Actions), so on failure the season is rebuilt from
// cdn.nba.com box scores instead: regular-season ids are sequential
// (00 2 YY 00001..01230), play-in and playoff ids follow 00{5,4} YY 00 R S G, so
// every id is fetched and the LAC games kept (~1,350 small requests).
//
// Run via: npm run backfill-schedule-nba [-- --season=2025-26]
//
// Safe to re-run — idempotent upserts, never creates duplicate game rows.

import { sql } from './lib/db.js';
import { upsertSeasons, upsertGameRow } from './lib/upserts.js';
import {
  currentSeasonId,
  easternDateOf,
  isNbaFormatGameId,
  isPlayoffNbaGameId,
  seasonIdFromSeasonYear,
  seasonLabel,
} from './lib/schedule-utils.js';
import {
  candidateGameIds,
  fetchCdnBoxscore,
  fetchCurrentSchedule,
  mapPool,
  type NBAScheduleGame,
  type NBAScheduleResponse,
  type NBATeamSchedule,
} from './lib/nba-season.js';

const LAC_TRICODE = 'LAC';

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
  const res = await fetch(url, { headers: STATS_HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`stats.nba.com schedule ${seasonYear} → HTTP ${res.status}`);
  const data = (await res.json()) as NBAScheduleResponse;
  const got = data?.leagueSchedule?.seasonYear;
  if (seasonIdFromSeasonYear(got) !== seasonIdFromSeasonYear(seasonYear)) {
    throw new Error(`stats.nba.com returned season ${JSON.stringify(got)}, expected ${seasonYear}`);
  }
  console.log(`[backfill-schedule-nba] Source: ${url}`);
  return data;
}

const CDN_SCAN_CONCURRENCY = 8;

/** Rebuild a season's LAC schedule from cdn.nba.com box scores (see header). */
async function scanCdnSeason(seasonId: number): Promise<NBAScheduleResponse> {
  const ids = candidateGameIds(seasonId);
  const statusCounts = new Map<string, number>();
  console.log(`[backfill-schedule-nba] Scanning ${ids.length} cdn.nba.com box scores for ${seasonLabel(seasonId)}...`);

  const results = await mapPool(ids, CDN_SCAN_CONCURRENCY, fetchCdnBoxscore);
  const games: NBAScheduleGame[] = [];
  for (const r of results) {
    const key = r.status === 'ok' ? '200' : r.status === 'missing' ? String(r.http) : 'error';
    statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1);
    if (r.status !== 'ok') continue;
    const g = r.boxscore.game;
    if (g.homeTeam.teamTricode !== LAC_TRICODE && g.awayTeam.teamTricode !== LAC_TRICODE) continue;
    const toTeam = (t: typeof g.homeTeam): NBATeamSchedule => ({
      teamId: t.teamId, teamCity: t.teamCity, teamName: t.teamName,
      teamTricode: t.teamTricode, teamSlug: '', score: t.score,
    });
    games.push({
      gameId: g.gameId,
      gameCode: '',
      gameStatus: g.gameStatus,
      gameStatusText: g.gameStatusText,
      gameDateEst: easternDateOf(g.gameTimeUTC) ?? g.gameTimeUTC.slice(0, 10),
      gameDateTimeUTC: g.gameTimeUTC,
      homeTeam: toTeam(g.homeTeam),
      awayTeam: toTeam(g.awayTeam),
    });
  }

  console.log(`[backfill-schedule-nba] CDN scan HTTP statuses: ${JSON.stringify(Object.fromEntries(statusCounts))}`);
  if (!statusCounts.get('200')) throw new Error('cdn.nba.com returned no box scores — cannot rebuild the season');

  games.sort((a, b) => a.gameDateTimeUTC.localeCompare(b.gameDateTimeUTC));
  return { leagueSchedule: { seasonYear: seasonLabel(seasonId), gameDates: [{ gameDate: '', games }] } };
}

/** Past season: stats.nba.com first, CDN box-score scan as the fallback. */
async function fetchPastSeason(seasonYear: string): Promise<NBAScheduleResponse> {
  try {
    return await fetchSeasonSchedule(seasonYear);
  } catch (err) {
    console.warn(`[backfill-schedule-nba] WARN: ${(err as Error).message} — falling back to CDN box-score scan`);
    return scanCdnSeason(seasonIdFromSeasonYear(seasonYear)!);
  }
}

async function main(): Promise<void> {
  const seasonArg = process.argv.slice(2).find((a) => a.startsWith('--season='))?.split('=')[1] ?? null;
  if (seasonArg !== null && seasonIdFromSeasonYear(seasonArg) === null) {
    throw new Error(`Invalid --season value "${seasonArg}" (expected e.g. 2025-26)`);
  }

  console.log(`[backfill-schedule-nba] Fetching ${seasonArg ? `${seasonArg} schedule` : 'NBA CDN schedule'}...`);
  const data = seasonArg ? await fetchPastSeason(seasonArg) : await fetchCurrentSchedule((m) => console.log(`[backfill-schedule-nba] ${m}`));

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

    // Play-in / playoff games are rare and easy to mis-key; log what they match.
    if (!g.gameId.startsWith('002')) {
      const matches = await sql<{ game_id: string; nba_game_id: string; game_date: string; home_team_id: string; away_team_id: string }[]>`
        SELECT game_id::text, nba_game_id::text, game_date::text AS game_date,
               home_team_id::text, away_team_id::text
        FROM games
        WHERE nba_game_id = ${g.gameId}
           OR (game_date = ${g.gameDateEst.slice(0, 10)}::date
               AND home_team_id = ${homeTeamRow.team_id}::bigint
               AND away_team_id = ${awayTeamRow.team_id}::bigint)
      `;
      console.log(
        `  ${g.gameId} ${g.gameDateEst.slice(0, 10)} ${g.awayTeam.teamTricode} @ ${g.homeTeam.teamTricode} ` +
          `(team_ids ${awayTeamRow.team_id} @ ${homeTeamRow.team_id}) → existing rows: ${JSON.stringify(matches)}`
      );
    }

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
