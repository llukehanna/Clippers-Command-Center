import { describe, it, expect } from 'vitest';
import { buildLiveState, defaultModel, fingerprint, lastPlays, type StateInputs, type ModelContext } from './live-state.js';
import { action, box, GAME_ID, sbGame } from './live-fixtures.js';
import { DEFAULT_SIGMA, normalCdf, winProbability } from '../../src/lib/live/win-prob.js';

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

  it("the scoreboard's header wins when it is ahead of a lagging box", () => {
    const body = buildLiveState(inputs({
      sbGame: sbGame({ status: 3, home: 110, away: 101 }),
      box: box({ status: 2, home: 106, away: 101 }),
    }));
    expect(body.status).toBe('final');
    expect(body.home_score).toBe(110);
    expect(body.away_score).toBe(101);
    expect(body.home_box?.score).toBe(106);
  });

  it('never uses the stats.nba.com fallback box (period 1, empty clock) as the header source', () => {
    // scripts/lib/nba-live-client.ts's 403 fallback always reports period: 1,
    // gameClock: '' — even when gameStatus matches or leads the scoreboard, it
    // must not be picked as the header source (no real clock/period to show).
    const body = buildLiveState(inputs({
      sbGame: sbGame({ status: 2, period: 3, clock: 'PT06M00.00S', home: 60, away: 55 }),
      box: box({ status: 2, period: 1, clock: '', home: 60, away: 55 }),
    }));
    expect(body.period).toBe(3);
    expect(body.clock).toBe('6:00');
    expect(body.home_score).toBe(60);
    expect(body.away_score).toBe(55);
    // The box score panel itself still reflects whatever the box has.
    expect(body.home_box?.score).toBe(60);
  });

  it('does use the fallback box as the header once it reports final, even with an empty clock', () => {
    const body = buildLiveState(inputs({
      sbGame: sbGame({ status: 2, period: 3, clock: 'PT06M00.00S', home: 60, away: 55 }),
      box: box({ status: 3, period: 1, clock: '', home: 110, away: 101 }),
    }));
    expect(body.status).toBe('final');
    expect(body.home_score).toBe(110);
    expect(body.away_score).toBe(101);
  });
});

describe('buildLiveState — observed_at never dates a basket early', () => {
  it("is the newest play's time when the header score matches play-by-play", () => {
    const actions = [action(1), action(2, { scoreHome: '4', scoreAway: '0' })];
    const body = buildLiveState(inputs({ box: box({ home: 4, away: 0 }), actions }));
    expect(body.observed_at).toBe(actions[1].timeActual);
  });

  it('is the fetch time when the box score is ahead of play-by-play', () => {
    // The box already has the next basket (6–0); play-by-play still ends at 4–0.
    // Dating the doc by action 2 would let a spoiler delay show the 6–0 early.
    const actions = [action(1), action(2, { scoreHome: '4', scoreAway: '0' })];
    const body = buildLiveState(inputs({ box: box({ home: 6, away: 0 }), actions }));
    expect(body.home_score).toBe(6);
    expect(body.observed_at).toBe(new Date(NOW).toISOString());
  });

  it('reads the newest play with readable scores, skipping ones without', () => {
    const actions = [
      action(1, { scoreHome: '4', scoreAway: '3' }),
      action(2, { scoreHome: '', scoreAway: '' }),
    ];
    const body = buildLiveState(inputs({ box: box({ home: 4, away: 3 }), actions }));
    expect(body.observed_at).toBe(actions[1].timeActual);
  });

  it('is the fetch time when the scoreboard shows points but play-by-play has none yet', () => {
    const body = buildLiveState(inputs({ sbGame: sbGame({ status: 2, home: 2, away: 0 }) }));
    expect(body.observed_at).toBe(new Date(NOW).toISOString());
  });
});

describe('buildLiveState — a failing derivation', () => {
  it('drops only the lineups when the box score is malformed', () => {
    const b = box({ home: 2, away: 0 });
    const malformed = { ...b, homeTeam: { ...b.homeTeam, players: undefined as unknown as typeof b.homeTeam.players } };
    const body = buildLiveState(inputs({ box: malformed, actions: [action(1)] }));
    expect(body.lineups).toBeNull();
    expect(body.flow).not.toBeNull();
    expect(body.home_score).toBe(2);
  });

  it('drops the play-by-play derivations, not the doc, when a play is malformed', () => {
    const bad = action(2, { actionType: undefined as unknown as string, scoreHome: '2', scoreAway: '0' });
    const body = buildLiveState(inputs({ box: box({ home: 2, away: 0 }), actions: [action(1), bad] }));
    expect(body.flow).toBeNull();
    expect(body.lineups).toBeNull(); // substitution tracking reads actionType too
    expect(body.home_score).toBe(2);
    expect(body.wp).not.toBeNull();
    expect(body.last_plays).toHaveLength(2);
  });
});

