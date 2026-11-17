import { describe, it, expect } from 'vitest';
import {
  planLoad, guardAllows, estimateBytes, eraProblems, teamBoxFromRows, teamBoxesForGame, checkPointsAgainstScores,
  capped, stepGames, CLIPPERS_FRANCHISE_ID, TEAM_BOX_COLUMNS,
} from './import-plan.js';
import type { KaggleGame, KagglePlayerGame } from './kaggle.js';

const MB = 1024 * 1024;

const game = (over: Partial<KaggleGame>): KaggleGame => ({
  nbaGameId: 29700001, seasonId: 1997, gameDate: '1997-11-01',
  homeFranchiseId: 1610612738, awayFranchiseId: 1610612756, homeScore: 100, awayScore: 90,
  isPlayoffs: false, homeCity: 'Boston', homeName: 'Celtics', awayCity: 'Phoenix', awayName: 'Suns',
  ...over,
});

const prow = (over: Partial<KagglePlayerGame>): KagglePlayerGame => ({
  nbaGameId: 29700001, personId: 1, firstName: 'A', lastName: 'B', isHome: true, starter: null,
  minutes: '30:00', points: 10, rebounds: 5, assists: 2, steals: 1, blocks: 0, turnovers: 1,
  fouls: 2, plusMinus: 3, fgMade: 4, fgAttempted: 8, fg3Made: 0, fg3Attempted: 1, ftMade: 2,
  ftAttempted: 2, offReb: 1, defReb: 4,
  ...over,
});

describe('planLoad', () => {
  it('orders Clippers seasons first, then league seasons newest first', () => {
    const steps = planLoad([1970, 1996, 1997, 2018, 2019]).map((s) => `${s.seasonId} ${s.scope}`);
    expect(steps).toEqual([
      '1970 clippers', '1996 clippers', '1997 clippers', '2018 clippers',
      '2019 league', '2018 league', '1997 league', '1996 league',
    ]);
  });

  it('never plans per-game steps for 2020 or later, or before 1970', () => {
    expect(planLoad([1950, 2020, 2021, 2025])).toEqual([]);
    expect(planLoad([2019, 2020]).map((s) => `${s.seasonId} ${s.scope}`)).toEqual(['2019 league']);
  });

  it('dedupes and sorts unsorted input', () => {
    expect(planLoad([1997, 1971, 1997, 1971]).map((s) => `${s.seasonId} ${s.scope}`)).toEqual([
      '1971 clippers', '1997 clippers', '1997 league',
    ]);
  });
});

describe('guard', () => {
  it('stops at 85 percent of the cap', () => {
    expect(guardAllows(400 * MB, 40 * MB, 512)).toBe(false);
    expect(guardAllows(300 * MB, 40 * MB, 512)).toBe(true);
  });

  it('allows exactly 85 percent', () => {
    expect(guardAllows(0.85 * 512 * MB - 10, 10, 512)).toBe(true);
    expect(guardAllows(0.85 * 512 * MB - 10, 11, 512)).toBe(false);
  });

  it('estimates bytes per player and team row', () => {
    expect(estimateBytes(1000, 10)).toBe(1000 * 250 + 10 * 300);
  });
});

describe('stepGames', () => {
  const lac = game({ nbaGameId: 29700002, homeFranchiseId: CLIPPERS_FRANCHISE_ID });
  const other = game({ nbaGameId: 29700003 });
  const g2019 = game({ nbaGameId: 21900003, seasonId: 2019 });
  const lac2019 = game({ nbaGameId: 21900004, seasonId: 2019, awayFranchiseId: CLIPPERS_FRANCHISE_ID });

  it('clippers step takes only Clippers games', () => {
    expect(stepGames({ seasonId: 1997, scope: 'clippers' }, [lac, other]).map((g) => g.nbaGameId)).toEqual([29700002]);
  });

  it('league step before 2019 leaves Clippers games to the Clippers step', () => {
    expect(stepGames({ seasonId: 1997, scope: 'league' }, [lac, other]).map((g) => g.nbaGameId)).toEqual([29700003]);
  });

  it('2019 league step takes every game', () => {
    expect(stepGames({ seasonId: 2019, scope: 'league' }, [g2019, lac2019]).map((g) => g.nbaGameId)).toEqual([21900003, 21900004]);
  });

  it('never returns a game from another season', () => {
    expect(stepGames({ seasonId: 2019, scope: 'league' }, [lac, other])).toEqual([]);
  });
});

