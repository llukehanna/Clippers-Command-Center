import { describe, it, expect } from 'vitest';
import { makeFact } from '../__fixtures__/facts';
import { expectCleanPhrasings, fr, rcFor, say } from '../__fixtures__/sweep';

const pre = { surface: 'pregame' as const, gameId: '1802', context: { date: '2026-11-18', opponent_id: '2', home: true }, window: { type: 'game' as const, game_id: '1802' } };
const warriors = { type: 'team' as const, id: '2', name: 'Golden State Warriors' };
const clippers = { type: 'team' as const, id: '1', name: 'Clippers' };
const streak = makeFact({ ...pre, kind: 'opp_form', subject: warriors, stat: 'opp_streak', value: 5, data: { winning: true, wins: 7, losses: 3, length: 5 } });
const last10 = makeFact({ ...pre, kind: 'opp_form', subject: warriors, stat: 'opp_last10', value: 9, data: { winning: true, wins: 9, losses: 1, length: 4 } });
const hot = makeFact({ ...pre, kind: 'opp_hot_player', subject: { type: 'player', id: '40', name: 'Stephen Curry' }, stat: 'scoring_30', value: 6,
  data: { noun: '30+ points', start_date: '2026-11-04', end_date: '2026-11-16', opponent_player: true } });
const b2b = makeFact({ ...pre, kind: 'rest', subject: clippers, stat: 'lac_b2b', value: 0, data: { lac_rest: 0, lac_last_game: '2026-11-17' } });
const edge = makeFact({ ...pre, kind: 'rest', subject: clippers, stat: 'rest_edge', value: 3, data: { lac_rest: 3, opp_rest: 0, lac_last_game: '2026-11-14', opp_last_game: '2026-11-17' } });
const line = (spread: number) => makeFact({ ...pre, kind: 'line', subject: clippers, stat: 'spread', value: spread, data: { spread, total_points: 228.5 } });

describe('matchup templates (present tense)', () => {
  const rc = rcFor('pregame');
  const none = fr('none');
  it('words opponent form and hot players', () => {
    expect(say(streak, none, rc)).toEqual({ headline: 'The Golden State Warriors have won 5 straight', context: '7-3 in their last 10' });
    expect(say(last10, none, rc)).toEqual({ headline: 'The Golden State Warriors are 9-1 in their last 10', context: 'Current streak: W4' });
    expect(say(hot, none, rc)).toEqual({ headline: 'Stephen Curry has 30+ points in 6 straight for the Warriors', context: 'Nov 4, 2026 to Nov 16, 2026' });
  });
  it('words rest and the line', () => {
    expect(say(b2b, none, rc)).toEqual({ headline: 'Clippers play the second night of a back-to-back', context: 'Last game: Nov 17, 2026' });
    expect(say(edge, none, rc).headline).toBe('Clippers have 3 days of rest; the Golden State Warriors have 0 days');
    expect(say(line(-4.5), none, rc)).toEqual({ headline: 'Clippers are 4.5-point favorites vs the Warriors', context: 'Over/under 228.5' });
    expect(say(line(3), none, rc).headline).toBe('Clippers are 3-point underdogs vs the Warriors');
    expect(say(line(0), none, rc).headline).toBe("The line on Clippers vs the Warriors: a pick'em");
  });
  it('renders clean for every frame', () => {
    for (const f of [streak, last10, hot, b2b, edge, line(-4.5), line(3), line(0),
      makeFact({ ...pre, kind: 'opp_form', subject: warriors, stat: 'opp_streak', value: 4, data: { winning: false, wins: 2, losses: 8, length: 4 } }),
      makeFact({ ...pre, kind: 'rest', subject: warriors, stat: 'opp_b2b', value: 0, data: { opp_rest: 0, opp_last_game: '2026-11-17' } })]) {
      expectCleanPhrasings(f);
    }
  });
});
