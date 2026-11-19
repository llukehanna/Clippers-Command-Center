import { describe, it, expect } from 'vitest';
import { ordinal, recordNotes, seasonLabel, type HighRow } from './record-notes';

const row = (scope: string, stat_key: string, rank: number, value: number, player: string | null = 'Kawhi Leonard'): HighRow => ({
  scope, stat_key, rank, value, player_id: player ? '10' : null, player,
});
const STARTS = { records: 2020, pbp: 2019 };

describe('ordinal / seasonLabel', () => {
  it('formats', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 22, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '22nd', '101st']);
    expect(seasonLabel(2020)).toBe('2020-21');
    expect(seasonLabel(1999)).toBe('1999-00');
  });
});

describe('recordNotes', () => {
  it('writes team, player, career, season and league notes', () => {
    const notes = recordNotes([
      row('lac_team', 'team_q_pts', 2, 44, null),
      row('lac_team', 'margin', 1, 41, null),
      row('lac_player', 'pts', 4, 45),
      row('player_career', 'ast', 1, 14),
      row('player_season', 'reb', 1, 12),
      row('league_season', 'fg3m', 3, 10, 'James Harden'),
    ], STARTS).map((n) => n.text);
    expect(notes).toEqual([
      '41-point win — the Clippers\' biggest since 2020-21',
      '44 points in a quarter — 2nd-most by the Clippers since 2019-20',
      'Kawhi Leonard: 45 points — 4th-most by a Clipper since 2020-21',
      'Kawhi Leonard: 14 assists — career high',
      'Kawhi Leonard: 12 rebounds — season high',
      'James Harden: 10 threes — 3rd-most in the NBA this season',
    ]);
  });
  it('keeps only the most notable scope per player and stat', () => {
    const notes = recordNotes([
      row('player_season', 'pts', 1, 45),
      row('player_career', 'pts', 2, 45),
      row('lac_player', 'pts', 4, 45),
    ], STARTS);
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toContain('by a Clipper');
  });
  it('drops ranks that are not notable and caps the list', () => {
    expect(recordNotes([row('player_career', 'pts', 4, 30), row('league_season', 'pts', 6, 40), row('player_season', 'pts', 2, 30)], STARTS)).toEqual([]);
    const many = Array.from({ length: 9 }, (_, i) => row('lac_player', ['pts', 'reb', 'ast', 'fg3m', 'stl', 'blk', 'q_pts', 'half_pts', 'pts'][i], 1, 10, `P${i}`));
    expect(recordNotes(many, STARTS)).toHaveLength(6);
  });
  it('drops trivial season highs under the box-score floors (Garland: 1 block)', () => {
    const notes = recordNotes([
      row('player_season', 'blk', 1, 1, 'Darius Garland'),
      row('player_season', 'pts', 1, 14, 'Darius Garland'),
      row('player_season', 'fg3m', 1, 3, 'Brook Lopez'),
      row('player_season', 'reb', 1, 8, 'Ivica Zubac'),
    ], STARTS).map((n) => n.text);
    expect(notes).toEqual(['Brook Lopez: 3 threes — season high', 'Ivica Zubac: 8 rebounds — season high']);
  });

  it('says one block, not "1 blocks"', () => {
    const [n] = recordNotes([row('player_career', 'blk', 1, 1, 'Darius Garland')], STARTS);
    expect(n.text).toBe('Darius Garland: 1 block — career high');
    const [q] = recordNotes([row('lac_player', 'fg3m', 1, 1, 'A')], STARTS);
    expect(q.text).toBe('A: 1 three — most by a Clipper since 2020-21');
  });

  it('omits "since" when the start season is unknown and handles fewest points allowed', () => {
    const [n] = recordNotes([row('lac_team', 'opp_pts_low', 1, 82, null)], { records: null, pbp: null });
    expect(n.text).toBe('Held the opponent to 82 points — the Clippers\' fewest allowed');
  });
});
