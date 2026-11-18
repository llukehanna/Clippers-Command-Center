import { describe, expect, it } from 'vitest';
import { NBA_TEAM_IDS } from '../nba-teams.js';
import { buildLottery, LOTTERY_FORMATS, type TeamSeasonRow } from './lottery.js';
import type { PickRow } from './picks.js';
import type { LotteryRow } from './wiki-draft.js';

const { LAC, DAL, MIN, WAS, SAC, PHI, MIL, GSW, DEN, MIA, DET, ORL, BOS, NYK, ATL, LAL, CHA } = NBA_TEAM_IDS;

const pick = (year: number, overall: number, original: number, owner: number | null, extra: Partial<PickRow> = {}): PickRow => ({
  pickKey: `${year}-1-${original}`, year, round: 1, originalFranchiseId: original, protections: null, protectionsText: null,
  protectionsKnown: true, status: 'used', overall, selectedPersonKey: null, finalOwnerFranchiseId: owner, ...extra,
} as PickRow);
const ts = (season: number, id: number, wins: number, losses: number, round: number | null = 0): TeamSeasonRow => ({
  season_id: season, nba_franchise_id: id, wins, losses, playoff_round: round,
});
const wiki = (year: number, rows: Array<[number, number | null, number]>): LotteryRow[] =>
  rows.map(([franchise, oddsFirst, pickWon], i) => ({ year, franchise, preSlot: i + 1, oddsFirst, pickWon }));

/** 14 wiki rows, slot i won pick `order[i]`; franchise ids are 1000+i except where overridden. */
function fullWiki(year: number, order: number[], over: Record<number, number> = {}): LotteryRow[] {
  return order.map((pickWon, i) => ({ year, franchise: over[i + 1] ?? 1000 + i, preSlot: i + 1, oddsFirst: 0.1 + i / 1000, pickWon }));
}
const perm14 = [4, 2, 3, 5, 1, 6, 7, 8, 9, 10, 11, 12, 13, 14];

