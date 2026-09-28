import { describe, it, expect } from 'vitest';
import { decideGameNightAction, FINAL_SAVE_MAX_ATTEMPTS, type GameNightTick } from './game-night-logic.js';

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
