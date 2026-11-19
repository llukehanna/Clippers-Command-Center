import { describe, it, expect, vi } from 'vitest';
import {
  decideGameNightAction,
  FINALIZE_RETRY_MS,
  finalizeRetryDelay,
  FINAL_SAVE_MAX_ATTEMPTS,
  mainHasNewRunnerCode,
  handOffMomentOk,
  pregameRefreshDue,
  PREGAME_REFRESH_LEAD_MS,
  shouldRunPregame,
  HAND_OFF_FAILURES,
  RUNNER_CODE_PATHS,
  type GameNightTick,
} from './game-night-logic.js';

function tick(over: Partial<GameNightTick> = {}): GameNightTick {
  return { final: false, saved: false, hasDoc: true, delayMs: 3_000, ...over };
}

describe('decideGameNightAction', () => {
  it('keeps polling at the tick delay when not final', () => {
    const d = decideGameNightAction(tick({ final: false, delayMs: 3_000 }), 0);
    expect(d).toEqual({ action: { type: 'continue', sleepMs: 3_000 }, finalAttempts: 0 });
  });

  it('resets the attempt counter on a non-final tick even after prior final-but-unsaved attempts', () => {
    const d = decideGameNightAction(tick({ final: false }), 4);
    expect(d.finalAttempts).toBe(0);
  });

  it('finalizes immediately when the final tick saved', () => {
    const d = decideGameNightAction(tick({ final: true, saved: true, hasDoc: true, delayMs: 0 }), 0);
    expect(d.action).toEqual({ type: 'finalize', forced: false });
  });

  it('does NOT finalize when the final tick failed to save — it keeps ticking instead', () => {
    const d = decideGameNightAction(tick({ final: true, saved: false, hasDoc: true, delayMs: 0 }), 0);
    expect(d.action.type).toBe('continue');
  });

  it('floors the retry delay so a 0 ms FINAL phase delay never sleeps 0', () => {
    const d = decideGameNightAction(tick({ final: true, saved: false, hasDoc: true, delayMs: 0 }), 0);
    expect(d.action).toEqual({ type: 'continue', sleepMs: 3_000 });
  });

  it('uses the tick delay when it is already above the floor', () => {
    const d = decideGameNightAction(tick({ final: true, saved: false, hasDoc: true, delayMs: 8_000 }), 0);
    expect(d.action).toEqual({ type: 'continue', sleepMs: 8_000 });
  });

  it('increments the attempt count on each unsaved final tick', () => {
    let attempts = 0;
    for (let i = 1; i <= 3; i++) {
      const d = decideGameNightAction(tick({ final: true, saved: false, hasDoc: true }), attempts);
      expect(d.finalAttempts).toBe(i);
      attempts = d.finalAttempts;
    }
  });

  it('finalizes anyway (forced) once the attempt bound is reached, so the game still gets its box scores', () => {
    const d = decideGameNightAction(
      tick({ final: true, saved: false, hasDoc: true }),
      FINAL_SAVE_MAX_ATTEMPTS - 1
    );
    expect(d.action).toEqual({ type: 'finalize', forced: true });
    expect(d.finalAttempts).toBe(FINAL_SAVE_MAX_ATTEMPTS);
  });

  it('does not finalize one attempt short of the bound', () => {
    const d = decideGameNightAction(
      tick({ final: true, saved: false, hasDoc: true }),
      FINAL_SAVE_MAX_ATTEMPTS - 2
    );
    expect(d.action.type).toBe('continue');
  });

  it('treats a final tick with no doc yet as not-final (defensive: keeps ticking, resets attempts)', () => {
    const d = decideGameNightAction(tick({ final: true, hasDoc: false, delayMs: 0 }), 2);
    expect(d).toEqual({ action: { type: 'continue', sleepMs: 0 }, finalAttempts: 0 });
  });
});

