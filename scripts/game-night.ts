// scripts/game-night.ts
// Game-night live runner, launched hourly by .github/workflows/game-night.yml.
//
// 1. Looks for a Clippers game that isn't final and tips within the next
//    LEAD_MINUTES (or tipped in the last 4 hours). None → exits in seconds.
//    The lead is long because GitHub drops scheduled runs at busy times —
//    whole evenings of the hourly cron have gone missing — so any launch that
//    does fire in the hours before tip catches the game and sleeps until then.
// 2. Sleeps until ~10 minutes before tip, then polls with the adaptive cadence
//    in scripts/lib/live-cadence.ts (2–30 s by game phase) via
//    scripts/lib/live-poller.ts, writing live_state on every change.
// 3. When the scoreboard says Final, finalizes the game (box scores, stints,
//    advanced stats), asks the workflow to start the post-game pipeline
//    (league sync, stats, insights — postgame=true in $GITHUB_OUTPUT; its
//    nightly cron runs hours late) and exits. Preseason games (all_games.is_preseason)
//    are polled the same way but never finalized: they don't count anywhere.
//
// Overlapping hourly launches are serialized by the workflow's concurrency
// group, so a later launch just finds the game already final and exits. A run
// that hits its time limit mid-game asks the workflow for a successor
// (continue=true in $GITHUB_OUTPUT) rather than trusting the next hourly cron.
// So does a run that sees new runner code on main (mainHasNewRunnerCode, checked
// every 2 minutes while sleeping and polling), so a fix merged during a game
// reaches it within minutes.

import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';

import { sql } from './lib/db.js';
import { findLiveCandidates, type LiveCandidate } from './lib/live-cycle.js';
import { createPoller } from './lib/live-poller.js';
import { nbaPollerDeps } from './lib/live-deps.js';
import type { Publisher } from './lib/live-publish.js';
import { loadLiveSeq, loadModelContext } from './lib/live-store.js';
import { finalizeGame } from './lib/finalize.js';
import {
  CODE_CHECK_MS,
  decideGameNightAction,
  FINAL_SAVE_MAX_ATTEMPTS,
  mainHasNewRunnerCode,
} from './lib/game-night-logic.js';
import { ingestGamePbp } from './lib/pbp/ingest.js';

const LEAD_MINUTES = Number(process.env.GAME_NIGHT_LEAD_MINUTES ?? 300);
const PRE_TIP_MS = 10 * 60_000;
// Stop before the workflow's timeout so the job ends cleanly; a successor run
// picks the game back up (see requestSuccessor).
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

/** Set a step output for the workflow (no-op outside GitHub Actions). */
function setOutput(key: 'continue' | 'postgame'): void {
  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, `${key}=true\n`);
}

/** Tell the workflow to dispatch another run that continues this game. */
const requestSuccessor = () => setOutput('continue');

const git = (args: string[]) =>
  new Promise<number>((resolve) => {
    execFile('git', args, { timeout: 30_000 }, (err) => resolve(err ? (typeof err.code === 'number' ? err.code : -1) : 0));
  });

/** True (and a successor requested) when main has runner code this run lacks. Only on a main run in Actions. */
async function handOffIfMainMoved(): Promise<boolean> {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF_NAME !== 'main') return false;
  if (!(await mainHasNewRunnerCode(git))) return false;
  console.warn('[game-night] main has new runner code; handing the game to a successor run on it.');
  requestSuccessor();
  return true;
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
      for (let left = wait; left > 0; left = tip.getTime() - PRE_TIP_MS - Date.now()) {
        await sleep(Math.min(left, CODE_CHECK_MS));
        if (await handOffIfMainMoved()) return;
      }
    }
  }

  await pollLoop(candidate, tip);
}

async function pollLoop(candidate: LiveCandidate, tip: Date | null): Promise<void> {
  const initialSeq = await loadLiveSeq(sql, candidate.game_id);
  const deps = nbaPollerDeps(sql, candidate.game_id, candidate.nba_game_id);
  // Best-effort: without it the runner uses home court and the default σ.
  const model = await loadModelContext(sql, candidate.game_id).catch((err: unknown) => {
    console.warn(`[game-night] Model inputs unavailable, using defaults: ${(err as Error).message}`);
    return null;
  });
  if (model) {
    console.log(
      `[game-night] Win prob: E ${model.expected} (${model.expectedSource}), σ ${model.sigma}` +
        `${model.calibration ? '' : ' (default)'}; usual minutes for ${Object.keys(model.usualMin).length} players`
    );
  }
  const poller = createPoller(candidate.nba_game_id, tip?.getTime() ?? null, deps, initialSeq, model ?? undefined);
  let notListedSince: number | null = null;
  let saves = 0;
  let finalAttempts = 0;

  let codeCheckedAt = Date.now();
  while (Date.now() - startedAt < MAX_RUNTIME_MS) {
    if (Date.now() - codeCheckedAt >= CODE_CHECK_MS) {
      codeCheckedAt = Date.now();
      if (await handOffIfMainMoved()) {
        await flushHub(deps.hub);
        return;
      }
    }
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
      // Preseason games are live-page only: no box scores, play-by-play or
      // stats (live_state already marked the all_games row final).
      if (candidate.is_preseason) {
        console.log('[game-night] Final (preseason). Nothing to finalize.');
        await flushHub(deps.hub);
        return;
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
        setOutput('postgame');
        // Play-by-play → game flow / period / clutch tables, so postgame
        // insights can run minutes after the buzzer. Non-fatal: the nightly
        // pipeline picks up any game without a game_flow row.
        try {
          const pbp = await ingestGamePbp(candidate.game_id);
          const detail = pbp.status === 'ok'
            ? `${pbp.events} events`
            : pbp.status === 'incomplete'
              ? `feed incomplete (${pbp.got.home}-${pbp.got.away}, final ${pbp.expected.home}-${pbp.expected.away}); not written`
              : 'not available yet';
          console.log(`[game-night] Play-by-play: ${detail}`);
        } catch (err) {
          console.error(`[game-night] Play-by-play ingest failed: ${(err as Error).message}`);
        }
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
  console.warn('[game-night] Max runtime reached; a successor run continues the game.');
  requestSuccessor();
  await flushHub(deps.hub);
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .catch(async (err) => {
    console.error('[game-night] Failed:', err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
