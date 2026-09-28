// scripts/ingest-pbp.ts
// Play-by-play → derived tables for final Clippers games that have box scores
// and no game_flow row yet (--force: re-derive them too).
//
//   (default)        games in the last --days (default 3) — the nightly job
//   --season=2005-06 a whole season (stats.nba.com before 2019-20: run locally)
//   --game=<game_id> one game; with --from-file=<json> --format=cdn|stats_pbp
//                    the play-by-play is read from disk (tests, replays)
//   --keep-raw       store raw events even for past seasons (replay games)
//
// A feed whose last score differs from the game's final is counted incomplete
// and not written (not a failure; the next run retries it).
// Also prunes past seasons' raw events. Exits 1 if any game fails.
// Run via: npm run ingest-pbp [-- --season=2025-26]
import fs from 'node:fs';
import { sql } from './lib/db.js';
import { seasonIdFromSeasonYear } from './lib/schedule-utils.js';
import { ingestGamePbp, pruneRawEvents } from './lib/pbp/ingest.js';
import type { PbpSource, RawPlayByPlay } from './lib/pbp/types.js';

const log = (msg: string) => console.log(`[ingest-pbp] ${msg}`);

function parseArgs(argv: string[]) {
  const get = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const season = get('season');
  const seasonId = season ? seasonIdFromSeasonYear(season) : null;
  if (season && seasonId === null) throw new Error(`Invalid --season "${season}" (expected e.g. 2025-26)`);
  const days = Number(get('days') ?? 3);
  if (!Number.isInteger(days) || days < 1) throw new Error(`Invalid --days "${get('days')}"`);
  const game = get('game') ?? null;
  if (game !== null && !/^\d+$/.test(game)) throw new Error(`Invalid --game "${game}"`);
  const fromFile = get('from-file') ?? null;
  const format = (get('format') ?? 'cdn') as PbpSource;
  if (fromFile && !game) throw new Error('--from-file needs --game');
  if (!['cdn', 'stats_pbp'].includes(format)) throw new Error(`Invalid --format "${format}"`);
  return { seasonId, days, game, fromFile, format, keepRaw: argv.includes('--keep-raw'), force: argv.includes('--force') };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filter = args.game
    ? sql`AND g.game_id = ${args.game}::bigint`
    : args.seasonId !== null
      ? sql`AND g.season_id = ${args.seasonId}`
      : sql`AND g.game_date >= CURRENT_DATE - ${args.days}::int`;

  const games = await sql<{ game_id: string }[]>`
    SELECT g.game_id::text AS game_id
    FROM games g
    JOIN teams h ON h.team_id = g.home_team_id
    JOIN teams a ON a.team_id = g.away_team_id
    WHERE 'LAC' IN (h.abbreviation, a.abbreviation)
      AND g.status = 'final'
      AND EXISTS (SELECT 1 FROM game_player_box_scores pb WHERE pb.game_id = g.game_id)
      ${args.force ? sql`` : sql`AND NOT EXISTS (SELECT 1 FROM game_flow f WHERE f.game_id = g.game_id)`}
      ${filter}
    ORDER BY g.game_date DESC, g.game_id DESC
  `;
  log(`${games.length} game(s) to ingest`);

  const raw = args.fromFile
    ? { data: JSON.parse(fs.readFileSync(args.fromFile, 'utf8')) as RawPlayByPlay, source: args.format }
    : undefined;

  let ingested = 0;
  let missing = 0;
  let incomplete = 0;
  const failures: string[] = [];
  for (const [i, g] of games.entries()) {
    try {
      const r = await ingestGamePbp(g.game_id, { raw, keepRaw: args.keepRaw || undefined, log });
      if (r.status === 'missing') missing++;
      else if (r.status === 'incomplete') {
        incomplete++;
        log(`game ${g.game_id}: feed ends at ${r.got.home}-${r.got.away}, final is ${r.expected.home}-${r.expected.away} — not written (retried next run)`);
      } else {
        ingested++;
        if (r.unknownPlayers > 0) log(`game ${g.game_id}: ${r.unknownPlayers} player id(s) not in players — their lines were skipped`);
      }
    } catch (err) {
      failures.push(`${g.game_id}: ${(err as Error).message}`);
    }
    if ((i + 1) % 50 === 0) log(`progress ${i + 1}/${games.length}`);
  }

  const pruned = await pruneRawEvents();
  log(`Done: ${ingested} ingested, ${incomplete} incomplete, ${missing} without play-by-play, ${failures.length} failed; pruned ${pruned} old raw event(s)`);
  await sql.end();
  if (failures.length) throw new Error(`${failures.length} game(s) failed:\n  ${failures.slice(0, 50).join('\n  ')}`);
}

main().catch(async (err) => {
  console.error('[ingest-pbp] Failed:', err);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