describe('mainHasNewRunnerCode', () => {
  const git = (fetch: number, diff: number) =>
    vi.fn(async (args: string[]) => (args[0] === 'fetch' ? fetch : diff));

  it('is true when the runner paths differ from origin/main', async () => {
    const g = git(0, 1);
    expect(await mainHasNewRunnerCode(g)).toBe(true);
    expect(g).toHaveBeenLastCalledWith(['diff', '--quiet', 'HEAD', 'FETCH_HEAD', '--', ...RUNNER_CODE_PATHS]);
  });

  it('is false when nothing the runner uses changed', async () => {
    expect(await mainHasNewRunnerCode(git(0, 0))).toBe(false);
  });

  it('is false when the fetch fails, without diffing', async () => {
    const g = git(128, 1);
    expect(await mainHasNewRunnerCode(g)).toBe(false);
    expect(g).toHaveBeenCalledTimes(1);
  });
});

describe('finalizeRetryDelay', () => {
  const MAX = 330 * 60_000;

  it('waits 15 minutes while the run has time for another attempt', () => {
    expect(finalizeRetryDelay(180 * 60_000, MAX)).toBe(FINALIZE_RETRY_MS);
    expect(finalizeRetryDelay(MAX - 20 * 60_000, MAX)).toBe(FINALIZE_RETRY_MS);
  });

  it('gives up when an attempt plus the shutdown margin would not fit', () => {
    expect(finalizeRetryDelay(MAX - 19 * 60_000, MAX)).toBeNull();
    expect(finalizeRetryDelay(MAX, MAX)).toBeNull();
  });
});

describe('handOffMomentOk', () => {
  it('waits for a break in play mid-game', () => {
    expect(handOffMomentOk('LIVE', 0)).toBe(false);
    expect(handOffMomentOk('CLUTCH', 0)).toBe(false);
    expect(handOffMomentOk('TIP_WATCH', 0)).toBe(false);
    expect(handOffMomentOk('HALFTIME', 0)).toBe(true);
    expect(handOffMomentOk('STOPPAGE', 0)).toBe(true);
    expect(handOffMomentOk('PREGAME', 0)).toBe(true);
    expect(handOffMomentOk(null, 0)).toBe(true); // game not on the scoreboard
  });

  it('hands off at once when the runner keeps failing, not on one blip', () => {
    expect(handOffMomentOk('LIVE', 1)).toBe(false);
    expect(handOffMomentOk('LIVE', HAND_OFF_FAILURES)).toBe(true);
  });
});

describe('pregameRefreshDue', () => {
  const tip = Date.UTC(2026, 10, 19, 3, 30);
  const at = tip - PREGAME_REFRESH_LEAD_MS;
  it('fires once when the sleep passes tip − 75 min after an earlier run', () => {
    expect(pregameRefreshDue(at - 60_000, tip, at - 4 * 3600_000)).toBe(false);
    expect(pregameRefreshDue(at + 60_000, tip, at - 4 * 3600_000)).toBe(true);
    expect(pregameRefreshDue(at + 120_000, tip, at + 60_000)).toBe(false);
  });
  it('does not fire when the run started inside the window, after tip, or without a tip', () => {
    expect(pregameRefreshDue(at + 60_000, tip, at + 30_000)).toBe(false);
    expect(pregameRefreshDue(tip + 60_000, tip, at - 3600_000)).toBe(false);
    expect(pregameRefreshDue(at + 60_000, null, at - 3600_000)).toBe(false);
    expect(pregameRefreshDue(at + 60_000, tip, null)).toBe(false);
  });
});

describe('shouldRunPregame', () => {
  const tip = Date.UTC(2026, 10, 19, 3, 30);
  it('runs before tip for a regular-season (or unknown-tip) game', () => {
    expect(shouldRunPregame({ isPreseason: false }, tip, tip - 3600_000)).toBe(true);
    expect(shouldRunPregame({ isPreseason: false }, null, tip)).toBe(true);
  });
  it('never runs for a preseason game', () => {
    expect(shouldRunPregame({ isPreseason: true }, tip, tip - 3600_000)).toBe(false);
    expect(shouldRunPregame({ isPreseason: true }, null, tip)).toBe(false);
  });
  it('does not run once tip has passed (a mid-game successor or hand-off launch)', () => {
    expect(shouldRunPregame({ isPreseason: false }, tip, tip)).toBe(false);
    expect(shouldRunPregame({ isPreseason: false }, tip, tip + 90 * 60_000)).toBe(false);
  });
});
