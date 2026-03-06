// scripts/backfill.ts
// Seed the database with 3 seasons of reference and schedule data from BALLDONTLIE.
//
// Scope (free BDL tier):
//   - Teams and players (reference data)
//   - Game schedule and metadata (scores, status, dates) for seasons 2022–2024
//
// Out of scope (requires paid BDL tier or NBA live JSON finalization):
//   - Player/team box scores — populated post-game via NBA live JSON (Phase 7)
//   - Advanced stats — computed after box scores exist (Phase 5)
//
// Run via: npm run backfill
import { sql } from './lib/db.js';
import { fetchAll, sleep, DELAY_MS } from './lib/bdl-client.js';
import {
  upsertSeasons, upsertTeams, upsertPlayers,
  upsertGames, getCheckpoint, setCheckpoint,
} from './lib/upserts.js';
import type { BDLTeam, BDLPlayer, BDLGame } from './types/bdl.js';

const SEASONS = [2022, 2023, 2024];

// ---- Summary ----

async function printSummary(): Promise<void> {
  const [counts] = await sql<[{ teams: bigint; players: bigint; games: bigint }]>`
    SELECT
      (SELECT count(*) FROM teams)   AS teams,
      (SELECT count(*) FROM players) AS players,
      (SELECT count(*) FROM games)   AS games
  `;
  console.log('\n========================================');
  console.log('Backfill complete.');
  console.log(`Teams:   ${counts.teams}`);
  console.log(`Players: ${counts.players}`);
  console.log(`Games:   ${counts.games}`);
  console.log('Note: box scores are populated post-game via NBA live JSON (Phase 7).');
  console.log('========================================\n');
}

// ---- Main ----

async function main(): Promise<void> {
  console.log('========================================');
  console.log('Clippers Command Center — Reference + Schedule Backfill');
  console.log(`Seasons: ${SEASONS.join(', ')}`);
  console.log(`Delay between requests: ${DELAY_MS}ms`);
  console.log('========================================\n');

  // Step 0: Upsert season metadata rows
  await upsertSeasons(SEASONS);

  // Step 1: Sync all teams (~30 teams, no pagination)
  console.log('[1/5] Syncing teams...');
  const teams = await fetchAll<BDLTeam>('/teams');
  await upsertTeams(teams);
  console.log(`  Teams: ${teams.length} upserted`);
  await sleep(DELAY_MS);

  // Step 2: Sync all active players (paginated)
  console.log('\n[2/5] Syncing players...');
  const players = await fetchAll<BDLPlayer>('/players');
  await upsertPlayers(players);
  console.log(`  Players: ${players.length} upserted`);
  await sleep(DELAY_MS);

  // Steps 3–5: Game schedule per season (all statuses — scheduled, in-progress, final)
  for (let i = 0; i < SEASONS.length; i++) {
    const seasonId = SEASONS[i];
    const stepNum = i + 3;
    const stepLabel = `[${stepNum}/5] Season ${seasonId}`;

    const lastCompleted = await getCheckpoint('backfill:last_completed_season');
    if (lastCompleted >= seasonId) {
      console.log(`\n${stepLabel}: already complete, skipping.`);
      continue;
    }

    console.log(`\n${stepLabel}: fetching games...`);
    const games = await fetchAll<BDLGame>('/games', { 'seasons[]': String(seasonId) });
    await sleep(DELAY_MS);

    console.log(`  ${games.length} games found — upserting...`);
    await upsertGames(games, seasonId);

    await setCheckpoint('backfill:last_completed_season', seasonId);
    console.log(`  Season ${seasonId}: COMPLETE`);
  }

  await printSummary();
  await sql.end();
}

main().catch(err => {
  console.error('Backfill failed:', err);
  sql.end();
  process.exit(1);
});
