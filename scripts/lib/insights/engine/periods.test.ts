import { describe, it, expect } from 'vitest';
import { bestPeriods } from './periods';

describe('bestPeriods', () => {
  it('finds each player’s best quarter and best half', () => {
    const rows = [
      { player_id: '1', display_name: 'Star Clipper', period: 1, pts: 8 },
      { player_id: '1', display_name: 'Star Clipper', period: 2, pts: 15 },
      { player_id: '1', display_name: 'Star Clipper', period: 3, pts: 6 },
      { player_id: '1', display_name: 'Star Clipper', period: 4, pts: 10 },
      { player_id: '2', display_name: 'Big Clipper', period: 1, pts: 4 },
      { player_id: '2', display_name: 'Big Clipper', period: 3, pts: 4 },
      { player_id: '2', display_name: 'Big Clipper', period: 4, pts: 9 },
    ];
    expect(bestPeriods(rows)).toEqual([
      { playerId: '1', name: 'Star Clipper', quarter: { period: 2, pts: 15 }, half: { half: 1, pts: 23 } },
      { playerId: '2', name: 'Big Clipper', quarter: { period: 4, pts: 9 }, half: { half: 2, pts: 13 } },
    ]);
  });
  it('breaks ties toward the earlier quarter and the first half', () => {
    expect(bestPeriods([
      { player_id: '1', display_name: 'A', period: 1, pts: 10 }, { player_id: '1', display_name: 'A', period: 3, pts: 10 },
    ])[0]).toMatchObject({ quarter: { period: 1, pts: 10 }, half: { half: 1, pts: 10 } });
  });
  it('ignores overtime periods, as the reference sets do', () => {
    expect(bestPeriods([
      { player_id: '1', display_name: 'A', period: 4, pts: 6 }, { player_id: '1', display_name: 'A', period: 5, pts: 14 },
    ])[0]).toMatchObject({ quarter: { period: 4, pts: 6 }, half: { half: 2, pts: 6 } });
  });
});
