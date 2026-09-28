// scripts/game-night.ts
// Game-night live runner, launched hourly by .github/workflows/game-night.yml.
//
// 1. Looks for a Clippers game that isn't final and tips within the next
//    LEAD_MINUTES (or tipped in the last 4 hours). None → exits in seconds.
// 2. Sleeps until ~10 minutes before tip, then polls with the adaptive cadence
//    in scripts/lib/live-cadence.ts (2–30 s by game phase) via
//    scripts/lib/live-poller.ts, writing live_state on every change.
// 3. When the scoreboard says Final, finalizes the game (box scores, stints,
//    advanced stats) and exits. The nightly post-game workflow still runs the
//    league sync, stats and insights.
//
// Overlapping hourly launches are serialized by the workflow's concurrency
// group, so a later launch just finds the game already final and exits.

import { sql } from './lib/db.js';
import { findLiveCandidates, type LiveCandidate } from './lib/live-cycle.js';
import { createPoller } from './lib/live-poller.js';
import { nbaPollerDeps } from './lib/live-deps.js';
import type { Publisher } from './lib/live-publish.js';
import { loadLiveSeq } from './lib/live-store.js';
import { finalizeGame } from './lib/finalize.js';
import { decideGameNightAction, FINAL_SAVE_MAX_ATTEMPTS } from './lib/game-night-logic.js';

const LEAD_MINUTES = Number(process.env.GAME_NIGHT_LEAD_MINUTES ?? 75);
const PRE_TIP_MS = 10 * 60_000;
// Stop before the workflow's timeout so the job ends cleanly (the next hourly
// launch picks the game back up if it's somehow still going).
const MAX_RUNTIME_MS = Number(process.env.GAME_NIGHT_MAX_MINUTES ?? 330) * 60_000;
// Scoreboard hasn't listed the game for this long after tip → give up.
const NOT_LISTED_GIVE_UP_MS = 30 * 60_000;

const startedAt = Date.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Best-effort: give a queued hub publish a chance to go out before the
// process exits, but never let a stuck hub delay shutdown indefinitely.
async function flushHub(hub: Publisher | null): Promise<void> {
  if (!hub) return;
  await Promise.race([hub.flush(), sleep(5_000)]);
}

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
  const initialSeq = await loadLiveSeq(sql, candidate.game_id);
  const deps = nbaPollerDeps(sql, candidate.game_id, candidate.nba_game_id);
  const poller = createPoller(candidate.nba_game_id, tip?.getTime() ?? null, deps, initialSeq);
  let notListedSince: number | null = null;
  let saves = 0;
  let finalAttempts = 0;

  while (Date.now() - startedAt < MAX_RUNTIME_MS) {
    const r = await poller.tick();

    if (r.status === 'not_on_scoreboard') {
      // The CDN scoreboard rolls over mid-morning ET; before tip the game can
      // legitimately be missing for a while. Long after tip, stop.
      notListedSince ??= Date.now();
      const pastTip = !tip || Date.now() > tip.getTime();
      if (pastTip && Date.now() - notListedSince > NOT_LISTED_GIVE_UP_MS) {
        console.warn('[game-night] Game not on the scoreboard for 30 min after tip. Stopping.');
        await flushHub(deps.hub);
        return;
      }
    } else if (r.status === 'ok') {
      notListedSince = null;
    }

    if (r.saved && r.doc) {
      saves++;
      if (saves === 1 || saves % 50 === 0 || r.final) {
        const d = r.doc;
        console.log(
          `[game-night] seq ${d.seq} ${d.status_text} ${d.away_score}-${d.home_score} ` +
            `Q${d.period} ${d.clock} · ${r.phase} next ${r.delayMs}ms`
        );
      }
    }

    // Only finalize on a FINAL tick whose save actually succeeded (or after
    // FINAL_SAVE_MAX_ATTEMPTS unsaved final ticks) — otherwise live_state would
    // be left on the pre-buzzer doc. See scripts/lib/game-night-logic.ts.
    const decision = decideGameNightAction(
      { final: r.final, saved: r.saved, hasDoc: r.doc !== null, delayMs: r.delayMs },
      finalAttempts
    );
    finalAttempts = decision.finalAttempts;

    if (decision.action.type === 'finalize') {
      // Guaranteed by decideGameNightAction: it only returns 'finalize' when hasDoc was true.
      const finalDoc = r.doc!;
      if (decision.action.forced) {
        console.warn(
          `[game-night] Final tick's save never succeeded after ${finalAttempts} attempts; finalizing anyway.`
        );
      }
      console.log('[game-night] Final. Finalizing…');
      try {
        await finalizeGame(candidate.game_id, finalDoc.nba_game_id);
        await sql`
          INSERT INTO app_kv (key, value, updated_at)
          VALUES ('pipeline:last_sync_at', ${sql.json(new Date().toISOString())}, now())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
        `;
        console.log('[game-night] Finalization complete.');
      } catch (err) {
        // The nightly post-game pipeline retries games without box scores.
        console.error(`[game-night] Finalization failed: ${(err as Error).message}`);
        process.exitCode = 1;
      }
      await flushHub(deps.hub);
      return;
    }

    if (r.final) {
      console.warn(
        `[game-night] Final tick's save failed (attempt ${finalAttempts}/${FINAL_SAVE_MAX_ATTEMPTS}); ` +
          `retrying in ${decision.action.sleepMs}ms.`
      );
    }

    await sleep(decision.action.sleepMs);
  }
  console.warn('[game-night] Max runtime reached; the next hourly launch continues.');
  await flushHub(deps.hub);
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .catch(async (err) => {
    console.error('[game-night] Failed:', err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
