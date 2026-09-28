// scripts/sync-league-games.ts
// League-wide ingest: games rows + team/player box scores for EVERY NBA game,
// not just the Clippers'. League rankings, opponent context and percentile
// insights all need the whole league.
//
// Modes:
//   (default)          Current season, from the cdn.nba.com league schedule:
//                      final games in the last --days (default 3) that have no
//                      player box scores yet. This is the nightly job.
//   --season=YYYY-YY   A whole past season: every possible game id is fetched
//                      from cdn.nba.com (see candidateGameIds) because the
//                      past-season schedule is only on stats.nba.com, which
//                      blocks cloud IPs. Games that already have player box
//                      scores are skipped unless --force.
//                      Seasons before 2020-21 are not (fully) in the cdn.nba.com archive
//                      and come from stats.nba.com instead (see lib/stats-nba.ts):
//                      season game logs for every game, full per-game box
//                      scores for Clippers games. stats.nba.com blocks most
//                      cloud IPs — run those seasons from a home network.
//   --force            Re-write box scores even when present.
//   --repair-duplicates  Delete stale duplicate rows the guard finds, when safe
//                      (see removeStaleDuplicate); otherwise they fail the run.
//
// Box scores are fetched in parallel and written one game per transaction,
// sequentially (finalizeGame). Idempotent — safe to re-run; an interrupted
// backfill resumes where it left off. Exits 1 if any game fails.
//
// Run via: npm run sync-league-games [-- --season=2025-26] [-- --days=7]

import { sql } from './lib/db.js';
import { upsertSeasons } from './lib/upserts.js';
import { findLikelyDuplicates, ingestBoxscore, removeStaleDuplicate } from './lib/league-ingest.js';
import {
  currentSeasonId,
  easternDateOf,
  isNbaFormatGameId,
  seasonIdFromSeasonYear,
  seasonLabel,
} from './lib/schedule-utils.js';
import {
  candidateGameIds,
  fetchCdnBoxscore,
  fetchCurrentSchedule,
  mapPool,
  scheduleGames,
} from './lib/nba-season.js';
import { boxscoresFromSeasonLogs, fetchSeasonLogs, fetchStatsBoxscore } from './lib/stats-nba.js';

const FETCH_CONCURRENCY = 8;
const CHUNK_SIZE = 64; // fetch a chunk in parallel, then write it sequentially
/**
 * First season cdn.nba.com serves completely. Its 2019-20 archive is partial:
 * many games 403, and Feb–Mar 2020 files use an old status format ("finalbox").
 */
const CDN_FIRST_SEASON = 2020;
const LAC_TRICODE = 'LAC';
/** Concurrent game writes (one transaction each) for stats.nba.com seasons; needs DB_POOL_MAX above it. */
const WRITE_CONCURRENCY = Number(process.env.WRITE_CONCURRENCY ?? 6);

const log = (msg: string) => console.log(`[sync-league-games] ${msg}`);

interface Args {
  seasonId: number | null;
  days: number;
  force: boolean;
  repairDuplicates: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const season = get('season');
  const seasonId = season ? seasonIdFromSeasonYear(season) : null;
  if (season && seasonId === null) throw new Error(`Invalid --season "${season}" (expected e.g. 2025-26)`);
  const days = Number(get('days') ?? 3);
  if (!Number.isInteger(days) || days < 1) throw new Error(`Invalid --days "${get('days')}"`);
  return { seasonId, days, force: argv.includes('--force'), repairDuplicates: argv.includes('--repair-duplicates') };
}

/** Game ids to process, and the season they belong to. */
async function selectGameIds(args: Args): Promise<{ seasonId: number; ids: string[] }> {
  if (args.seasonId !== null) {
    return { seasonId: args.seasonId, ids: candidateGameIds(args.seasonId) };
  }
  const schedule = await fetchCurrentSchedule(log);
  const seasonId = seasonIdFromSeasonYear(schedule.leagueSchedule.seasonYear)!;
  const today = easternDateOf(new Date())!;
  const cutoff = easternDateOf(new Date(Date.now() - args.days * 86_400_000))!;
  const ids = scheduleGames(schedule)
    .filter((g) => g.gameStatus === 3 && isNbaFormatGameId(g.gameId, seasonId))
    .filter((g) => {
      const d = g.gameDateEst.slice(0, 10);
      return d >= cutoff && d <= today;
    })
    .map((g) => g.gameId);
  return { seasonId, ids };
}

/** NBA ids (10-char) of this season's games that already have player box scores. */
async function alreadyIngested(seasonId: number): Promise<Set<string>> {
  const rows = await sql<{ nba_game_id: string }[]>`
    SELECT g.nba_game_id::text
    FROM games g
    WHERE g.season_id = ${seasonId}
      AND EXISTS (SELECT 1 FROM game_player_box_scores pb WHERE pb.game_id = g.game_id)
  `;
  return new Set(rows.map((r) => r.nba_game_id.padStart(10, '0')));
}

/**
 * A pre-CDN season from stats.nba.com: every game from the season game logs,
 * except Clippers games, which get the full per-game box score.
 */
