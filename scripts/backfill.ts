// scripts/backfill.ts
// Main orchestrator for the 3-season historical data backfill.
// Run via: npm run backfill
import { sql } from './lib/db.js';
import { fetchAll, withRetry, sleep, DELAY_MS } from './lib/bdl-client.js';
import {
  upsertSeasons, upsertTeams, upsertPlayers, upsertStints,
  upsertGames, upsertBoxScoresForGame, getCheckpoint, setCheckpoint,
} from './lib/upserts.js';
import type { BDLTeam, BDLPlayer, BDLGame, BDLStat } from './types/bdl.js';

const SEASONS = [2022, 2023, 2024];
const skippedGameIds: number[] = [];

// ---- Helpers ----

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

/**
 * Fetch all stats for a batch of game IDs.
 * BDL /stats accepts repeated game_ids[] query params.
 * We build the URL manually because fetchAll only supports Record<string, string>
 * which can't express repeated keys.
 */
async function fetchStatsForBatch(gameIds: number[]): Promise<BDLStat[]> {
  const BDL_BASE = 'https://api.balldontlie.io/v1';
  const BDL_API_KEY = process.env.BALLDONTLIE_API_KEY!;
  const REQUEST_TIMEOUT_MS = 30_000;
  const MAX_RETRIES = 3;
  const results: BDLStat[] = [];
  let cursor: number | null = null;
  let page = 0;

  do {
    page++;
    const qp = gameIds.map(id => `game_ids[]=${id}`).join('&');
    const cursorParam = cursor !== null ? `&cursor=${cursor}` : '';
    const url = `${BDL_BASE}/stats?${qp}&per_page=100${cursorParam}`;

    type StatsPage = { data: BDLStat[]; meta: { next_cursor: number | null; per_page: number } };
    let data: StatsPage | null = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(url, { headers: { Authorization: BDL_API_KEY }, signal: controller.signal });
        if (res.status === 429) throw new Error('RATE_LIMITED');
        if (!res.ok) throw new Error(`BDL ${res.status}: /stats game_ids batch`);
        data = await res.json() as StatsPage;
        break;
      } catch (err) {
        const msg = (err as Error).name === 'AbortError' ? `TIMEOUT after ${REQUEST_TIMEOUT_MS}ms` : (err as Error).message;
        const wait = msg.startsWith('RATE_LIMITED') ? DELAY_MS : Math.pow(2, attempt) * 1000;
        console.warn(`  [/stats] page ${page} attempt ${attempt + 1}/${MAX_RETRIES} failed: ${msg}. Retrying in ${wait}ms...`);
        await sleep(wait);
      } finally {
        clearTimeout(timeout);
      }
    }

    if (!data) throw new Error(`/stats batch: page ${page} failed after ${MAX_RETRIES} retries`);

    results.push(...data.data);
    cursor = data.meta?.next_cursor ?? null;
    console.log(`  [/stats] page ${page}: +${data.data.length} (${results.length} total)${cursor !== null ? ', fetching next...' : ', done'}`);
    if (cursor !== null) await sleep(DELAY_MS);
  } while (cursor !== null);

  return results;
}

// ---- Summary ----

async function printSummary(): Promise<void> {
  const [counts] = await sql<[{
    teams: bigint; players: bigint; games: bigint;
    team_boxes: bigint; player_boxes: bigint;
  }]>`
    SELECT
      (SELECT count(*) FROM teams)                    AS teams,
      (SELECT count(*) FROM players)                  AS players,
      (SELECT count(*) FROM games)                    AS games,
      (SELECT count(*) FROM game_team_box_scores)     AS team_boxes,
      (SELECT count(*) FROM game_player_box_scores)   AS player_boxes
  `;
  console.log('\n========================================');
  console.log('Backfill complete.');
  console.log(`Teams:             ${counts.teams}`);
  console.log(`Players:           ${counts.players}`);
  console.log(`Games:             ${counts.games}`);
  console.log(`Team box scores:   ${counts.team_boxes}`);
  console.log(`Player box scores: ${counts.player_boxes}`);
  if (skippedGameIds.length > 0) {
    console.log(`Skipped game IDs:  ${skippedGameIds.join(', ')}`);
  } else {
    console.log('Skipped game IDs:  (none)');
  }
  console.log('========================================\n');
}

// ---- Main ----

