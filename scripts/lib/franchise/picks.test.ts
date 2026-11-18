import { describe, expect, it } from 'vitest';
import { NBA_TEAM_IDS } from '../nba-teams.js';
import type { DraftRow } from './bbref-tables.js';
import { buildPicks, espnChain, type DraftInput, type PickRow } from './picks.js';
import type { MergedMove } from './reconcile-moves.js';
import type { MovePart } from './types.js';
import type { DraftPickRow } from './wiki-draft.js';

const { LAC, OKC, MIA, CHA, CLE, PHX, PHI, DEN, BKN, MIL, MIN, BOS, LAL, NOP, ATL } = NBA_TEAM_IDS;
const NOW = 2027;

function mv(key: string, date: string, parts: MovePart[], notes?: string[]): MergedMove {
  return {
    sourceKey: key, date, kind: 'trade', parts, involvesClippers: true, complete: parts.every((p) => !p.gap),
    sources: [key], transactionKey: key, conflicts: [], ...(notes ? { notes } : {}),
  };
}
const pick = (from: number, to: number, year: number, round: number, extra: Partial<NonNullable<MovePart['pick']>> = {}): MovePart => ({
  from, to, kind: 'pick', pick: { year, round, ...extra },
});
const swap = (from: number, to: number, year: number, round: number): MovePart => ({
  from, to, kind: 'swap', swap: { year, round, franchiseA: from, franchiseB: to },
});
const row = (year: number, round: number, overall: number, name: string, team: number, chain: number[] = [], tradedTo: number[] = []): DraftPickRow => ({
  year, round, overall, name, teamFranchise: team, chain, tradedTo,
});
const bb = (year: number, round: number, overall: number, name: string, bbrefId: string | null): DraftRow => ({ year, round, overall, name, bbrefId });
const draft = (d: Partial<DraftInput> = {}): DraftInput => ({ bbref: [], wiki: [], espn: new Map(), ...d });
/** Rows other than the Clippers' own picks in the next seven drafts, which every run creates. */
const traded = (picks: PickRow[]) => picks.filter((p) => !(p.originalFranchiseId === LAC && p.year >= NOW));

