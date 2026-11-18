import { describe, it, expect } from 'vitest';
import { buildEvidence } from '../evidence';
import { makeFact } from '../__fixtures__/facts';
import { expectCleanPhrasings, fr, rcFor, say } from '../__fixtures__/sweep';

const vsData = { games: 6, prev_games: 140, formatted: '27.4', prev_formatted: '22.1', prev_value: 22.1, cur_value: 27.4, label: '1996-97', higherIsBetter: true };
const vs = (career: boolean) => makeFact({
  kind: 'vs_opponent', surface: 'pregame', stat: 'ppg', value: 27.4, gameId: '1802',
  window: { type: 'career', season_id: 2025, game_id: '1802' }, context: { date: '2026-11-18', opponent_id: '2', home: true },
  data: { ...vsData, career },
});

describe('vs opponent', () => {
  it('words a player\'s average against the next opponent since the records start, naming the regular-season filter', () => {
    expect(say(vs(false), fr('none'), rcFor('pregame'))).toEqual({
      headline: 'Star Clipper averages 27.4 points vs the Warriors', context: '6 regular-season games since 1996-97; 22.1 PPG overall',
    });
    expect(say(vs(false), fr('none'), rcFor('pregame'), 1).headline).toBe('Star Clipper vs the Warriors: 27.4 PPG');
  });
  it('says "career" when the whole career is in the data', () => {
    expect(say(vs(true), fr('none'), rcFor('pregame')).context).toBe('6 career regular-season games vs the Warriors; 22.1 PPG overall');
  });
  it('builds the same before/after evidence either way', () => {
    for (const career of [true, false]) {
      expect(buildEvidence(vs(career), fr('none'))).toEqual({
        type: 'delta', before: { value: 22.1, label: 'overall' }, after: { value: 27.4, label: 'vs this opponent' }, betterIsHigher: true,
      });
    }
  });
  it('renders clean for every frame', () => {
    expectCleanPhrasings(vs(true));
    expectCleanPhrasings(vs(false));
  });
});
