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

const FETCH_CONCURRENCY = 8;
const CHUNK_SIZE = 64; // fetch a chunk in parallel, then write it sequentially

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { seasonId, ids } = await selectGameIds(args);
  log(`Season ${seasonLabel(seasonId)}: ${ids.length} candidate game id(s)`);

  await upsertSeasons([seasonId]);

  const done = args.force ? new Set<string>() : await alreadyIngested(seasonId);
  const todo = ids.filter((id) => !done.has(id));
  log(`${ids.length - todo.length} already ingested, ${todo.length} to fetch`);

  let ingested = 0;
  let missing = 0;
  let notFinal = 0;
  const failures: string[] = [];

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
