import { describe, it, expect } from 'vitest';
import { classifyPhase, isPeriodEnd, nextDelayMs, type PhaseInput } from './live-cadence.js';

const NOW = 1_000_000;
const base: PhaseInput = { gameStatus: 2, now: NOW, tipAt: NOW - 60_000, period: 1, clockSec: 600, margin: 0, lastAction: null };
const act = (actionType: string, subType = '', period = 1) => ({ actionType, subType, period });

describe('classifyPhase', () => {
  it('is PREGAME before the scheduled tip and TIP_WATCH after it', () => {
    expect(classifyPhase({ ...base, gameStatus: 1, tipAt: NOW + 60_000 })).toBe('PREGAME');
    expect(classifyPhase({ ...base, gameStatus: 1, tipAt: null })).toBe('PREGAME');
    expect(classifyPhase({ ...base, gameStatus: 1, tipAt: NOW - 1 })).toBe('TIP_WATCH');
  });

  it('is FINAL once the game is final', () => {
    expect(classifyPhase({ ...base, gameStatus: 3 })).toBe('FINAL');
  });

  it('is LIVE on a live-ball action', () => {
    expect(classifyPhase({ ...base, lastAction: act('2pt', 'jumpshot') })).toBe('LIVE');
  });

  it('is STOPPAGE on a timeout, a replay review, or the end of Q1/Q3', () => {
    expect(classifyPhase({ ...base, lastAction: act('timeout', 'full') })).toBe('STOPPAGE');
    expect(classifyPhase({ ...base, lastAction: act('instantreplay', 'request') })).toBe('STOPPAGE');
    expect(classifyPhase({ ...base, clockSec: 0, lastAction: act('period', 'end', 1) })).toBe('STOPPAGE');
    expect(classifyPhase({ ...base, period: 3, clockSec: 0, lastAction: act('period', 'end', 3) })).toBe('STOPPAGE');
  });

  it('is HALFTIME at the end of Q2', () => {
    expect(classifyPhase({ ...base, period: 2, clockSec: 0, lastAction: act('Period', 'End', 2) })).toBe('HALFTIME');
  });

  it('is CLUTCH late in a close game, even during a timeout, but not at the end of a period', () => {
    const late = { ...base, period: 4, clockSec: 240, margin: -7 };
    expect(classifyPhase({ ...late, lastAction: act('3pt', 'jumpshot', 4) })).toBe('CLUTCH');
    expect(classifyPhase({ ...late, lastAction: act('timeout', 'full', 4) })).toBe('CLUTCH');
    expect(classifyPhase({ ...late, clockSec: 0, margin: 0, lastAction: act('period', 'end', 4) })).toBe('STOPPAGE');
    expect(classifyPhase({ ...late, margin: 11, lastAction: act('2pt', '', 4) })).toBe('LIVE');
    expect(classifyPhase({ ...late, clockSec: 301, lastAction: act('2pt', '', 4) })).toBe('LIVE');
    expect(classifyPhase({ ...base, period: 5, clockSec: 300, margin: 0, lastAction: act('period', 'start', 5) })).toBe('CLUTCH');
  });
});

describe('isPeriodEnd', () => {
  it('matches period end case-insensitively', () => {
    expect(isPeriodEnd(act('period', 'end'))).toBe(true);
    expect(isPeriodEnd(act('Period', 'End'))).toBe(true);
    expect(isPeriodEnd(act('period', 'start'))).toBe(false);
    expect(isPeriodEnd(null)).toBe(false);
  });
});

describe('nextDelayMs', () => {
  const d = { phaseSince: NOW, now: NOW, failures: 0, notBeforeMs: 0, random: () => 0.5 };

  it('uses the phase delay', () => {
    expect(nextDelayMs({ ...d, phase: 'PREGAME' })).toBe(30_000);
    expect(nextDelayMs({ ...d, phase: 'TIP_WATCH' })).toBe(10_000);
    expect(nextDelayMs({ ...d, phase: 'LIVE' })).toBe(3_000);
    expect(nextDelayMs({ ...d, phase: 'CLUTCH' })).toBe(2_000);
    expect(nextDelayMs({ ...d, phase: 'STOPPAGE' })).toBe(8_000);
  });

  it('polls slowly for the first 10 minutes of halftime, then every 8 s', () => {
    expect(nextDelayMs({ ...d, phase: 'HALFTIME', now: NOW + 5 * 60_000 })).toBe(30_000);
    expect(nextDelayMs({ ...d, phase: 'HALFTIME', now: NOW + 11 * 60_000 })).toBe(8_000);
  });

  it('never polls before the CDN copy expires, capped at 15 s', () => {
    expect(nextDelayMs({ ...d, phase: 'LIVE', notBeforeMs: NOW + 5_000 })).toBe(5_000);
    expect(nextDelayMs({ ...d, phase: 'LIVE', notBeforeMs: NOW + 900_000 })).toBe(15_000);
    expect(nextDelayMs({ ...d, phase: 'STOPPAGE', notBeforeMs: NOW + 5_000 })).toBe(8_000);
  });

  it('backs off exponentially with ±20 % jitter on failures', () => {
    expect(nextDelayMs({ ...d, phase: 'LIVE', failures: 1 })).toBe(3_000);
    expect(nextDelayMs({ ...d, phase: 'LIVE', failures: 2 })).toBe(6_000);
    expect(nextDelayMs({ ...d, phase: 'LIVE', failures: 5 })).toBe(48_000);
    expect(nextDelayMs({ ...d, phase: 'LIVE', failures: 9 })).toBe(60_000);
    expect(nextDelayMs({ ...d, phase: 'LIVE', failures: 1, random: () => 0 })).toBe(2_400);
    expect(nextDelayMs({ ...d, phase: 'LIVE', failures: 1, random: () => 1 })).toBe(3_600);
  });
});