describe('fingerprint', () => {
  it('ignores fetched_at and next_ms, but not phase or content', () => {
    // Header and play-by-play agree (2–0), so observed_at is the play's time.
    const a = buildLiveState(inputs({ box: box({ home: 2, away: 0 }), actions: [action(1)] }));
    expect(a.observed_at).toBe(action(1).timeActual);
    expect(fingerprint({ ...a, fetched_at: 'later', cadence: { phase: 'LIVE', next_ms: 5000 } })).toBe(fingerprint(a));
    expect(fingerprint({ ...a, cadence: { phase: 'STOPPAGE', next_ms: 3000 } })).not.toBe(fingerprint(a));
    const b = buildLiveState(inputs({ box: box({ home: 2, away: 0 }), actions: [action(1), action(2)] }));
    expect(fingerprint(b)).not.toBe(fingerprint(a));
  });

  it('does not change on every tick while the box score is ahead of play-by-play (observed_at = fetch time)', () => {
    const over = { box: box({ home: 6, away: 0 }), actions: [action(1, { scoreHome: '4', scoreAway: '0' })] };
    const a = buildLiveState(inputs(over));
    const b = buildLiveState(inputs({ ...over, now: NOW + 3_000 }));
    expect(b.observed_at).not.toBe(a.observed_at);
    expect(fingerprint(b)).toBe(fingerprint(a));
    // Once play-by-play catches up, the real play time is new content.
    const c = buildLiveState(inputs({ ...over, actions: [...over.actions, action(2, { scoreHome: '6', scoreAway: '0' })] }));
    expect(fingerprint(c)).not.toBe(fingerprint(a));
  });
});

const MODEL: ModelContext = {
  expected: 4.5,
  expectedSource: 'spread',
  sigma: 12,
  calibration: null,
  usualMin: {},
};

describe('buildLiveState — Plan 3 fields', () => {
  it('gives the pregame win probability before tip, and no flow or lineups', () => {
    const body = buildLiveState(inputs({ sbGame: sbGame({ status: 1 }), phase: 'PREGAME', nextMs: 30_000, model: MODEL }));
    expect(body.wp).toMatchObject({ model: 'stern-v1', sigma: 12, expected_margin: 4.5, expected_source: 'spread', calibration: null });
    expect(body.wp!.lac).toBeCloseTo(normalCdf(4.5 / 12), 3);
    expect(body.flow).toBeNull();
    expect(body.lineups).toBeNull();
  });

  it('gives the live win probability from the current margin and clock', () => {
    const body = buildLiveState(inputs({
      box: box({ period: 2, clock: 'PT04M32.00S', home: 30, away: 28 }),
      actions: [action(1, { clock: 'PT04M32.00S', period: 2, scoreHome: '30', scoreAway: '28' })],
      model: MODEL,
    }));
    const expected = winProbability({ margin: 2, period: 2, clockSec: 272, expected: 4.5, sigma: 12 });
    expect(body.wp!.lac).toBeCloseTo(expected, 3);
    expect(body.flow!.points.at(-1)).toMatchObject({ m: 2, a: 1 });
    expect(body.lineups).toMatchObject({ on_court: { lac: [], opp: [] } });
  });

  it('settles the win probability at the final buzzer', () => {
    const body = buildLiveState(inputs({ box: box({ status: 3, period: 4, clock: 'PT00M00.00S', home: 101, away: 99 }), model: MODEL }));
    expect(body.wp!.lac).toBe(1);
  });

  it('uses the default model without a context: home court and the default σ', () => {
    const body = buildLiveState(inputs({ sbGame: sbGame({ status: 1 }), phase: 'PREGAME' }));
    expect(body.wp).toMatchObject({ sigma: DEFAULT_SIGMA, expected_margin: 2.5, expected_source: 'home_court' });
    expect(defaultModel(false).expected).toBe(-2.5);
  });
});