describe('eraProblems', () => {
  it('passes the 30 franchises in their eras', () => {
    expect(eraProblems([game({ seasonId: 1972, homeFranchiseId: CLIPPERS_FRANCHISE_ID })])).toEqual([]);
  });

  it('flags an unknown franchise from 1970 on but ignores earlier seasons', () => {
    expect(eraProblems([game({ seasonId: 1975, homeFranchiseId: 1610610024 })])).toEqual([
      { seasonId: 1975, franchiseId: 1610610024, tricode: null, reason: 'unknown franchise' },
    ]);
    expect(eraProblems([game({ seasonId: 1950, homeFranchiseId: 1610610024 })])).toEqual([]);
  });

  it('flags a franchise season with no era', () => {
    // Toronto's first era starts in 1995, so 1994 is before the franchise: exempt.
    expect(eraProblems([game({ seasonId: 1994, homeFranchiseId: 1610612761 })])).toEqual([]);
  });

  it('exempts Charlotte 2002-03 (dormant)', () => {
    expect(eraProblems([game({ seasonId: 2002, homeFranchiseId: 1610612766 })])).toEqual([]);
    expect(eraProblems([game({ seasonId: 2003, homeFranchiseId: 1610612766 })])).toEqual([]);
  });

  it('reports each franchise season once', () => {
    const g = game({ seasonId: 1980, awayFranchiseId: 1610610024 });
    expect(eraProblems([g, { ...g, nbaGameId: 28000002 }])).toHaveLength(1);
  });
});

describe('teamBoxFromRows', () => {
  it('sums counted rows and keeps a total null when any counted row is null', () => {
    const rows = [
      prow({ personId: 1, points: 10, steals: null }),
      prow({ personId: 2, points: 7, steals: 2 }),
      // DNP rows are not counted, even with a null stat.
      prow({ personId: 3, minutes: null, points: null, rebounds: null }),
    ];
    const box = teamBoxFromRows(rows, 17);
    expect(box.points).toBe(17);
    expect(box.steals).toBeNull();
    expect(box.rebounds).toBe(10);
    expect(box.fg_made).toBe(8);
    expect(box.offensive_reb).toBe(2);
  });

  it('takes points from the final score, not the player sum', () => {
    // A missing player row: the players add up to 17, the team scored 101.
    const rows = [prow({ personId: 1, points: 10 }), prow({ personId: 2, points: 7 })];
    expect(teamBoxFromRows(rows, 101).points).toBe(101);
    // Even when a counted row has no points.
    expect(teamBoxFromRows([prow({ points: null })], 99).points).toBe(99);
  });

  it('gives the score and nulls everything else when no row counts', () => {
    for (const rows of [[], [prow({ minutes: '0:00' })]]) {
      const box = teamBoxFromRows(rows, 88);
      expect(box.points).toBe(88);
      for (const col of TEAM_BOX_COLUMNS) if (col !== 'points') expect(box[col]).toBeNull();
    }
  });
});

describe('teamBoxesForGame', () => {
  const g = game({ nbaGameId: 29700001, homeScore: 101, awayScore: 99 });

  it('writes both sides with the final scores', () => {
    const boxes = teamBoxesForGame(g, [prow({ isHome: true, points: 40 }), prow({ personId: 2, isHome: false, points: 50 })])!;
    expect(boxes.home.points).toBe(101);
    expect(boxes.away.points).toBe(99);
    expect(boxes.home.rebounds).toBe(5);
    expect(boxes.away.rebounds).toBe(5);
  });

  it('still writes the side with no counted rows: score only, every other stat null', () => {
    const boxes = teamBoxesForGame(g, [prow({ isHome: true }), prow({ personId: 2, isHome: false, minutes: '0:00', points: 0 })])!;
    expect(boxes.home).toMatchObject({ points: 101, rebounds: 5, turnovers: 1 });
    expect(boxes.away.points).toBe(99);
    for (const col of TEAM_BOX_COLUMNS) if (col !== 'points') expect(boxes.away[col]).toBeNull();
  });

  it('writes neither when no row counts on either side', () => {
    expect(teamBoxesForGame(g, [])).toBeNull();
    expect(teamBoxesForGame(g, [prow({ minutes: '0:00', points: 0 }), prow({ isHome: false, minutes: null, points: null })])).toBeNull();
  });

  it("ignores another game's rows", () => {
    expect(teamBoxesForGame(g, [prow({ nbaGameId: 29700002 })])).toBeNull();
  });
});

describe('checkPointsAgainstScores', () => {
  it('lists sides whose summed points differ from the score, and sides with no rows', () => {
    const games = [
      game({ nbaGameId: 29700002, homeScore: 101, awayScore: 99 }),
      game({ nbaGameId: 29700001, homeScore: 20, awayScore: 10 }),
    ];
    const rows = [
      // 29700001: home adds up; away has a null-points row.
      prow({ nbaGameId: 29700001, isHome: true, points: 20 }),
      prow({ nbaGameId: 29700001, personId: 2, isHome: false, points: null }),
      // 29700002: home is a player row short; away has only a DNP.
      prow({ nbaGameId: 29700002, isHome: true, points: 45 }),
      prow({ nbaGameId: 29700002, personId: 3, isHome: false, minutes: '0:00', points: 0 }),
    ];
    expect(checkPointsAgainstScores(games, rows)).toEqual({
      mismatches: [
        { gameId: 29700001, side: 'away', sum: null, score: 10 },
        { gameId: 29700002, side: 'home', sum: 45, score: 101 },
      ],
      noPlayerRows: [{ gameId: 29700002, side: 'away', score: 99 }],
    });
  });
});

describe('capped', () => {
  it('keeps the total and the first items', () => {
    expect(capped([1, 2, 3], 2)).toEqual({ total: 3, shown: 2, items: [1, 2] });
    expect(capped(Array.from({ length: 250 }, (_, i) => i)).items).toHaveLength(200);
  });
});
