// scripts/game-night.ts
// Game-night live runner, launched hourly by .github/workflows/game-night.yml.
//
// 1. Looks for a Clippers game that isn't final and tips within the next
//    LEAD_MINUTES (or tipped in the last 4 hours). None → exits in seconds.
// 2. Sleeps until ~10 minutes before tip, then polls every 12 seconds via the
//    shared live cycle (scripts/lib/live-cycle.ts), matching the scoreboard by
//    NBA game id.
// 3. When the scoreboard says Final, finalizes the game (box scores, stints,
//    advanced stats) and exits. The nightly post-game workflow still runs the
//    league sync, stats and insights.
//
// Overlapping hourly launches are serialized by the workflow's concurrency
// group, so a later launch just finds the game already final and exits.

import { sql } from './lib/db.js';
import { calculateBackoff } from './lib/poll-live-logic.js';
import { findLiveCandidates, runLiveCycle, type LiveCandidate } from './lib/live-cycle.js';
import { finalizeGame } from './lib/finalize.js';
import { parseNBAClock } from './lib/nba-live-client.js';
import { ingestGamePbp } from './lib/pbp/ingest.js';

const POLL_INTERVAL_MS = 12_000;
const LEAD_MINUTES = Number(process.env.GAME_NIGHT_LEAD_MINUTES ?? 75);
const PRE_TIP_MS = 10 * 60_000;
// Stop before the workflow's timeout so the job ends cleanly (the next hourly
// launch picks the game back up if it's somehow still going).
const MAX_RUNTIME_MS = Number(process.env.GAME_NIGHT_MAX_MINUTES ?? 330) * 60_000;
// Scoreboard hasn't listed the game for this long after tip → give up.
const NOT_LISTED_GIVE_UP_MS = 30 * 60_000;

const startedAt = Date.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const [candidate] = await findLiveCandidates(sql, LEAD_MINUTES);
  if (!candidate) {
    console.log('[game-night] No Clippers game in the window. Nothing to do.');
    return;
  }
  const tip = candidate.start_time_utc ? new Date(candidate.start_time_utc) : null;
  console.log(
    `[game-night] Game ${candidate.nba_game_id} (row ${candidate.game_id}), tip ${tip?.toISOString() ?? 'unknown'}`
  );

  if (tip) {
    const wait = tip.getTime() - PRE_TIP_MS - Date.now();
    if (wait > 0) {
      console.log(`[game-night] Sleeping ${Math.round(wait / 60_000)} min until 10 min before tip.`);
      await sleep(wait);
    }
  }

  await pollLoop(candidate, tip);
}

async function pollLoop(candidate: LiveCandidate, tip: Date | null): Promise<void> {
  let failures = 0;
  let snapshots = 0;
  let notListedSince: number | null = null;

  while (Date.now() - startedAt < MAX_RUNTIME_MS) {
    let delay = POLL_INTERVAL_MS;
    try {
      const result = await runLiveCycle(sql, candidate);
      failures = 0;

      if (result.state === 'NOT_ON_SCOREBOARD') {
        // The CDN scoreboard rolls over mid-morning ET; before tip the game can
        // legitimately be missing for a while. Long after tip, stop.
        notListedSince ??= Date.now();
        const pastTip = !tip || Date.now() > tip.getTime();
        if (pastTip && Date.now() - notListedSince > NOT_LISTED_GIVE_UP_MS) {
          console.warn('[game-night] Game not on the scoreboard for 30 min after tip. Stopping.');
          return;
        }
        delay = 60_000;
      } else {
        notListedSince = null;
        const { game } = result;
        snapshots++;
        if (snapshots === 1 || snapshots % 25 === 0 || game.gameStatus === 3) {
          console.log(
            `[game-night] #${snapshots} ${game.gameStatusText} ` +
              `${game.awayTeam.teamTricode} ${game.awayTeam.score} @ ${game.homeTeam.teamTricode} ${game.homeTeam.score}` +
              (game.gameStatus === 2 ? ` (Q${game.period} ${parseNBAClock(game.gameClock)})` : '')
          );
        }
        if (game.gameStatus === 3) {
          console.log('[game-night] Final. Finalizing…');
          try {
            await finalizeGame(candidate.game_id, game.gameId);
            await sql`
              INSERT INTO app_kv (key, value, updated_at)
              VALUES ('pipeline:last_sync_at', ${sql.json(new Date().toISOString())}, now())
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
            `;
            console.log('[game-night] Finalization complete.');
            // Play-by-play → game flow / period / clutch tables, so postgame
            // insights can run minutes after the buzzer. Non-fatal: the nightly
            // pipeline picks up any game without a game_flow row.
            try {
              const r = await ingestGamePbp(candidate.game_id);
              console.log(`[game-night] Play-by-play: ${r.status === 'ok' ? `${r.events} events` : 'not available yet'}`);
            } catch (err) {
              console.error(`[game-night] Play-by-play ingest failed: ${(err as Error).message}`);
            }
          } catch (err) {
            // The nightly post-game pipeline retries games without box scores.
            console.error(`[game-night] Finalization failed: ${(err as Error).message}`);
            process.exitCode = 1;
          }
          return;
        }
        // Pre-game: poll gently until tip.
        if (game.gameStatus === 1) delay = 60_000;
      }
    } catch (err) {
      failures++;
      delay = calculateBackoff(failures, POLL_INTERVAL_MS);
      console.warn(`[game-night] Poll failed (${failures}x): ${(err as Error).message}. Retry in ${delay}ms`);
    }
    await sleep(delay);
  }
  console.warn('[game-night] Max runtime reached; the next hourly launch continues.');
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .catch(async (err) => {
    console.error('[game-night] Failed:', err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