describe('buildLottery', () => {
  it('prefers the wikipedia lottery section', () => {
    const w = fullWiki(2006, perm14, { 1: LAC });
    const out = buildLottery({
      wiki: w,
      picks: [pick(2006, 4, LAC, LAC)],
      teamSeasons: [ts(2005, LAC, 20, 62), ts(2005, DAL, 60, 22, 2)],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ year: 2006, pickKey: '2006-1-1610612746', preSlot: 1, pickWon: 4, source: 'wiki', tieUnresolved: false });
    expect(out[0].oddsFirst).toBeCloseTo(0.1);
  });

  it('derives slot and odds from team_seasons when wikipedia has none', () => {
    // 1990: 11 lottery teams; the Clippers had the third-worst record of them.
    const lottery = [[DAL, 10], [MIN, 15], [LAC, 20], [WAS, 25], [SAC, 27], [PHI, 29], [MIL, 31], [GSW, 33], [DEN, 35], [MIA, 37], [DET, 40]] as const;
    const teamSeasons = [
      ...lottery.map(([id, w]) => ts(1989, id, w, 82 - w, 0)),
      ts(1989, LAL, 63, 19, 4), // playoff team: not in the lottery
    ];
    const out = buildLottery({ wiki: [], picks: [pick(1990, 3, LAC, LAC)], teamSeasons });
    expect(out[0]).toMatchObject({ year: 1990, preSlot: 3, pickWon: 3, source: 'derived', tieUnresolved: false });
    expect(out[0].oddsFirst).toBeCloseTo(9 / 66);
  });

  it('gives equal odds in 1985', () => {
    const ids = [DAL, MIN, LAC, WAS, SAC, PHI, MIL];
    const teamSeasons = ids.map((id, i) => ts(1984, id, 20 + i, 62 - i, 0));
    const out = buildLottery({ wiki: [], picks: [pick(1985, 5, LAC, LAC)], teamSeasons });
    expect(out[0].oddsFirst).toBeCloseTo(1 / 7);
    expect(out[0].preSlot).toBe(3);
  });

  it('flags tied records tieUnresolved', () => {
    const rows = [[DAL, 10], [MIN, 20], [LAC, 20], [WAS, 25], [SAC, 27], [PHI, 29], [MIL, 31], [GSW, 33], [DEN, 35], [MIA, 37], [DET, 40]] as const;
    const teamSeasons = rows.map(([id, w]) => ts(1989, id, w, 82 - w, 0));
    const out = buildLottery({ wiki: [], picks: [pick(1990, 3, LAC, LAC)], teamSeasons });
    expect(out[0].tieUnresolved).toBe(true);
    expect(out[0].preSlot).toBe(2); // the lower-numbered tied slot
    expect(out[0].oddsFirst).toBeNull(); // weighted era: tied slots have different odds
  });

  it('writes only pickWon when team_seasons is empty', () => {
    const out = buildLottery({ wiki: [], picks: [pick(1998, 1, LAC, LAC)], teamSeasons: [] });
    expect(out).toEqual([{ year: 1998, pickKey: '1998-1-1610612746', preSlot: null, oddsFirst: null, pickWon: 1, source: 'derived', tieUnresolved: false, flags: [] }]);
  });

  it('includes picks the Clippers originated but traded away, and skips unrelated and non-lottery picks', () => {
    const out = buildLottery({
      wiki: [],
      picks: [
        pick(2000, 2, LAC, BOS), // originated with LAC, owned by BOS
        pick(2000, 5, ATL, LAC), // owned by LAC
        pick(2000, 6, NYK, NYK), // unrelated
        pick(2000, 20, LAC, LAC), // not a lottery pick
        pick(2000, 30, LAC, LAC, { round: 2 }), // round 2
        pick(2000, 7, LAC, LAC, { status: 'future', overall: null }),
        pick(1984, 3, LAC, LAC), // before the lottery
      ],
      teamSeasons: [],
    });
    expect(out.map((o) => o.pickWon)).toEqual([2, 5]);
  });

  it('falls back to derived, with a flag, when the wikipedia rows are not a permutation of 1..N', () => {
    const bad = fullWiki(2008, [2, 2, 3, 5, 6, 7, 8, 9, 1, 10, 11, 12, 13, 14]);
    const out = buildLottery({ wiki: bad, picks: [pick(2008, 2, LAC, LAC)], teamSeasons: [] });
    expect(out[0].source).toBe('derived');
    expect(out[0].preSlot).toBeNull();
    expect(out[0].flags).toContain('wiki_not_permutation');
    const short = fullWiki(2008, perm14).slice(1);
    expect(buildLottery({ wiki: short, picks: [pick(2008, 2, LAC, LAC)], teamSeasons: [] })[0].flags).toContain('wiki_not_permutation');
  });

  it('flags a year whose wikipedia lottery section was unreadable', () => {
    const out = buildLottery({ wiki: [], picks: [pick(2008, 2, LAC, LAC)], teamSeasons: [], wikiFailedYears: [2008] });
    expect(out[0].flags).toContain('wiki_unreadable');
  });

  it('gives a derived 1997 row null odds (expansion teams were ineligible for #1)', () => {
    const ids = [DAL, MIN, LAC, WAS, SAC, PHI, MIL, GSW, DEN, MIA, DET, ORL, BOS];
    const teamSeasons = ids.map((id, i) => ts(1996, id, 20 + i, 62 - i, 0));
    const out = buildLottery({ wiki: [], picks: [pick(1997, 4, LAC, LAC)], teamSeasons });
    expect(out[0].preSlot).toBe(3);
    expect(out[0].oddsFirst).toBeNull();
  });

  it('leaves the slot null when the season has an unknown playoff result', () => {
    const teamSeasons = [ts(1989, LAC, 20, 62, null), ts(1989, DAL, 10, 72, 0)];
    const out = buildLottery({ wiki: [], picks: [pick(1990, 3, LAC, LAC)], teamSeasons });
    expect(out[0].preSlot).toBeNull();
    expect(out[0].flags).toContain('team_seasons_incomplete');
  });

  it('leaves the slot null when the non-playoff count disagrees with the format', () => {
    const teamSeasons = [ts(1989, LAC, 20, 62, 0), ts(1989, DAL, 10, 72, 0)];
    const out = buildLottery({ wiki: [], picks: [pick(1990, 3, LAC, LAC)], teamSeasons });
    expect(out[0].preSlot).toBeNull();
    expect(out[0].flags).toContain('team_count_mismatch');
  });
});

describe('LOTTERY_FORMATS', () => {
  const fmt = (y: number) => LOTTERY_FORMATS.find((f) => f.firstYear <= y && (f.lastYear == null || y <= f.lastYear))!;
  it('covers every year from 1985 once', () => {
    for (let y = 1985; y <= 2030; y++) expect(LOTTERY_FORMATS.filter((f) => f.firstYear <= y && (f.lastYear == null || y <= f.lastYear))).toHaveLength(1);
  });
  it('has the 2019-2026 odds', () => {
    expect(fmt(2019).oddsFirst.slice(0, 4)).toEqual([0.14, 0.14, 0.14, 0.125]);
    expect(fmt(2019).teams).toBe(14);
    expect(fmt(2019).oddsFirst.reduce((a, b) => (a ?? 0) + (b ?? 0), 0)).toBeCloseTo(1);
  });
  it('has the 1990-93 odds in sixty-sixths', () => {
    expect(fmt(1991).oddsFirst[0]).toBeCloseTo(11 / 66);
    expect(fmt(1991).oddsFirst.reduce((a, b) => (a ?? 0) + (b ?? 0), 0)).toBeCloseTo(1);
  });
  it('has the 2005-2018 odds summing to one', () => {
    expect(fmt(2010).oddsFirst[0]).toBe(0.25);
    expect(fmt(2010).oddsFirst.reduce((a, b) => (a ?? 0) + (b ?? 0), 0)).toBeCloseTo(1);
  });
  it('leaves odds the article does not give as null', () => {
    expect(fmt(2027).oddsFirst.every((o) => o === null)).toBe(true);
    expect(fmt(2027).teams).toBe(16);
  });
});
