import { describe, it, expect } from 'vitest';
import { makeFact } from '../__fixtures__/facts';
import { expectCleanPhrasings, fr, rcFor, say } from '../__fixtures__/sweep';
import { TEAM_GAME_STATS } from '../references';

const team = (stat: keyof typeof TEAM_GAME_STATS, value: number, result: 'W' | 'L' = 'W') => makeFact({
  kind: 'team_game_stat', surface: 'postgame', subject: { type: 'team', id: '1', name: 'Clippers' }, stat, value,
  window: { type: 'game', game_id: '500', season_id: 2025 }, gameId: '500',
  context: { date: '2025-11-28', opponent_id: '2', home: true, result },
  data: { thing: TEAM_GAME_STATS[stat].thing(value), best: TEAM_GAME_STATS[stat].best, by: 'by the Clippers', formatted: TEAM_GAME_STATS[stat].fmt(value) },
});

describe('team line templates', () => {
  const post = rcFor('postgame');
  it('words each team stat', () => {
    expect(say(team('team_pts', 132), fr('records_best', { records_label: '2020-21', records_seasons: 6 }), post))
      .toEqual({ headline: 'Clippers scored 132 in a win over the Warriors', context: 'Most points in a game by the Clippers since 2020-21' });
    expect(say(team('team_pts', 132), fr('first_since', { since_date: '2021-03-01' }), post).context).toBe('First 132-point game since Mar 2021');
    expect(say(team('opp_pts_low', 88), fr('first_since', { since_date: '2021-03-01' }), post))
      .toEqual({ headline: 'Clippers held the Warriors to 88 points', context: 'Fewest points allowed since Mar 2021' });
    expect(say(team('team_fg_pct', 0.584), fr('none'), post).headline).toBe('Clippers shot 58.4% from the field vs the Warriors');
    expect(say(team('loss_margin', 31, 'L'), fr('first_since', { since_date: '2021-03-01' }), post))
      .toEqual({ headline: 'Clippers lost to the Warriors by 31', context: 'First 31-point loss since Mar 2021' });
  });
  it('words league ranks with the frozen postgame season wording, never "this season"', () => {
    expect(say(team('team_pts', 132), fr('league_rank', { rank: 1 }), post).context).toBe('Most points in a game by any NBA team so far in 2025-26');
    expect(say(team('team_pts', 132), fr('league_rank', { rank: 3 }), post).context).toBe('The 3rd-most points in a game by any NBA team so far in 2025-26');
  });
  it('renders clean for every stat and frame', () => {
    for (const [stat, def] of Object.entries(TEAM_GAME_STATS)) {
      expectCleanPhrasings(team(stat as keyof typeof TEAM_GAME_STATS, def.betterIsHigher ? def.floor + 5 : def.floor - 5, def.when === 'L' ? 'L' : 'W'));
    }
  });
});
