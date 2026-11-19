// scripts/lib/insights/engine/run-frame.test.ts
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../db', () => ({ sql: {} }));
import { STREAKS, TEAM_STREAK_MIN, streakMinGames } from './detectors/season-streaks';
import { finalFrame } from './run';

describe('finalFrame', () => {
  it('stamps the context line plus the fact stat and value', () => {
    const out = finalFrame({ type: 'first_since', strength: 0.5, who: 'subject', text: '', proof_rows: [] }, 'ctx', { stat: 'ast', value: 8 });
    expect(out).toMatchObject({ text: 'ctx', stat: 'ast', value: 8 });
  });
});

describe('streak floors (Q6)', () => {
  it('every streak needs at least 5 games', () => {
    expect(STREAKS.every((d) => streakMinGames(d) >= 5)).toBe(true);
  });
  it('team streaks need at least 5 games', () => {
    expect(Object.values(TEAM_STREAK_MIN).every((n) => n >= 5)).toBe(true);
  });
});
