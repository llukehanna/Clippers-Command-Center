import { describe, it, expect } from 'vitest';
import { buildLiveState, fingerprint, lastPlays, type StateInputs } from './live-state.js';
import { action, box, GAME_ID, sbGame } from './live-fixtures.js';

const NOW = Date.UTC(2026, 9, 22, 2, 45, 0);
const other = sbGame({ gameId: '0022600094', status: 2, home: 50, away: 48 });

function inputs(over: Partial<StateInputs> = {}): StateInputs {
  const sb = sbGame({ status: 2, home: 0, away: 0 });
  return { sbGame: sb, sbGames: [sb, other], box: null, actions: [], phase: 'LIVE', nextMs: 3000, now: NOW, ...over };
}

describe('lastPlays', () => {
  it('returns the newest 15 plays, newest first, trimmed for clients', () => {
    const actions = Array.from({ length: 20 }, (_, i) => action(i + 1));
    const plays = lastPlays(actions);
    expect(plays).toHaveLength(15);
    expect(plays[0].action_number).toBe(20);
    expect(plays[14].action_number).toBe(6);
    expect(plays[0]).toEqual({
      action_number: 20, period: 1, clock: '10:00', team_tricode: 'LAC', person_id: 201,
      action_type: '2pt', sub_type: 'jumpshot', description: 'Play 20', score_home: 2, score_away: 0,
      time_actual: actions[19].timeActual,
    });
  });
});

describe('buildLiveState', () => {
  it('prefers the box score for status, score, clock and line score', () => {
    const actions = [action(1), action(2, { clock: 'PT04M32.00S', scoreHome: '30', scoreAway: '28' })];
    const body = buildLiveState(inputs({
      box: box({ period: 2, clock: 'PT04M32.00S', home: 30, away: 28, homePeriods: [20, 10], awayPeriods: [15, 13] }),
      actions,
    }));
    expect(body).toMatchObject({
      v: 1, source: 'nba', nba_game_id: GAME_ID, status: 'in_progress', period: 2, clock: '4:32',
      home_score: 30, away_score: 28,
      periods: [{ period: 1, home: 20, away: 15 }, { period: 2, home: 10, away: 13 }],
      observed_at: actions[1].timeActual, fetched_at: new Date(NOW).toISOString(),
      cadence: { phase: 'LIVE', next_ms: 3000 }, is_stale: false, stale_reason: null,
    });
    expect(body.home_box?.teamTricode).toBe('LAC');
    expect(body.last_plays[0].action_number).toBe(2);
  });

  it('falls back to the scoreboard before tip', () => {
    const body = buildLiveState(inputs({ sbGame: sbGame({ status: 1 }), phase: 'PREGAME', nextMs: 30_000 }));
    expect(body.status).toBe('scheduled');
    expect(body.home_box).toBeNull();
    expect(body.last_plays).toEqual([]);
    expect(body.observed_at).toBeNull();
    expect(body.recent_scoring).toEqual([]);
  });

  it('summarizes the other games on the scoreboard, not this one', () => {
    const body = buildLiveState(inputs());
    expect(body.other_games).toHaveLength(1);
    expect((body.other_games[0] as { game_id: string }).game_id).toBe('0022600094');
  });

  it('reports final when the box score is final even if the scoreboard lags', () => {
    const body = buildLiveState(inputs({ box: box({ status: 3, home: 110, away: 101 }), phase: 'FINAL', nextMs: 0 }));
    expect(body.status).toBe('final');
  });
});

describe('fingerprint', () => {
  it('ignores fetched_at and next_ms, but not phase or content', () => {
    const a = buildLiveState(inputs({ actions: [action(1)] }));
    expect(fingerprint({ ...a, fetched_at: 'later', cadence: { phase: 'LIVE', next_ms: 5000 } })).toBe(fingerprint(a));
    expect(fingerprint({ ...a, cadence: { phase: 'STOPPAGE', next_ms: 3000 } })).not.toBe(fingerprint(a));
    const b = buildLiveState(inputs({ actions: [action(1), action(2)] }));
    expect(fingerprint(b)).not.toBe(fingerprint(a));
  });
});
