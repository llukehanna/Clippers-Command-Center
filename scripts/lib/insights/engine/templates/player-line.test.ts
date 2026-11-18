import { describe, it, expect } from 'vitest';
import { makeFact } from '../__fixtures__/facts';
import { expectCleanPhrasings, fr, rcFor, say } from '../__fixtures__/sweep';

const base = {
  surface: 'postgame' as const, window: { type: 'game' as const, game_id: '500', season_id: 2025 },
  context: { date: '2025-11-28', opponent_id: '2', home: true, result: 'W' as const }, gameId: '500',
};
const line = makeFact({ ...base, kind: 'player_game_stat', stat: 'pts', value: 55,
  data: { thing: '55-point game', best: 'most points in a game', by: 'by a Clipper', label: 'scoring', unit: 'points' } });
const combo = makeFact({ ...base, kind: 'player_combo', stat: 'triple_double', value: 1,
  data: { thing: 'triple-double', best: 'triple-double', by: 'by a Clipper', line: '24-12-11' } });

describe('player line templates', () => {
  it('words a big night in the past tense with the result', () => {
    const post = rcFor('postgame', false);
    expect(say(line, fr('records_best', { records_label: '2024-25', records_seasons: 2 }), post)).toEqual({
      headline: 'Star Clipper scored 55 in a win over the Warriors', context: 'Most points in a game by a Clipper since 2024-25',
    });
    expect(say({ ...line, context: { ...line.context, result: 'L' } }, fr('none'), post, 1))
      .toEqual({ headline: 'Star Clipper: 55 points vs the Warriors', context: 'Nov 28, 2025 vs the Golden State Warriors' });
    expect(say(line, fr('league_rank', { rank: 1 }), post).context).toBe('The best scoring night in the NBA in 2025-26');
  });
  it('words a loss as a loss to the opponent', () => {
    const lost = { ...line, context: { ...line.context, result: 'L' as const } };
    expect(say(lost, fr('none'), rcFor('postgame', false)).headline).toBe('Star Clipper scored 55 in a loss to the Warriors');
  });
  it('words a combo, framed as the only one', () => {
    expect(say(combo, fr('only_one', { records_label: '2020-21' }), rcFor('postgame'))).toEqual({
      headline: 'Star Clipper posted a triple-double vs the Warriors', context: 'The only triple-double by a Clipper since 2020-21',
    });
    expect(say(combo, fr('none'), rcFor('postgame'), 1))
      .toEqual({ headline: 'Star Clipper had a 24-12-11 line vs the Warriors', context: '24-12-11 (points-rebounds-assists)' });
  });
  it('renders clean for every frame and stat', () => {
    for (const stat of ['pts', 'reb', 'ast', 'fg3m', 'stl', 'blk']) expectCleanPhrasings({ ...line, stat });
    expectCleanPhrasings(combo);
    expectCleanPhrasings({ ...combo, stat: 'pts30_reb10', data: { ...combo.data, thing: '30-point, 10-rebound game' } });
  });
});
