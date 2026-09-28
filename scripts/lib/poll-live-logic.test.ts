import { vi, describe, it, expect } from 'vitest';
import {
  calculateBackoff,
  isClippersGame,
  findClippersGame,
  gameStatusLabel,
  runPollCycle,
  matchScoreboardGame,
  gameElapsedSeconds,
  extractRecentScoring,
  summarizeOtherGames,
  lineScore,
} from './poll-live-logic.js';
import type { ScoreboardGame } from '../../src/lib/types/live.js';

// ── Helper factory for minimal ScoreboardGame objects ─────────────────────────

function makeGame(homeTeamId: number, awayTeamId: number): ScoreboardGame {
  return {
    gameId: '0022400001',
    gameCode: 'TEST',
    gameStatus: 2,
    gameStatusText: 'In Progress',
    period: 3,
    gameClock: 'PT04M32.00S',
    gameTimeUTC: '2026-03-06T00:00:00Z',
    homeTeam: {
      teamId: homeTeamId,
      teamName: 'Test',
      teamCity: 'Test',
      teamTricode: 'TST',
      wins: 30,
      losses: 20,
      score: 90,
      periods: [],
      timeoutsRemaining: 3,
      inBonus: '0',
    },
    awayTeam: {
      teamId: awayTeamId,
      teamName: 'Test',
      teamCity: 'Test',
      teamTricode: 'TST',
      wins: 25,
      losses: 25,
      score: 85,
      periods: [],
      timeoutsRemaining: 2,
      inBonus: '0',
    },
  };
}

const LAC_TEAM_ID = 1610612746;

// ── calculateBackoff ──────────────────────────────────────────────────────────

describe('calculateBackoff', () => {
  it('returns baseMs unchanged when failureCount is 0', () => {
    expect(calculateBackoff(0, 12_000)).toBe(12_000);
  });

  it('doubles on first failure', () => {
    expect(calculateBackoff(1, 12_000)).toBe(24_000);
  });

  it('doubles again on second failure', () => {
    expect(calculateBackoff(2, 12_000)).toBe(48_000);
  });

  it('caps at 60 seconds on third failure', () => {
    expect(calculateBackoff(3, 12_000)).toBe(60_000);
  });

  it('remains capped at 60 seconds for high failure counts', () => {
    expect(calculateBackoff(10, 12_000)).toBe(60_000);
  });
});

// ── isClippersGame ────────────────────────────────────────────────────────────

describe('isClippersGame', () => {
  it('returns true when LAC is the home team', () => {
    const game = makeGame(LAC_TEAM_ID, 99);
    expect(isClippersGame(game)).toBe(true);
  });

  it('returns true when LAC is the away team', () => {
    const game = makeGame(99, LAC_TEAM_ID);
    expect(isClippersGame(game)).toBe(true);
  });

  it('returns false when neither team is LAC', () => {
    const game = makeGame(99, 88);
    expect(isClippersGame(game)).toBe(false);
  });
});

// ── findClippersGame ──────────────────────────────────────────────────────────

describe('findClippersGame', () => {
  it('returns the matching game when LAC is present', () => {
    const lacGame = makeGame(LAC_TEAM_ID, 99);
    const otherGame = makeGame(88, 77);
    const result = findClippersGame([otherGame, lacGame]);
    expect(result).toBe(lacGame);
  });

  it('returns null for an empty array', () => {
    expect(findClippersGame([])).toBeNull();
  });

  it('returns null when no LAC game is present', () => {
    const games = [makeGame(88, 77), makeGame(66, 55)];
    expect(findClippersGame(games)).toBeNull();
  });

  it('returns first match when multiple LAC games exist (edge case)', () => {
    const lacGame1 = makeGame(LAC_TEAM_ID, 99);
    const lacGame2 = makeGame(88, LAC_TEAM_ID);
    const result = findClippersGame([lacGame1, lacGame2]);
    expect(result).toBe(lacGame1);
  });
});

// ── gameStatusLabel ───────────────────────────────────────────────────────────

describe('gameStatusLabel', () => {
  it('returns PRE for status 1 (scheduled)', () => {
    expect(gameStatusLabel(1)).toBe('PRE');
  });

  it('returns LIVE for status 2 (in progress)', () => {
    expect(gameStatusLabel(2)).toBe('LIVE');
  });

  it('returns FINAL for status 3 (final)', () => {
    expect(gameStatusLabel(3)).toBe('FINAL');
  });

  it('returns UNKNOWN for unrecognized status', () => {
    expect(gameStatusLabel(99)).toBe('UNKNOWN');
  });
});

// ── polling daemon failure counter ────────────────────────────────────────────