async function ingestStatsSeason(seasonId: number, done: Set<string>, failures: string[]): Promise<number> {
  const { teamRows, playerRows } = await fetchSeasonLogs(seasonId, log);
  const games = boxscoresFromSeasonLogs(teamRows, playerRows);
  const todo = games.filter((g) => !done.has(g.gameId));
  log(`${games.length} game(s) in the season logs, ${games.length - todo.length} already ingested, ${todo.length} to write`);

  // Games on one date never share a team, so their writes (stints, rosters)
  // can't collide: each date is written concurrently, dates in order.
  const byDate = new Map<string, typeof todo>();
  for (const g of todo) byDate.set(g.gameDate, [...(byDate.get(g.gameDate) ?? []), g]);

  let ingested = 0;
  let processed = 0;
  let nextReport = 100;
  for (const dayGames of [...byDate.keys()].sort().map((d) => byDate.get(d)!)) {
    await mapPool(dayGames, WRITE_CONCURRENCY, async (g) => {
      try {
        if (g.homeTricode === LAC_TRICODE || g.awayTricode === LAC_TRICODE) {
          const r = await fetchStatsBoxscore(g.gameId, log);
          if (r.status !== 'ok') {
            failures.push(`${g.gameId}: stats.nba.com box score ${r.status === 'error' ? r.message : 'missing'}`);
            return;
          }
          await ingestBoxscore(seasonId, r.boxscore);
        } else {
          await ingestBoxscore(seasonId, g.box, { gameDate: g.gameDate });
        }
        ingested++;
      } catch (err) {
        failures.push(`${g.gameId}: ${(err as Error).message}`);
      }
    });
    processed += dayGames.length;
    if (processed >= nextReport || processed === todo.length) {
      log(`progress ${processed}/${todo.length} — ${ingested} ingested, ${failures.length} failed`);
      nextReport = processed + 100;
    }
  }
  return ingested;
}

/** A CDN season: fetch every candidate id in parallel chunks, write sequentially. */
async function ingestCdnSeason(seasonId: number, ids: string[], done: Set<string>, failures: string[]): Promise<number> {
  const todo = ids.filter((id) => !done.has(id));
  log(`${ids.length - todo.length} already ingested, ${todo.length} to fetch`);

  let ingested = 0;
  let missing = 0;
  let notFinal = 0;

  for (let i = 0; i < todo.length; i += CHUNK_SIZE) {
    const chunk = todo.slice(i, i + CHUNK_SIZE);
    const results = await mapPool(chunk, FETCH_CONCURRENCY, fetchCdnBoxscore);
    for (let j = 0; j < chunk.length; j++) {
      const id = chunk[j];
      const r = results[j];
      if (r.status === 'missing') {
        missing++; // unplayed playoff / play-in id
        continue;
      }
      if (r.status === 'error') {
        failures.push(`${id}: fetch ${r.message}`);
        continue;
      }
      if (r.boxscore.game.gameStatus !== 3) {
        notFinal++;
        continue;
      }
      try {
        await ingestBoxscore(seasonId, r.boxscore);
        ingested++;
      } catch (err) {
        failures.push(`${id}: ${(err as Error).message}`);
      }
    }
    log(`progress ${Math.min(i + CHUNK_SIZE, todo.length)}/${todo.length} — ${ingested} ingested, ${failures.length} failed`);
  }

  log(`Done: ${ingested} ingested, ${missing} not found (unplayed ids), ${notFinal} not final, ${failures.length} failed`);
  return ingested;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const fromStats = args.seasonId !== null && args.seasonId < CDN_FIRST_SEASON;
  const { seasonId, ids } = fromStats
    ? { seasonId: args.seasonId!, ids: [] }
    : await selectGameIds(args);
  log(
    fromStats
      ? `Season ${seasonLabel(seasonId)}: from stats.nba.com (pre-${seasonLabel(CDN_FIRST_SEASON)}, not in the CDN archive)`
      : `Season ${seasonLabel(seasonId)}: ${ids.length} candidate game id(s)`
  );

  await upsertSeasons([seasonId]);

  const done = args.force ? new Set<string>() : await alreadyIngested(seasonId);
  const failures: string[] = [];
  if (fromStats) {
    const ingested = await ingestStatsSeason(seasonId, done, failures);
    log(`Done: ${ingested} ingested, ${failures.length} failed`);
  } else {
    await ingestCdnSeason(seasonId, ids, done, failures);
  }

  // Completeness guard: every completed season has playoffs. cdn.nba.com
  // answers 403 both for ids that don't exist and when it throttles a runner,
  // so a throttled load looks like "not found" and would otherwise pass.
  if (args.seasonId !== null && seasonId < currentSeasonId()) {
    const [{ n }] = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM games g
      WHERE g.season_id = ${seasonId} AND g.is_playoffs
        AND EXISTS (SELECT 1 FROM game_player_box_scores pb WHERE pb.game_id = g.game_id)
    `;
    if (n === 0) {
      failures.push(`no playoff box scores for completed season ${seasonLabel(seasonId)} — the load was likely throttled; re-run it`);
    }
  }

  // Duplicate guard (see findLikelyDuplicates). With --repair-duplicates, safe
  // cases are deleted; anything else fails the run.
  const dupes = await findLikelyDuplicates(seasonId);
  let kept = 0;
  for (const d of dupes) {
    const label = `${d.matchup}: game_id ${d.stale_id} (${d.stale_date}, no box score) vs ${d.real_id} (${d.real_date})`;
    if (args.repairDuplicates) {
      const reason = await removeStaleDuplicate(d, seasonId);
      if (reason === null) {
        log(`removed stale duplicate ${label}`);
        continue;
      }
      console.error(`  duplicate kept (${reason}): ${label}`);
    } else {
      console.error(`  duplicate? ${label}`);
    }
    kept++;
  }
  await sql.end();
  if (kept > 0) {
    failures.push(`${kept} likely duplicate game row(s) — see above${args.repairDuplicates ? '' : ' (re-run with --repair-duplicates)'}`);
  }

  if (failures.length > 0) {
    throw new Error(`${failures.length} game(s) failed:\n  ${failures.slice(0, 50).join('\n  ')}`);
  }
}

main().catch(async (err) => {
  console.error('[sync-league-games] Failed:', err);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
