// scripts/finalize-games.ts
// Catch-up script: finds LAC games that are over but have no box scores and
// finalizes them. Use when poll-live.ts was not running when a game completed,
// or when inline finalization failed. Idempotent — safe to run multiple times.
//
// Candidates (LAC games in the lookback window with no player box score rows):
//   - status = 'final', or
//   - status not final but tipoff (start_time_utc, else end of game_date ET)
//     was more than 4 hours ago — the poller may have missed the final buzzer.
//
// Exits non-zero if any game fails (including games whose nba_game_id is a
// balldontlie id, which cannot be fetched from the NBA CDN) so the nightly
// workflow fails loudly instead of silently leaving games without box scores.
//
// Flags:
//   --since=YYYY-MM-DD   Look back to the given date instead of the default 7-day window.
//                        Example: npm run finalize-games -- --since=2025-10-01

import { sql } from './lib/db.js';
import { finalizeGame } from './lib/finalize.js';
import { toNbaGameId10 } from './lib/schedule-utils.js';

async function main() {
  // Parse CLI flags
  const args = process.argv.slice(2);
  const sinceArg = args.find(a => a.startsWith('--since='));
  const sinceDate = sinceArg ? sinceArg.split('=')[1] : null;
  if (sinceDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(sinceDate)) {
    throw new Error(`Invalid --since value "${sinceDate}" (expected YYYY-MM-DD)`);
  }

  console.log(sinceDate
    ? `[finalize-games] Using --since=${sinceDate}`
    : '[finalize-games] Default: last 7 days');
  console.log('[finalize-games] Finding finished LAC games without box scores...');

  // Default: limit to last 7 days to avoid processing stale games from prior seasons.
  // With --since: use the provided date as the lower bound for full-season backfill.
  const lowerBound = sinceDate
    ? sql`${sinceDate}::date`
    : sql`CURRENT_DATE - INTERVAL '7 days'`;

  const unfinalized = await sql<{ game_id: string; nba_game_id: string; season_id: number | null; game_date: string; status: string }[]>`
    SELECT g.game_id::text, g.nba_game_id::text, g.season_id,
           g.game_date::text AS game_date, g.status
    FROM games g
    WHERE EXISTS (
        SELECT 1 FROM teams t
        WHERE t.abbreviation = 'LAC' AND t.team_id IN (g.home_team_id, g.away_team_id)
      )
      AND NOT EXISTS (
        SELECT 1 FROM game_player_box_scores pb WHERE pb.game_id = g.game_id
      )
      AND g.game_date >= ${lowerBound}
      AND (
        lower(g.status) = 'final'
        OR COALESCE(
             g.start_time_utc,
             -- no tipoff time: treat as midnight ET after the (Eastern) game date
             ((g.game_date + 1)::timestamp AT TIME ZONE 'America/New_York')
           ) < now() - INTERVAL '4 hours'
      )
    ORDER BY g.game_date DESC
  `;

  if (unfinalized.length === 0) {
    console.log('[finalize-games] No unfinalized games found. All done.');
    await sql.end();
    return;
  }

  console.log(`[finalize-games] Found ${unfinalized.length} game(s) to finalize.`);

  const failures: string[] = [];
  for (const game of unfinalized) {
    const label = `${game.game_date} game_id=${game.game_id} nba_game_id=${game.nba_game_id} (status ${game.status})`;
    if (!toNbaGameId10(game.nba_game_id, game.season_id)) {
      // Balldontlie-keyed row: no NBA id to fetch with. Re-running
      // backfill-schedule-nba attaches the NBA id to this row.
      console.error(`[finalize-games] SKIP ${label}: not an NBA-format game id — run backfill-schedule-nba`);
      failures.push(label);
      continue;
    }
    console.log(`[finalize-games] Finalizing ${label}...`);
    try {
      await finalizeGame(game.game_id, game.nba_game_id);
    } catch (err) {
      console.error(`[finalize-games] FAILED ${label}: ${(err as Error).message}`);
      failures.push(label);
    }
  }

  const ok = unfinalized.length - failures.length;
  console.log(`[finalize-games] Done. ${ok}/${unfinalized.length} game(s) finalized.`);
  await sql.end();

  if (failures.length > 0) {
    throw new Error(`${failures.length} game(s) not finalized:\n  ${failures.join('\n  ')}`);
  }
}

main().catch(async err => {
  console.error('[finalize-games] Failed:', err);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
