// scripts/sync-schedule.ts
// Sync the Clippers game schedule from BALLDONTLIE into the games table.
//
// Fetches LAC games from 7 days ago to 30 days ahead and upserts them.
// Run before poll-live on game nights to ensure the target game exists in games table.
//
// Flags:
//   --full-season   Fetch the entire current season (Oct 1 – Jun 30) instead of the rolling window.
//
// Run via: npm run sync-schedule
// Run via: npm run sync:schedule -- --full-season
import { sql } from './lib/db.js';
import { fetchAll } from './lib/bdl-client.js';
import { upsertGames } from './lib/upserts.js';
import type { BDLGame } from './types/bdl.js';

// Build date string YYYY-MM-DD from a Date object
function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

async function main(): Promise<void> {
  // Parse CLI flags
  const args = process.argv.slice(2);
  const fullSeason = args.includes('--full-season');

  // Resolve LAC BDL team_id from teams table
  const [lacTeam] = await sql<{ nba_team_id: number }[]>`
    SELECT nba_team_id FROM teams WHERE abbreviation = 'LAC' LIMIT 1
  `;
  if (!lacTeam) {
    throw new Error('LAC team not found in teams table — run npm run backfill first');
  }
  const lacBdlTeamId = lacTeam.nba_team_id;

  // Determine current NBA season ID.
  // NBA seasons are labeled by their start year (2025 = 2025-26 season).
  // If current month < 6 (July), season started last year; otherwise started this year.
  const now = new Date();
  const currentYear = now.getFullYear();
  const seasonId = now.getMonth() < 6 ? currentYear - 1 : currentYear;

  // Build date window
  let startDateStr: string;
  let endDateStr: string;

  if (fullSeason) {
    startDateStr = `${seasonId}-10-01`;
    endDateStr = `${seasonId + 1}-06-30`;
    console.log(`[sync-schedule] Full season mode: ${startDateStr} to ${endDateStr}`);
  } else {
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 7);
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + 30);
    startDateStr = toDateStr(startDate);
    endDateStr = toDateStr(endDate);
  }

  console.log(`[sync-schedule] Fetching LAC games (${startDateStr} to ${endDateStr})...`);

  const games = await fetchAll<BDLGame>('/games', {
    'team_ids[]': String(lacBdlTeamId),
    start_date: startDateStr,
    end_date: endDateStr,
  });

  console.log(`[sync-schedule] Found ${games.length} games. Upserting...`);

  await upsertGames(games, seasonId);

  console.log(`[sync-schedule] Done. ${games.length} games synced.`);

  await sql.end();
}

main().catch(err => {
  console.error('[sync-schedule] Failed:', err);
  sql.end();
  process.exit(1);
});