async function main(): Promise<void> {
  console.log('========================================');
  console.log('Clippers Command Center — Historical Backfill');
  console.log(`Seasons: ${SEASONS.join(', ')}`);
  console.log(`Delay between requests: ${DELAY_MS}ms`);
  if (DELAY_MS < 12000) {
    console.log('  Note: DELAY_MS < 12000. Ensure you have an ALL-STAR tier BDL key (60 req/min).');
  }
  console.log('========================================\n');

  // Step 0: Upsert season metadata rows
  await upsertSeasons(SEASONS);

  // Step 1: Sync all teams (one-time, ~30 teams)
  console.log('[1/5] Syncing teams...');
  const teams = await fetchAll<BDLTeam>('/teams');
  await upsertTeams(teams);
  console.log(`  Teams: ${teams.length} upserted`);
  await sleep(DELAY_MS);

  // Step 2: Sync all players (paginated, 500-700+ players)
  console.log('\n[2/5] Syncing players...');
  const players = await fetchAll<BDLPlayer>('/players');
  await upsertPlayers(players);
  console.log(`  Players: ${players.length} upserted`);
  await sleep(DELAY_MS);

  // Step 3-5: Process each season
  for (let i = 0; i < SEASONS.length; i++) {
    const seasonId = SEASONS[i];
    const stepNum = i + 3; // Steps 3, 4, 5
    const stepLabel = `[${stepNum}/5] Season ${seasonId}`;

    const lastCompleted = await getCheckpoint('backfill:last_completed_season');
    if (lastCompleted >= seasonId) {
      console.log(`\n${stepLabel}: already complete, skipping.`);
      continue;
    }

    console.log(`\n${stepLabel}: starting...`);

    // 4a: Fetch all games for this season
    console.log('  Fetching games...');
    const allGames = await fetchAll<BDLGame>('/games', { 'seasons[]': String(seasonId) });
    await sleep(DELAY_MS);

    const finalGames = allGames.filter(g => g.status === 'Final');
    const skipped = allGames.length - finalGames.length;
    console.log(`  ${finalGames.length} final games found (${skipped} non-final skipped)`);

    // 4b: Upsert games
    console.log('  Upserting games...');
    await upsertGames(finalGames, seasonId);

    // 4c: Fetch stats in batches of 100 game IDs
    const gameIds = finalGames.map(g => g.id);
    const batches = chunk(gameIds, 100);
    console.log(`  Fetching stats in ${batches.length} batch(es)...`);

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      const batchStart = b * 100 + 1;
      const batchEnd = batchStart + batch.length - 1;
      console.log(`  Fetching stats batch ${b + 1}/${batches.length} (games ${batchStart}-${batchEnd})...`);

      const stats = await withRetry(() => fetchStatsForBatch(batch));
      if (!stats) {
        console.warn(`  Batch ${b + 1} failed after retries — skipping ${batch.length} games.`);
        skippedGameIds.push(...batch);
        await sleep(DELAY_MS);
        continue;
      }

      // Group stats by game_id
      const statsByGame = new Map<number, BDLStat[]>();
      for (const stat of stats) {
        const gid = stat.game.id;
        if (!statsByGame.has(gid)) statsByGame.set(gid, []);
        statsByGame.get(gid)!.push(stat);
      }

      // For each game in this batch, upsert players-from-stats (handles mid-season rosters),
      // upsert stints, then upsert box scores
      for (const [bdlGameId, gameStats] of statsByGame) {
        // Upsert any new players discovered via stats (roster changes, mid-season additions)
        const newPlayers = gameStats.map(s => s.player);
        await upsertPlayers(newPlayers);

        // Upsert stints for each player-team-season combo
        for (const stat of gameStats) {
          await upsertStints(stat.player.id, stat.team.id, seasonId);
        }

        // Get internal game_id from nba_game_id (stored as text to avoid bigint param friction)
        const [gameRow] = await sql<{ game_id: string }[]>`
          SELECT game_id::text FROM games WHERE nba_game_id = ${bdlGameId}
        `;
        if (!gameRow) {
          console.warn(`  game_id not found for nba_game_id=${bdlGameId}, skipping box scores`);
          skippedGameIds.push(bdlGameId);
          continue;
        }

        try {
          await upsertBoxScoresForGame(gameRow.game_id, [], gameStats);
        } catch (err) {
          console.warn(`  Box score failed for game ${bdlGameId}: ${(err as Error).message}`);
          skippedGameIds.push(bdlGameId);
        }
      }

      await sleep(DELAY_MS);
    }

    await setCheckpoint('backfill:last_completed_season', seasonId);
    console.log(`  Season ${seasonId}: COMPLETE (${finalGames.length} games)`);
  }

  await printSummary();
  await sql.end();
}

main().catch(err => {
  console.error('Backfill failed:', err);
  sql.end();
  process.exit(1);
});
