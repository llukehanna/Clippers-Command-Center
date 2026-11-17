// scripts/cleanup-player-raw-payload.ts
// One-time storage cleanup: nothing reads game_player_box_scores.raw_payload, so
// null it out in ID batches, then VACUUM FULL the table to give the space back.
// Refuses to run within 30 minutes of the last live poll (never during a game),
// because VACUUM FULL takes an exclusive lock on the table.
//
// Run via: npm run cleanup-player-raw-payload [-- --dry-run]
import { sql } from './lib/db.js';
import { idBatches } from './lib/id-batches.js';

const BATCH_SIZE = 20_000;
const QUIET_MINUTES = 30;

const log = (msg: string) => console.log(`[cleanup-player-raw-payload] ${msg}`);

async function sizes(): Promise<{ table: string; db: string }> {
  const [row] = await sql<{ table: string; db: string }[]>`
    SELECT pg_size_pretty(pg_total_relation_size('game_player_box_scores')) AS "table",
           pg_size_pretty(pg_database_size(current_database())) AS db
  `;
  return row;
}

async function assertNoRecentPoll(): Promise<void> {
  const [row] = await sql<{ value: unknown }[]>`SELECT value FROM app_kv WHERE key = 'live:last_poll_at'`;
  if (!row) return;
  const polledAt = new Date(row.value as string | number).getTime();
  if (Number.isNaN(polledAt)) return;
  const ageMin = (Date.now() - polledAt) / 60_000;
  if (ageMin < QUIET_MINUTES) {
    throw new Error(`Live poll ran ${ageMin.toFixed(1)} min ago (< ${QUIET_MINUTES}); refusing to run during a game.`);
  }
}

async function main() {
  const dryRun = process.argv.slice(2).includes('--dry-run');
  const before = await sizes();
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM game_player_box_scores WHERE raw_payload IS NOT NULL
  `;
  log(`before: table ${before.table}, database ${before.db}, rows with raw_payload: ${n}`);
  if (dryRun) return;

  await assertNoRecentPoll();

  const [range] = await sql<{ min: string | null; max: string | null }[]>`
    SELECT MIN(game_player_box_score_id)::text AS min, MAX(game_player_box_score_id)::text AS max
    FROM game_player_box_scores
  `;
  if (range.min !== null && range.max !== null) {
    let cleared = 0;
    for (const [from, to] of idBatches(Number(range.min), Number(range.max), BATCH_SIZE)) {
      const res = await sql`
        UPDATE game_player_box_scores SET raw_payload = NULL
        WHERE game_player_box_score_id BETWEEN ${from} AND ${to} AND raw_payload IS NOT NULL
      `;
      cleared += res.count;
      log(`ids ${from}-${to}: cleared ${res.count} (total ${cleared})`);
    }
  }

  log('VACUUM FULL game_player_box_scores ...');
  await sql.unsafe('VACUUM FULL game_player_box_scores');

  const after = await sizes();
  log(`after: table ${after.table} (was ${before.table}), database ${after.db} (was ${before.db})`);
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error(err);
    await sql.end();
    process.exit(1);
  });