describe('polling daemon failure counter', () => {
  it('increments failureCount on consecutive failures', async () => {
    // Mock fetchScoreboard to throw on every call
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockRejectedValueOnce(new Error('network timeout'));

    const deps = { fetchScoreboard: mockFetch as unknown as () => ReturnType<typeof import('./nba-live-client.js').fetchScoreboard> };

    // First failure: 0 → 1
    const count1 = await runPollCycle(0, deps);
    expect(count1).toBe(1);

    // Second consecutive failure: 1 → 2
    const count2 = await runPollCycle(count1, deps);
    expect(count2).toBe(2);

    // Backoff for second failure must be larger than for first (RELY-02 math check)
    const backoff1 = calculateBackoff(count1, 12_000);
    const backoff2 = calculateBackoff(count2, 12_000);
    expect(backoff2).toBeGreaterThan(backoff1);
  });

  it('resets failureCount to 0 after a successful poll', async () => {
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error('network timeout'))  // first call fails
      .mockResolvedValueOnce({ scoreboard: { games: [] } }); // second call succeeds

    const deps = { fetchScoreboard: mockFetch as unknown as () => ReturnType<typeof import('./nba-live-client.js').fetchScoreboard> };

    // Failure cycle: counter increments to 1
    const afterFailure = await runPollCycle(0, deps);
    expect(afterFailure).toBe(1);

    // Success cycle: counter resets to 0
    const afterSuccess = await runPollCycle(afterFailure, deps);
    expect(afterSuccess).toBe(0);

    // Confirm: next failure after reset uses failureCount=1 (not 2),
    // meaning calculateBackoff gets 1 not 2 → 24s not 48s
    expect(calculateBackoff(afterSuccess + 1, 12_000)).toBe(24_000);
    expect(calculateBackoff(afterFailure + 1, 12_000)).toBe(48_000);
  });
});

// ── Game matching, clock math, snapshot extras ────────────────────────────────

function withId(game: ScoreboardGame, gameId: string, status = 2): ScoreboardGame {
  return { ...game, gameId, gameStatus: status };
}

describe('matchScoreboardGame', () => {
  const tonight = withId(makeGame(LAC_TEAM_ID, 1610612744), '0022600123');
  const other = withId(makeGame(1610612747, 1610612738), '0022600124');

  it('matches the DB id with leading zeros stripped', () => {
    expect(matchScoreboardGame([other, tonight], '22600123')).toBe(tonight);
    expect(matchScoreboardGame([other, tonight], 22600123)).toBe(tonight);
  });

  it('never falls back to another Clippers game', () => {
    expect(matchScoreboardGame([tonight], '22600001')).toBeNull();
  });
});

describe('gameElapsedSeconds', () => {
  it('counts 12-minute quarters and 5-minute overtimes', () => {
    expect(gameElapsedSeconds(1, 'PT12M00.00S')).toBe(0);
    expect(gameElapsedSeconds(3, 'PT04M32.00S')).toBe(24 * 60 + 7 * 60 + 28);
    expect(gameElapsedSeconds(4, 'PT00M00.00S')).toBe(48 * 60);
    expect(gameElapsedSeconds(5, 'PT02M00.00S')).toBe(48 * 60 + 180);
    expect(gameElapsedSeconds(6, 'PT05M00.00S')).toBe(53 * 60);
  });
});

describe('extractRecentScoring', () => {
  const teams = { homeTeamId: 1, awayTeamId: 2, homeTricode: 'LAC', awayTricode: 'GSW' };
  const act = (n: number, period: number, clock: string, home: number, away: number, teamId = 0) => ({
    actionNumber: n, period, clock, teamId, scoreHome: String(home), scoreAway: String(away),
  });

  it('uses score deltas and each action’s own period', () => {
    const actions = [
      act(1, 1, 'PT11M00.00S', 2, 0, 1),       // Q1 — long ago
      act(2, 2, 'PT00M30.00S', 5, 0, 1),       // late Q2 — outside the 2-min window at Q3 10:00
      act(3, 3, 'PT11M00.00S', 5, 3, 2),       // Q3 11:00 — away three
      act(4, 3, 'PT10M40.00S', 5, 3, 2),       // miss (no score change)
      act(5, 3, 'PT10M20.00S', 7, 3, 1),       // home two
    ];
    const events = extractRecentScoring(actions, { period: 3, clock: 'PT10M00.00S' }, teams, 120);
    expect(events).toEqual([
      { team_id: '2', team_tricode: 'GSW', points: 3, event_time_seconds: 24 * 60 + 60 },
      { team_id: '1', team_tricode: 'LAC', points: 2, event_time_seconds: 24 * 60 + 100 },
    ]);
  });

  it('re-baselines when the feed starts mid-game instead of crediting the whole score', () => {
    const actions = [act(1, 3, 'PT06M20.00S', 77, 71, 1), act(2, 3, 'PT05M50.00S', 80, 71, 1)];
    const events = extractRecentScoring(actions, { period: 3, clock: 'PT04M32.00S' }, teams, 120);
    expect(events).toEqual([{ team_id: '1', team_tricode: 'LAC', points: 3, event_time_seconds: 24 * 60 + 370 }]);
  });

  it('skips actions without a parseable score', () => {
    const actions = [{ ...act(1, 1, 'PT11M00.00S', 0, 0), scoreHome: '' }];
    expect(extractRecentScoring(actions, { period: 1, clock: 'PT10M00.00S' }, teams)).toEqual([]);
  });
});

describe('summarizeOtherGames / lineScore', () => {
  it('lists every other game with a status', () => {
    const lac = withId(makeGame(LAC_TEAM_ID, 1610612744), '0022600123');
    const done = withId(makeGame(1610612747, 1610612738), '0022600124', 3);
    const out = summarizeOtherGames([lac, done], lac.gameId);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ game_id: '0022600124', status: 'final' });
  });

  it('pairs home and away period scores', () => {
    const g = makeGame(LAC_TEAM_ID, 1610612744);
    g.homeTeam.periods = [{ period: 1, periodType: 'REGULAR', score: 30 }, { period: 2, periodType: 'REGULAR', score: 25 }];
    g.awayTeam.periods = [{ period: 1, periodType: 'REGULAR', score: 28 }, { period: 2, periodType: 'REGULAR', score: 31 }];
    expect(lineScore(g)).toEqual([{ period: 1, home: 30, away: 28 }, { period: 2, home: 25, away: 31 }]);
  });
});
