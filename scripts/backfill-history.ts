// scripts/backfill-history.ts
// One-time history backfill, run LOCALLY (stats.nba.com blocks cloud IPs).
// Walks seasons newest-first from just below the earliest complete season
// already loaded, one sync-league-games run per season, then Clippers
// play-by-play for that season (--pbp). After each clean season it records
// app_kv 'history:backfilled_through' and prints the database size, so an
// interrupted run resumes where it stopped. Stops at --stop-at (default
// 2010-11) for a storage check; continue with --stop-at=1996-97.
// Finishes with compute-stats and build-record-book.
//
// Run via: npm run backfill-history [-- --stop-at=1996-97] [-- --pbp]
import { execFileSync } from 'node:child_process';
import { sql } from './lib/db.js';
import { seasonIdFromSeasonYear, seasonLabel } from './lib/schedule-utils.js';
import { REGULAR_SEASON } from './lib/sql-fragments.js';
import { planHistorySeasons } from './lib/backfill-plan.js';
import { resolveRecordsStart, type SeasonCoverage } from './lib/record-book/records-start.js';

const log = (msg: string) => console.log(`[backfill-history] ${msg}`);
const tsx = (script: string, args: string[] = []) =>
  execFileSync('npx', ['tsx', script, ...args], { stdio: 'inherit', env: process.env });

async function dbSize(): Promise<string> {
  const [row] = await sql<{ size: string }[]>`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`;
  return row.size;
}

async function main() {
  const argv = process.argv.slice(2);
  const stopArg = argv.find((a) => a.startsWith('--stop-at='))?.split('=')[1] ?? '2010-11';
  const stopAt = seasonIdFromSeasonYear(stopArg);
  if (stopAt === null) throw new Error(`Invalid --stop-at "${stopArg}" (expected e.g. 2010-11)`);
  const withPbp = argv.includes('--pbp');

  const [kv] = await sql<{ value: number }[]>`SELECT value::int AS value FROM app_kv WHERE key = 'history:backfilled_through'`;
  const coverage = await sql<SeasonCoverage[]>`
    SELECT g.season_id::int AS season_id, COUNT(*)::int AS games_with_box
    FROM games g
    WHERE g.status = 'final' AND g.season_id IS NOT NULL AND ${sql.unsafe(REGULAR_SEASON)}
      AND EXISTS (SELECT 1 FROM game_player_box_scores pb WHERE pb.game_id = g.game_id)
    GROUP BY g.season_id`;
  const loadedThrough = kv?.value ?? resolveRecordsStart(coverage, null);
  if (loadedThrough === null) throw new Error('No complete season loaded yet — run sync-league-games for the current era first');
  const seasons = planHistorySeasons(loadedThrough, stopAt);
  log(`Database ${await dbSize()}. Seasons to backfill: ${seasons.length ? seasons.map(seasonLabel).join(', ') : 'none'}`);

  for (const season of seasons) {
    log(`── ${seasonLabel(season)} ──`);
    try {
      tsx('scripts/sync-league-games.ts', [`--season=${seasonLabel(season)}`]);
      if (withPbp) tsx('scripts/ingest-pbp.ts', [`--season=${seasonLabel(season)}`]);
    } catch {
      log(`${seasonLabel(season)} failed. Re-run \`npm run backfill-history\` to retry it (finished seasons are kept).`);
      log('If the log shows "stats.nba.com HTTP 403", this network is blocked: stop here; records will start at the last clean season.');
      await sql.end();
      process.exit(1);
    }
    await sql`
      INSERT INTO app_kv (key, value, updated_at) VALUES ('history:backfilled_through', ${sql.json(season)}, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    log(`${seasonLabel(season)} done. Database ${await dbSize()}.`);
  }

  log('Computing derived stats and the record book…');
  tsx('scripts/compute-stats.ts');
  tsx('scripts/build-record-book.ts');
  log(`Finished. Database ${await dbSize()}. To go further back: npm run backfill-history -- --stop-at=1996-97${withPbp ? ' --pbp' : ''}`);
  await sql.end();
}

main().catch(async (err) => {
  console.error('[backfill-history] Failed:', err);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
