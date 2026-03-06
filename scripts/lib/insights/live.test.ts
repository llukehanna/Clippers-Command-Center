import { describe, it, expect } from 'vitest';
import {
  generateLiveInsights,
  detectScoringRun,
  isClutchSituation,
  parseClockSeconds,
} from '../../../src/lib/insights/live.js';
import type {
  LiveSnapshot,
  ScoringEvent,
  RollingContext,
} from '../../../src/lib/insights/live.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<LiveSnapshot> = {}): LiveSnapshot {
  return {
    game_id: 'game-1',
    period: 2,
    clock: '8:00',
    home_score: 55,
    away_score: 50,
    home_team_id: 'team-A',
    away_team_id: 'team-B',
    recent_scoring: [],
    ...overrides,
  };
}

const emptyRolling: RollingContext = {
  home_rolling_10: null,
  away_rolling_10: null,
};

// ---------------------------------------------------------------------------
// detectScoringRun
// ---------------------------------------------------------------------------

describe('detectScoringRun', () => {
  it('returns null for empty events array', () => {
    expect(detectScoringRun([])).toBeNull();
  });

  it('returns run when team A scores 8 consecutive points', () => {
    const events: ScoringEvent[] = [
      { team_id: 'A', points: 2, event_time_seconds: 10 },
      { team_id: 'A', points: 6, event_time_seconds: 20 },
    ];
    const run = detectScoringRun(events);
    expect(run).not.toBeNull();
    expect(run!.team_id).toBe('A');
    expect(run!.points).toBe(8);
  });

  it('handles interleaved events — picks best separate run', () => {
    // A scores 4, then B scores 2, then A scores 10 → best run = A 10
    const events: ScoringEvent[] = [
      { team_id: 'A', points: 4, event_time_seconds: 10 },
      { team_id: 'B', points: 2, event_time_seconds: 20 },
      { team_id: 'A', points: 10, event_time_seconds: 30 },
    ];
    const run = detectScoringRun(events);
    expect(run).not.toBeNull();
    expect(run!.team_id).toBe('A');
    expect(run!.points).toBe(10);
  });

  it('does not trigger for a run of 7 points (below 8 threshold)', () => {
    const events: ScoringEvent[] = [
      { team_id: 'A', points: 3, event_time_seconds: 10 },
      { team_id: 'A', points: 4, event_time_seconds: 20 },
    ];
    const run = detectScoringRun(events);
    expect(run).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isClutchSituation
// ---------------------------------------------------------------------------

describe('isClutchSituation', () => {
  it('returns false for period 3 (not Q4/OT)', () => {
    const snap = makeSnapshot({ period: 3, clock: '4:00', home_score: 80, away_score: 78 });
    expect(isClutchSituation(snap)).toBe(false);
  });

  it('returns false for period 4, clock 5:01, margin 5 (clock > 5:00)', () => {
    const snap = makeSnapshot({ period: 4, clock: '5:01', home_score: 90, away_score: 85 });
    expect(isClutchSituation(snap)).toBe(false);
  });

  it('returns false for period 4, clock 4:00, margin 9 (margin > 8)', () => {
    const snap = makeSnapshot({ period: 4, clock: '4:00', home_score: 90, away_score: 81 });
    expect(isClutchSituation(snap)).toBe(false);
  });

  it('returns true for period 4, clock 4:00, margin 8 (exactly on boundary)', () => {
    const snap = makeSnapshot({ period: 4, clock: '4:00', home_score: 90, away_score: 82 });
    expect(isClutchSituation(snap)).toBe(true);
  });

  it('returns true for OT (period 5), clock 1:30, margin 3', () => {
    const snap = makeSnapshot({ period: 5, clock: '1:30', home_score: 105, away_score: 102 });
    expect(isClutchSituation(snap)).toBe(true);
  });

  it('returns true for period 4, clock 5:00 exactly, margin 0', () => {
    const snap = makeSnapshot({ period: 4, clock: '5:00', home_score: 88, away_score: 88 });
    expect(isClutchSituation(snap)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateLiveInsights
// ---------------------------------------------------------------------------

describe('generateLiveInsights', () => {
  it('returns empty array when no conditions are met', () => {
    const snap = makeSnapshot({
      period: 2,
      clock: '8:00',
      home_score: 55,
      away_score: 50,
      recent_scoring: [],
    });
    const results = generateLiveInsights(snap, emptyRolling);
    expect(results).toEqual([]);
  });

  it('returns a run insight when scoring run >= 8 detected', () => {
    const events: ScoringEvent[] = [
      { team_id: 'team-A', points: 3, event_time_seconds: 100 },
      { team_id: 'team-A', points: 5, event_time_seconds: 110 },
    ];
    const snap = makeSnapshot({
      period: 2,
      clock: '8:00',
      home_score: 55,
      away_score: 50,
      recent_scoring: events,
    });
    const results = generateLiveInsights(snap, emptyRolling);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const runInsight = results.find((r) => r.category === 'run');
    expect(runInsight).toBeDefined();
    expect(runInsight!.headline).toContain('8');
  });

  it('returns a clutch insight when clutch situation detected', () => {
    const snap = makeSnapshot({
      period: 4,
      clock: '2:30',
      home_score: 98,
      away_score: 95,
      recent_scoring: [],
    });
    const results = generateLiveInsights(snap, emptyRolling);
    const clutchInsight = results.find((r) => r.category === 'clutch');
    expect(clutchInsight).toBeDefined();
    expect(clutchInsight!.importance).toBeGreaterThan(0);
  });

  it('returns both run and clutch insights when both conditions met', () => {
    const events: ScoringEvent[] = [
      { team_id: 'team-A', points: 4, event_time_seconds: 100 },
      { team_id: 'team-A', points: 6, event_time_seconds: 110 },
    ];
    const snap = makeSnapshot({
      period: 4,
      clock: '3:00',
      home_score: 98,
      away_score: 94,
      recent_scoring: events,
    });
    const results = generateLiveInsights(snap, emptyRolling);
    expect(results.some((r) => r.category === 'run')).toBe(true);
    expect(results.some((r) => r.category === 'clutch')).toBe(true);
  });

  it('never throws — returns empty array for invalid/edge inputs', () => {
    // Minimal snapshot with no scoring events
    const snap = makeSnapshot({ recent_scoring: [] });
    expect(() => generateLiveInsights(snap, emptyRolling)).not.toThrow();
    const results = generateLiveInsights(snap, emptyRolling);
    expect(Array.isArray(results)).toBe(true);
  });

  it('proof_sql in run insight uses parameterized $1/$2 placeholders', () => {
    const events: ScoringEvent[] = [
      { team_id: 'team-A', points: 8, event_time_seconds: 100 },
    ];
    const snap = makeSnapshot({ recent_scoring: events });
    const results = generateLiveInsights(snap, emptyRolling);
    const runInsight = results.find((r) => r.category === 'run');
    expect(runInsight).toBeDefined();
    expect(runInsight!.proof_sql).toMatch(/\$1/);
  });

  it('proof_sql in clutch insight uses parameterized $1 placeholder', () => {
    const snap = makeSnapshot({
      period: 4,
      clock: '1:00',
      home_score: 100,
      away_score: 97,
      recent_scoring: [],
    });
    const results = generateLiveInsights(snap, emptyRolling);
    const clutchInsight = results.find((r) => r.category === 'clutch');
    expect(clutchInsight).toBeDefined();
    expect(clutchInsight!.proof_sql).toMatch(/\$1/);
  });

  it('proof_result in clutch insight contains period, clock, home_score, away_score, margin', () => {
    const snap = makeSnapshot({
      period: 4,
      clock: '1:00',
      home_score: 100,
      away_score: 97,
      recent_scoring: [],
    });
    const results = generateLiveInsights(snap, emptyRolling);
    const clutchInsight = results.find((r) => r.category === 'clutch');
    expect(clutchInsight).toBeDefined();
    const proofRow = clutchInsight!.proof_result[0] as Record<string, unknown>;
    expect(proofRow).toHaveProperty('period', 4);
    expect(proofRow).toHaveProperty('clock', '1:00');
    expect(proofRow).toHaveProperty('home_score', 100);
    expect(proofRow).toHaveProperty('away_score', 97);
    expect(proofRow).toHaveProperty('margin', 3);
  });
});

// ---------------------------------------------------------------------------
// parseClockSeconds (helper)
// ---------------------------------------------------------------------------

describe('parseClockSeconds', () => {
  it('parses "5:00" as 300 seconds', () => {
    expect(parseClockSeconds('5:00')).toBe(300);
  });

  it('parses "1:30" as 90 seconds', () => {
    expect(parseClockSeconds('1:30')).toBe(90);
  });

  it('parses "0:00" as 0 seconds', () => {
    expect(parseClockSeconds('0:00')).toBe(0);
  });

  it('parses "12:00" as 720 seconds', () => {
    expect(parseClockSeconds('12:00')).toBe(720);
  });
});
