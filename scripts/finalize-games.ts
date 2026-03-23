// scripts/finalize-games.ts
// Catch-up script: finds all Final games without box scores and finalizes them.
// Use when poll-live.ts was not running when a game completed, or when inline
// finalization failed. Idempotent — safe to run multiple times on same game.
//
// Flags:
//   --since=YYYY-MM-DD   Look back to the given date instead of the default 7-day window.
//                        Example: npm run finalize-games -- --since=2025-10-01

import { sql } from './lib/db.js';
import { finalizeGame } from './lib/finalize.js';

async function main() {
  // Parse CLI flags
  const args = process.argv.slice(2);
  const sinceArg = args.find(a => a.startsWith('--since='));
  const sinceDate = sinceArg ? sinceArg.split('=')[1] : null;

  console.log(sinceDate
    ? `[finalize-games] Using --since=${sinceDate}`
    : '[finalize-games] Default: last 7 days');
  console.log('[finalize-games] Finding Final games without box scores...');

  // Find games with status='final' that have no rows in game_team_box_scores.
  // Default: limit to last 7 days to avoid processing stale games from prior seasons.
  // With --since: use the provided date as the lower bound for full-season backfill.
  const unfinalized = sinceDate
    ? await sql<{ game_id: string; nba_game_id: string }[]>`
        SELECT g.game_id::text, g.nba_game_id
        FROM games g
        LEFT JOIN game_team_box_scores gtbs ON gtbs.game_id = g.game_id
        WHERE g.status = 'final'
          AND gtbs.game_id IS NULL
          AND g.game_date >= ${sinceDate}::date
        ORDER BY g.game_date DESC
      `
    : await sql<{ game_id: string; nba_game_id: string }[]>`
        SELECT g.game_id::text, g.nba_game_id
        FROM games g
        LEFT JOIN game_team_box_scores gtbs ON gtbs.game_id = g.game_id
        WHERE g.status = 'final'
          AND gtbs.game_id IS NULL
          AND g.game_date >= CURRENT_DATE - INTERVAL '7 days'
        ORDER BY g.game_date DESC
      `;

  if (unfinalized.length === 0) {
    console.log('[finalize-games] No unfinalized games found. All done.');
    await sql.end();
    return;
  }

  console.log(`[finalize-games] Found ${unfinalized.length} game(s) to finalize.`);

  for (const game of unfinalized) {
    console.log(`[finalize-games] Finalizing ${game.nba_game_id}...`);
    await finalizeGame(game.game_id, game.nba_game_id);
  }

  console.log(`[finalize-games] Done. ${unfinalized.length} game(s) processed.`);
  await sql.end();
}

main().catch(console.error);