describe('buildPicks', () => {
  it('keeps one pick row across two trades', () => {
    const jaquez = { bbrefId: 'jaqueja01', name: 'Jaime Jaquez Jr.' };
    const moves = [
      mv('bbref:a', '2019-07-06', [pick(MIA, LAC, 2023, 1, { selected: jaquez })]),
      mv('bbref:b', '2019-07-10', [pick(LAC, OKC, 2023, 1, { selected: { name: 'Jaime Jaquez' }, originalFranchiseId: MIA })]),
    ];
    const out = buildPicks(moves, draft({ wiki: [row(2023, 1, 18, 'Jaime Jaquez Jr.', MIA)] }), NOW);
    expect(out.picks.filter((p) => p.year === 2023)).toHaveLength(1);
    expect(out.moves.map((m) => m.parts[0].pickKey)).toEqual(['2023-1-MIA', '2023-1-MIA']);
    expect(out.picks[0]).toMatchObject({
      pickKey: '2023-1-MIA', originalFranchiseId: MIA, status: 'used', overall: 18, selectedPersonKey: 'jaqueja01', finalOwnerFranchiseId: MIA,
    });
    // The input moves are not changed.
    expect(moves[0].parts[0].pickKey).toBeUndefined();
  });

  it('reports a chain with a missing hop', () => {
    const wiki = [row(2012, 2, 40, 'Some Player', LAC, [CLE, PHX]), row(2012, 1, 10, 'Own Pick', LAC)];
    const bbref = [bb(2012, 2, 40, 'Some Player', 'playeso01'), bb(2012, 1, 10, 'Own Pick', 'pickow01')];
    const moves = [mv('bbref:x', '2011-12-20', [pick(PHX, LAC, 2012, 2, { selected: { bbrefId: 'playeso01', name: 'Some Player' } })])];
    const out = buildPicks(moves, draft({ wiki, bbref }), NOW);
    expect(out.moves[0].parts[0].pickKey).toBe('2012-2-CLE');
    // CLE -> PHX has no stored trade part; PHX -> LAC does. The Clippers' own pick has no hops to check.
    expect(out.breaks).toEqual([{ pickKey: '2012-2-CLE', missingHop: [CLE, PHX] }]);
  });

  it('traces a chain back from the Clippers whatever order Wikipedia lists the via teams in', () => {
    // The pick went MIN -> HOU -> ATL -> LAC; Wikipedia writes "from MIN via ATL and HOU".
    const { HOU } = NBA_TEAM_IDS;
    const wiki = [row(2025, 2, 51, 'Mohamed Diawara', LAC, [MIN, ATL, HOU])];
    const sel = { bbrefId: 'diawamo01', name: 'Mohamed Diawara' };
    const moves = [
      mv('nba:1', '2023-07-08', [pick(HOU, ATL, 2025, 2, { selected: sel, originalFranchiseId: MIN })]),
      mv('nba:2', '2025-02-06', [pick(ATL, LAC, 2025, 2, { selected: sel, originalFranchiseId: MIN })]),
    ];
    const out = buildPicks(moves, draft({ wiki, bbref: [bb(2025, 2, 51, 'Mohamed Diawara', 'diawamo01')] }), NOW);
    expect(out.breaks).toEqual([{ pickKey: '2025-2-MIN', missingHop: [MIN, HOU] }]);
  });

  it('links the 2005 2nd via Daniel Ewing to the CHA-owned pick', () => {
    const wiki = [row(2005, 2, 32, 'Daniel Ewing', LAC, [CHA]), row(2005, 2, 31, 'Other Guy', CHA)];
    const bbref = [bb(2005, 2, 32, 'Daniel Ewing', 'ewingda01')];
    const espn = new Map([['2005-32', 'from Charlotte']]);
    const moves = [mv('bbref:2004-07-29:trade:x', '2004-07-29', [
      { from: LAC, to: CHA, kind: 'player', person: { bbrefId: 'elyme01', name: 'Melvin Ely' } },
      pick(CHA, LAC, 2005, 2, { selected: { name: 'Daniel Ewing' } }),
    ])];
    const out = buildPicks(moves, draft({ wiki, bbref, espn }), NOW);
    const part = out.moves[0].parts[1];
    expect(part.pickKey).toBe('2005-2-CHA');
    expect(part.gap).toBeUndefined();
    expect(out.picks.find((p) => p.pickKey === '2005-2-CHA')).toMatchObject({
      year: 2005, round: 2, originalFranchiseId: CHA, status: 'used', overall: 32, selectedPersonKey: 'ewingda01', finalOwnerFranchiseId: LAC,
    });
    expect(out.breaks).toEqual([]);
  });

  it('does not let draft rows with no stated origin claim the same pick', () => {
    const { IND } = NBA_TEAM_IDS;
    const wiki = [
      row(1978, 3, 46, 'Hollis Copeland', DEN, [LAC]), // explicitly the Clippers' own 3rd
      row(1978, 3, 48, 'Mike Santos', LAC), // no "(from X)"; a trade brought it from IND, but IND's isn't stated as its origin
      row(1978, 3, 51, 'Ricky Gallon', LAC), // no "(from X)" and no trade: loses the own-pick claim to Copeland
      row(1978, 3, 65, 'Marvin Delph', LAC), // no "(from X)", but a source states the original
      row(1989, 2, 31, 'Jeff Martin', LAC), // the only row left claiming the Clippers' own 2nd: keeps it
      row(1989, 2, 33, 'Jay Edwards', LAC),
    ];
    const bbref = [bb(1978, 3, 48, 'Mike Santos', 'santomi01'), bb(1978, 3, 51, 'Ricky Gallon', 'gallori01'), bb(1978, 3, 65, 'Marvin Delph', 'delphma01'),
      bb(1989, 2, 31, 'Jeff Martin', 'martije01'), bb(1989, 2, 33, 'Jay Edwards', 'edwarja02')];
    const moves = [
      mv('bbref:1', '1977-10-18', [pick(IND, LAC, 1978, 3, { selected: { bbrefId: 'santomi01', name: 'Mike Santos' } })]),
      mv('bbref:2', '1978-01-31', [pick(PHI, LAC, 1978, 3, { selected: { name: 'Marvin Delph' }, originalFranchiseId: PHI })]),
      mv('bbref:3', '1988-02-01', [pick(MIA, LAC, 1989, 2, { selected: { name: 'Jay Edwards' } })]),
    ];
    const out = buildPicks(moves, draft({ wiki, bbref }), NOW);
    expect(out.moves.map((m) => m.parts[0].pickKey)).toEqual([undefined, '1978-3-PHI', undefined]);
    expect(out.moves[0].parts[0].gap).toBe('pick_unidentified');
    const byOverall = (y: number, o: number) => traded(out.picks).filter((p) => p.year === y && p.overall === o).map((p) => p.pickKey);
    expect(byOverall(1978, 46)).toEqual(['1978-3-LAC']);
    expect(byOverall(1978, 48)).toEqual([]);
    expect(byOverall(1978, 51)).toEqual([]);
    expect(byOverall(1978, 65)).toEqual(['1978-3-PHI']);
    expect(byOverall(1989, 31)).toEqual(['1989-2-LAC']);
    expect(byOverall(1989, 33)).toEqual([]);
    expect(out.unkeyed.map((u) => u.name)).toEqual(['Mike Santos', 'Ricky Gallon', 'Jay Edwards']);
  });

  it('never takes a trade sender as a draft row\'s original (the 1982 HOU shape)', () => {
    const { HOU } = NBA_TEAM_IDS;
    // #32 has no "(from X)"; the trade that brought it to the Clippers came from HOU. HOU's own chainless #42 must
    // keep 1982-2-HOU, and #32 must not be guessed as HOU's (nor as the Clippers' own, which the trade contradicts).
    const { ATL } = NBA_TEAM_IDS;
    const wiki = [
      row(1982, 2, 32, 'Richard Anderson', LAC),
      row(1982, 2, 42, 'Houston Own', HOU, [], [LAC]), // traded to the Clippers on draft day, so it gets a row
      row(1976, 5, 80, 'Connie White', ATL), // another team's chainless row that a Clippers trade sent it: also unsettled
    ];
    const moves = [
      mv('bbref:1', '1982-06-28', [pick(HOU, LAC, 1982, 2, { selected: { bbrefId: 'anderri01', name: 'Richard Anderson' } })]),
      mv('bbref:2', '1975-01-08', [pick(LAC, ATL, 1976, 5, { selected: { bbrefId: 'whiteco02', name: 'Connie White' } })]),
    ];
    const out = buildPicks(moves, draft({ wiki, bbref: [bb(1982, 2, 32, 'Richard Anderson', 'anderri01')] }), NOW);
    expect(out.moves[0].parts[0].pickKey).toBeUndefined();
    expect(out.moves[0].parts[0].gap).toBe('pick_unidentified');
    expect(traded(out.picks).find((p) => p.overall === 32)).toBeUndefined();
    expect(traded(out.picks).find((p) => p.pickKey === '1982-2-HOU')).toMatchObject({ overall: 42, status: 'used', finalOwnerFranchiseId: LAC });
    expect(out.moves[1].parts[0].pickKey).toBeUndefined();
    expect(out.unkeyed).toEqual([
      { year: 1982, round: 2, overall: 32, name: 'Richard Anderson', teamFranchise: LAC },
      { year: 1976, round: 5, overall: 80, name: 'Connie White', teamFranchise: ATL },
    ]);
    expect(out.breaks).toEqual([]);
  });

  it('leaves a 1970 future pick unlinked with pick_unidentified', () => {
    const vague: MovePart = { from: PHI, to: LAC, kind: 'pick', pick: { year: 0, round: 0, vague: true }, text: 'a future draft pick', gap: 'pick_unidentified' };
    // Even a vague pick that names its team ("a future PHI 2nd") has no year to key.
    const named: MovePart = { from: PHI, to: LAC, kind: 'pick', pick: { year: 0, round: 2, vague: true, originalFranchiseId: PHI }, gap: 'pick_unidentified' };
    const out = buildPicks([mv('bbref:1970', '1970-11-26', [vague, named])], draft({ wiki: [row(1971, 1, 5, 'Somebody', LAC, [PHI])] }), NOW);
    for (const p of out.moves[0].parts) {
      expect(p.pickKey).toBeUndefined();
      expect(p.gap).toBe('pick_unidentified');
    }
    expect(out.moves[0].complete).toBe(false);
    expect(out.picks.map((p) => p.year)).not.toContain(0);
  });

  it('links a past pick without a selection only when exactly one draft row fits the sides', () => {
    const wiki = [
      row(1990, 2, 30, 'One', DEN, [LAC]), // LAC -> DEN: fits the first trade
      row(1990, 2, 31, 'Two', MIA),
      row(1991, 2, 40, 'Three', DEN, [LAC]), row(1991, 2, 41, 'Four', DEN, [LAC]), // two fit the second trade
    ];
    const out = buildPicks([
      mv('bbref:1', '1989-02-01', [pick(LAC, DEN, 1990, 2)]),
      mv('bbref:2', '1989-02-02', [pick(LAC, DEN, 1991, 2)]),
    ], draft({ wiki }), NOW);
    expect(out.moves[0].parts[0].pickKey).toBe('1990-2-LAC');
    expect(out.moves[1].parts[0].pickKey).toBeUndefined();
    expect(out.moves[1].parts[0].gap).toBe('pick_unidentified');
  });

  it('sets protectionsKnown=false (not unprotected) when no source states protections', () => {
    const out = buildPicks([mv('nba:1', '2023-11-01', [
      pick(LAC, PHI, 2028, 1, { originalFranchiseId: LAC }),
      pick(LAC, PHI, 2030, 1, { originalFranchiseId: LAC, protectionsText: 'protected' }),
      pick(LAC, PHI, 2031, 1, { originalFranchiseId: LAC, protectionsText: 'unprotected' }),
      pick(LAC, PHI, 2032, 1),
    ])], draft(), NOW);
    const by = (k: string) => out.picks.find((p) => p.pickKey === k);
    expect(by('2028-1-LAC')).toMatchObject({ status: 'future', protections: null, protectionsText: null, protectionsKnown: false, overall: null, finalOwnerFranchiseId: null });
    expect(by('2030-1-LAC')).toMatchObject({ protections: null, protectionsText: null, protectionsKnown: false });
    expect(by('2031-1-LAC')).toMatchObject({ protections: [], protectionsText: 'Unprotected', protectionsKnown: true });
    // A future pick nobody identifies stays unlinked.
    expect(out.moves[0].parts[3].pickKey).toBeUndefined();
    expect(out.moves[0].parts[3].gap).toBe('pick_unidentified');
  });

  it('marks a swap exercised=null until its draft', () => {
    const out = buildPicks([
      mv('nba:2', '2019-07-10', [swap(LAC, OKC, 2027, 1)]),
      mv('bbref:3', '2008-08-06', [pick(LAC, MIL, 2010, 2)], ['swap, not exercised']),
    ], draft(), NOW);
    expect(out.moves[0].parts[0].swapKey).toBe('2027-1-LAC-OKC');
    expect(out.swaps.find((s) => s.swapKey === '2027-1-LAC-OKC')).toMatchObject({
      year: 2027, round: 1, exercised: null, protections: null, protectionsText: null, protectionsKnown: false,
    });
    // A BBRef note turns a pick part into a swap that was not exercised.
    expect(out.moves[1].parts[0]).toMatchObject({ kind: 'swap', swapKey: '2010-2-LAC-MIL' });
    expect(out.moves[1].parts[0].pick).toBeUndefined();
    expect(out.swaps.find((s) => s.swapKey === '2010-2-LAC-MIL')?.exercised).toBe(false);
    expect(traded(out.picks)).toEqual([]);
  });

  it('reads did-not-convey and own-pick notes without copying their prose', () => {
    const out = buildPicks([
      mv('bbref:4', '2009-01-01', [pick(LAC, BKN, 2015, 2)], ['Conditional 2015 2nd-rd pick did not convey']),
      mv('bbref:5', '2025-07-07', [pick(LAC, PHI, 2027, 2), pick(PHI, LAC, 2029, 2, { originalFranchiseId: DEN }), pick(PHI, LAC, 2029, 2)],
        ['2027 2nd-rd pick is LAC own', '2029 2nd-rd pick is DEN own', 'Utah received a trade exception.']),
    ], draft(), NOW);
    // The did-not-convey pick names no team, so it can't be keyed: it stays unlinked.
    expect(out.moves[0].parts[0].pickKey).toBeUndefined();
    expect(out.moves[0].parts[0].gap).toBe('pick_unidentified');
    expect(out.moves[1].parts.map((p) => p.pickKey)).toEqual(['2027-2-LAC', '2029-2-DEN', undefined]);
    for (const p of out.picks) expect(p.protectionsText).toBeNull();
  });

  it('marks an identified pick that did not convey as extinguished', () => {
    const out = buildPicks([
      mv('bbref:6', '2021-08-07', [pick(PHI, LAC, 2022, 2)], ['Conditional 2022 2nd-rd pick is SAC own, did not convey']),
    ], draft(), NOW);
    expect(out.moves[0].parts[0].pickKey).toBe('2022-2-SAC');
    expect(traded(out.picks)).toEqual([expect.objectContaining({ pickKey: '2022-2-SAC', status: 'extinguished', finalOwnerFranchiseId: null })]);
  });

  it('creates rows for picks the Clippers owned but traded before the draft, and forfeited picks', () => {
    const wiki = [row(2011, 1, 1, 'Kyrie Irving', CLE, [LAC]), row(2011, 1, 2, 'Someone', MIN)];
    const out = buildPicks([], draft({ wiki, forfeited: [{ year: 2001, round: 2, teamFranchise: LAC }] }), NOW);
    expect(traded(out.picks)).toEqual(expect.arrayContaining([
      expect.objectContaining({ pickKey: '2011-1-LAC', status: 'used', overall: 1, finalOwnerFranchiseId: CLE, selectedPersonKey: 'name:kyrie-irving-2011' }),
      expect.objectContaining({ pickKey: '2001-2-LAC', status: 'forfeited', overall: null }),
    ]));
    expect(traded(out.picks)).toHaveLength(2);
  });

  it("creates future rows for the Clippers' own picks in the next seven drafts", () => {
    const out = buildPicks([], draft(), NOW);
    const keys = out.picks.map((p) => p.pickKey);
    expect(keys).toEqual(['2027-1-LAC', '2027-2-LAC', '2028-1-LAC', '2028-2-LAC', '2029-1-LAC', '2029-2-LAC', '2030-1-LAC', '2030-2-LAC',
      '2031-1-LAC', '2031-2-LAC', '2032-1-LAC', '2032-2-LAC', '2033-1-LAC', '2033-2-LAC']);
    // Holding a pick says nothing about protections a trade may have put on it: still unknown.
    for (const p of out.picks) expect(p).toMatchObject({ status: 'future', protections: null, protectionsKnown: false, finalOwnerFranchiseId: null });
  });

  it('reads ESPN trade notes up to any draft-day clause', () => {
    const { GSW, POR } = NBA_TEAM_IDS;
    expect(espnChain('From BOS via BKN', 2017)).toEqual([BOS, BKN]);
    expect(espnChain('from Golden State through Denver, Boston, and Phoenix', 2010)).toEqual([GSW, DEN, BOS, PHX]);
    expect(espnChain('from Denver; Traded to Miami', 2008)).toEqual([DEN]);
    expect(espnChain('from Portland, traded to Oklahoma City for rights to R. Beaubois', 2010)).toEqual([POR]);
    expect(espnChain('Rights to Luke Babbitt traded to Portland - Pick from Denver via Charlotte', 2010)).toEqual([DEN, CHA]);
    expect(espnChain('from New York though Chicago, traded to Sacramento', 2009)).toEqual([NBA_TEAM_IDS.NYK, NBA_TEAM_IDS.CHI]);
    expect(espnChain('Traded to Portland, then Minnesota', 2006)).toEqual([]);
    expect(espnChain('from Dallas and the moon', 2006)).toBeNull();
    expect(espnChain(null, 2006)).toEqual([]);
  });

  it('cross-checks Wikipedia chains against ESPN as sets, filling an empty one from a one-team note', () => {
    const wiki = [
      row(2006, 2, 34, 'A', LAC), // ESPN fills it
      row(2006, 2, 35, 'B', LAC, [PHX]), // ESPN names another team: disputed, Wikipedia kept
      row(2017, 1, 1, 'C', PHI, [BKN, BOS]), // ESPN lists the same teams most-recent first: agreement
      row(2017, 1, 2, 'D', LAC), // ESPN names two teams for an empty chain: their order is unknown
      row(2019, 1, 4, 'E', LAL, [], [NOP, ATL]), // ESPN names the drafting team and a draft-day destination
    ];
    const bbref = [bb(2006, 2, 34, 'A', 'aaa01'), bb(2006, 2, 35, 'B', 'bbb01')];
    const espn = new Map([['2006-34', 'via Bobcats'], ['2006-35', 'From Denver'], ['2017-1', 'From BOS via BKN'], ['2017-2', 'From MIL via DEN'], ['2019-4', 'From LAL through NO']]);
    const out = buildPicks([], draft({ wiki, bbref, espn }), NOW);
    expect(traded(out.picks).map((p) => p.pickKey).sort()).toEqual(['2006-2-CHA', '2006-2-PHX', '2017-1-LAC']);
    expect(out.disputes).toEqual([
      { year: 2006, overall: 35, wiki: [PHX], espn: [DEN] },
      { year: 2017, overall: 2, wiki: [], espn: [MIL, DEN] },
    ]);
    expect(out.breaks).toEqual([
      { pickKey: '2006-2-CHA', missingHop: [CHA, LAC] },
      { pickKey: '2006-2-PHX', missingHop: [PHX, LAC] },
    ]);
  });
});
