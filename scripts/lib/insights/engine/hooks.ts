// scripts/lib/insights/engine/hooks.ts
// The game-night runner's insight hooks (spec §5.1): postgame insights minutes
// after the final buzzer, pregame insights when the runner starts and again
// ~75 min before tip. In-process runEngine calls that never throw and never
// hang — a failure or timeout is reported and the live runner carries on (the
// nightly pipeline re-runs both).
//
// runEngine's hardening rejects a gameId run on any surface but postgame, so
// postgameAtFinal passes gameId with ['postgame'] only, and pregameAtStart
// never passes a gameId.
import { laToday } from './dates.js';
import { runEngine } from './run.js';

export interface HookResult { status: 'ok' | 'skipped' | 'failed'; upserted: number; message: string }

/** A hook that has not finished by now is abandoned (a stuck query must not hold the runner). */
export const HOOK_TIMEOUT_MS = 5 * 60_000;

async function safely(label: string, fn: () => Promise<HookResult>, ms = HOOK_TIMEOUT_MS): Promise<HookResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<HookResult>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms / 60_000} min`)), ms);
      }),
    ]);
  } catch (err) {
    return { status: 'failed', upserted: 0, message: `${label} failed: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

export function postgameAtFinal(gameId: string, log: (m: string) => void = () => {}): Promise<HookResult> {
  return safely('postgame insights', async () => {
    const r = await runEngine({ surfaces: ['postgame'], gameId, asOf: laToday(), write: true, log });
    if (!r.context) return { status: 'skipped', upserted: 0, message: 'no Clippers box scores' };
    return { status: 'ok', upserted: r.upserted, message: `${r.upserted} postgame insights for game ${gameId}` };
  });
}

export function pregameAtStart(log: (m: string) => void = () => {}): Promise<HookResult> {
  return safely('pregame insights', async () => {
    const r = await runEngine({ surfaces: ['pregame'], asOf: laToday(), write: true, log });
    if (!r.context) return { status: 'skipped', upserted: 0, message: 'no Clippers box scores' };
    return { status: 'ok', upserted: r.upserted, message: `${r.upserted} pregame insights` };
  });
}

export interface FinalHooks { postgame: HookResult; pregame: HookResult }

/**
 * Everything the runner does for insights at the final buzzer: the game's postgame insights, then a pregame pass
 * so Home and the preview move on to the next game now instead of at the nightly run (FW-11). Each hook keeps its
 * own timeout and never throws; the pregame pass runs even when the postgame one failed. Never for a preseason
 * game, like every runner pregame pass.
 */
export async function insightsAtFinal(gameId: string, opts: { isPreseason: boolean }, log: (m: string) => void = () => {}): Promise<FinalHooks> {
  const postgame = await postgameAtFinal(gameId, log);
  const pregame = opts.isPreseason
    ? { status: 'skipped' as const, upserted: 0, message: 'preseason game' }
    : await pregameAtStart(log);
  return { postgame, pregame };
}
