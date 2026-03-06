// scripts/sync-schedule.ts
// Sync the Clippers game schedule from BALLDONTLIE into the games table.
//
// Fetches LAC games from 7 days ago to 30 days ahead and upserts them.
// Run before poll-live on game nights to ensure the target game exists in games table.
//
// Run via: npm run sync-schedule
import { sql } from './lib/db.js';
import { fetchAll } from './lib/bdl-client.js';
import { upsertGames } from './lib/upserts.js';
import type { BDLGame } from './types/bdl.js';

// Build date string YYYY-MM-DD from a Date object
function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

async function main(): Promise<void> {
  // Resolve LAC BDL team_id from teams table
  const [lacTeam] = await sql<{ nba_team_id: number }[]>`
    SELECT nba_team_id FROM teams WHERE abbreviation = 'LAC' LIMIT 1
  `;
  if (!lacTeam) {
    throw new Error('LAC team not found in teams table — run npm run backfill first');
  }
  const lacBdlTeamId = lacTeam.nba_team_id;

  // Build date window: last 7 days + next 30 days
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - 7);
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + 30);

  const startDateStr = toDateStr(startDate);
  const endDateStr = toDateStr(endDate);

  console.log(`[sync-schedule] Fetching LAC games (${startDateStr} to ${endDateStr})...`);

  const games = await fetchAll<BDLGame>('/games', {
    'team_ids[]': String(lacBdlTeamId),
    start_date: startDateStr,
    end_date: endDateStr,
  });

  console.log(`[sync-schedule] Found ${games.length} games. Upserting...`);

  // Determine current NBA season ID.
  // NBA seasons are labeled by their start year (2025 = 2025-26 season).
  // If current month < 7 (July), season started last year; otherwise started this year.
  const currentYear = now.getFullYear();
  const seasonId = now.getMonth() < 6 ? currentYear - 1 : currentYear;

  await upsertGames(games, seasonId);

  console.log(`[sync-schedule] Done. ${games.length} games synced.`);

  await sql.end();
}

main().catch(err => {
  console.error('[sync-schedule] Failed:', err);
  sql.end();
  process.exit(1);
});
