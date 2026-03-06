// scripts/finalize-games.ts
// Catch-up script: finds all Final games without box scores and finalizes them.
// Use when poll-live.ts was not running when a game completed, or when inline
// finalization failed. Idempotent — safe to run multiple times on same game.

import { sql } from './lib/db.js';
import { finalizeGame } from './lib/finalize.js';

async function main() {
  console.log('[finalize-games] Finding Final games without box scores...');

  // Find games with status='final' that have no rows in game_team_box_scores.
  // Limit to last 7 days to avoid processing stale games from prior seasons.
  const unfinalized = await sql<{ game_id: string; nba_game_id: string }[]>`
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
