import { describe, expect, it } from 'vitest';
import { NBA_TEAM_IDS } from '../nba-teams.js';
import { buildIndex, type PersonRow } from './people.js';
import { reconcileMoves, type ReconcileInput } from './reconcile-moves.js';
import type { MovePart, ParsedMove } from './types.js';

const { LAC, OKC, HOU, DEN, MIA, ATL } = NBA_TEAM_IDS;

function mv(sourceKey: string, date: string, parts: MovePart[], extra: Partial<ParsedMove> = {}): ParsedMove {
  return { sourceKey, date, kind: 'trade', parts, involvesClippers: true, complete: parts.every((p) => !p.gap), ...extra };
}
const player = (from: number | null, to: number | null, name: string, ids: { bbrefId?: string; nbaPersonId?: number } = {}): MovePart => ({
  from, to, kind: 'player', person: { name, ...ids },
});
const pick = (from: number, to: number, year: number, round: number, extra: Partial<NonNullable<MovePart['pick']>> = {}): MovePart => ({
  from, to, kind: 'pick', pick: { year, round, ...extra },
});
const considerations = (from: number, to: number): MovePart => ({ from, to, kind: 'pick', text: 'draft consideration', gap: 'pick_unidentified' });

const person = (personKey: string, displayName: string, nbaPersonId: number | null = null): PersonRow => ({
  personKey, kind: 'player', displayName, birthdate: null, nbaPersonId, playerId: null,
});
/** Everyone the fixtures name, so name-only (Wikipedia) refs resolve to their BBRef key through the index. */
const INDEX = buildIndex([
  person('jaricma01', 'Marko Jaric'), person('cassesa01', 'Sam Cassell'), person('georgpa01', 'Paul George', 202331),
  person('crawfja01', 'Jamal Crawford', 2037), person('robinje02', 'Jerome Robinson'), person('ablea01', 'Aaron Able', 11),
  person('brownbo01', 'Bobby Brown'), person('coleca01', 'Carl Cole'), person('onlyb01', 'Only Bbref'),
  person('mcgruro01', 'Rodney McGruder', 7), person('stash01', 'Euro Stash'), person('flipfl01', 'Flip Flop', 3),
  person('joexx01', 'Joe X'), person('zednew01', 'Zed New'), person('willima04', 'Marcus Williams'),
], new Map());
const run = (input: Omit<ReconcileInput, 'index'>) => reconcileMoves({ ...input, index: INDEX });

describe('reconcileMoves', () => {
  it('merges the same trade dated a day apart across sources', () => {
    // Before 2015-16: BBRef is the base, the earliest date wins.
    const bbref = mv('bbref:2005-02-24:trade:x', '2005-02-24', [
      player(LAC, DEN, 'Marko Jaric', { bbrefId: 'jaricma01' }),
      player(DEN, LAC, 'Sam Cassell', { bbrefId: 'cassesa01' }),
    ]);
    const wiki = mv('wiki:2004–05 Los Angeles Clippers season#3', '2005-02-23', [
      player(LAC, DEN, 'Marko Jarić'),
      player(DEN, LAC, 'Sam Cassell'),
    ]);
    const out = run({ bbref: [bbref], wiki: [wiki], nba: [] });
    expect(out).toHaveLength(1);
    expect(out[0].sources.sort()).toEqual([bbref.sourceKey, wiki.sourceKey].sort());
    expect(out[0].date).toBe('2005-02-23');
    expect(out[0].parts).toHaveLength(2);
    expect(out[0].conflicts).toEqual([]);
    expect(out[0].complete).toBe(true);
    // Ids from every source end up on the merged person.
    expect(out[0].parts[0].person).toMatchObject({ bbrefId: 'jaricma01' });
  });

  it('does not merge moves 4 days apart, of a different kind, or with no people in common', () => {
    const a = mv('bbref:a', '2005-02-24', [player(LAC, DEN, 'Marko Jaric', { bbrefId: 'jaricma01' })]);
    const far = mv('wiki:p#1', '2005-02-28', [player(LAC, DEN, 'Marko Jaric')]);
    const other = mv('wiki:p#2', '2005-02-24', [player(LAC, DEN, 'Someone Else')]);
    const kind = mv('nba:Waive 1:1', '2005-02-24', [player(LAC, null, 'Marko Jaric', { nbaPersonId: 1 })], { kind: 'waiver' });
    const out = run({ bbref: [a], wiki: [far, other], nba: [kind] });
    expect(out).toHaveLength(4);
    expect(out.every((m) => m.sources.length === 1)).toBe(true);
  });

  it('compares people through the people index (bbrefId vs nbaPersonId vs name)', () => {
    const people: PersonRow[] = [
      { personKey: 'georgpa01', kind: 'player', displayName: 'Paul George', birthdate: null, nbaPersonId: 202331, playerId: '1' },
    ];
    const index = buildIndex(people, new Map());
    const nba = mv('nba:Trade 9', '2019-07-10', [player(OKC, LAC, 'P. George (spelled oddly)', { nbaPersonId: 202331 })]);
    const bbref = mv('bbref:pg', '2019-07-10', [player(OKC, LAC, 'Paul George', { bbrefId: 'georgpa01' })]);
    const out = reconcileMoves({ bbref: [bbref], wiki: [], nba: [nba], index });
    expect(out).toHaveLength(1);
    expect(out[0].parts[0].person).toEqual({ name: 'P. George (spelled oddly)', nbaPersonId: 202331, bbrefId: 'georgpa01' });
  });

  it('fills a draft consideration from the bbref later-selected pick', () => {
    const nba = mv('nba:Trade 1', '2017-06-22', [
      player(LAC, ATL, 'Jamal Crawford', { nbaPersonId: 2037 }),
      considerations(ATL, LAC),
    ]);
    const bbref = mv('bbref:jc', '2017-06-22', [
      player(LAC, ATL, 'Jamal Crawford', { bbrefId: 'crawfja01' }),
      pick(ATL, LAC, 2018, 1, { selected: { bbrefId: 'robinje02', name: 'Jerome Robinson' } }),
    ]);
    const out = run({ bbref: [bbref], wiki: [], nba: [nba] });
    expect(out).toHaveLength(1);
    const p = out[0].parts.find((x) => x.kind === 'pick')!;
    expect(p.gap).toBeUndefined();
    expect(p.pick).toEqual({ year: 2018, round: 1, selected: { bbrefId: 'robinje02', name: 'Jerome Robinson' } });
    expect(p).toMatchObject({ from: ATL, to: LAC });
    expect(out[0].complete).toBe(true);
  });

  it('matches pick-only trades on pick year and round', () => {
    const bbref = mv('bbref:p', '2010-06-24', [pick(LAC, MIA, 2011, 2), pick(MIA, LAC, 2012, 2)]);
    const wiki = mv('wiki:p#1', '2010-06-24', [pick(LAC, MIA, 2011, 2), pick(MIA, LAC, 2012, 2, { originalFranchiseId: HOU })]);
    const out = run({ bbref: [bbref], wiki: [wiki], nba: [] });
    expect(out).toHaveLength(1);
    expect(out[0].parts[1].pick!.originalFranchiseId).toBe(HOU);
  });

  it('never matches or fills on vague picks', () => {
    const bbref = mv('bbref:v', '1980-10-01', [pick(LAC, MIA, 0, 0, { vague: true })]);
    const wiki = mv('wiki:v#1', '1980-10-01', [pick(LAC, MIA, 0, 0, { vague: true })]);
    expect(run({ bbref: [bbref], wiki: [wiki], nba: [] })).toHaveLength(2);
  });

  it('splits a three-team trade by wikipedia sides', () => {
    // BBRef wrote it as a two-team deal; Wikipedia shows Houston actually sent Brown.
    const bbref = mv('bbref:3t', '2008-02-20', [
      player(LAC, MIA, 'Aaron Able', { bbrefId: 'ablea01' }),
      player(MIA, LAC, 'Bobby Brown', { bbrefId: 'brownbo01' }),
      player(MIA, LAC, 'Carl Cole', { bbrefId: 'coleca01' }),
    ]);
    const wiki = mv('wiki:2007–08#2', '2008-02-20', [
      player(LAC, MIA, 'Aaron Able'),
      player(HOU, LAC, 'Bobby Brown'),
      player(MIA, LAC, 'Carl Cole'),
      player(MIA, HOU, 'Dan Dee'),
    ]);
    const out = run({ bbref: [bbref], wiki: [wiki], nba: [] });
    expect(out).toHaveLength(1);
    const brown = out[0].parts.find((p) => p.person?.name === 'Bobby Brown')!;
    expect(brown).toMatchObject({ from: HOU, to: LAC });
    expect(brown.gap).toBeUndefined();
    // Wikipedia's side that doesn't touch the Clippers (BBRef only tells the Clippers' side) is added.
    expect(out[0].parts.find((p) => p.person?.name === 'Dan Dee')).toMatchObject({ from: MIA, to: HOU });
    expect(out[0].parts).toHaveLength(4);
    expect(out[0].conflicts).toEqual([]);
  });

  it('treats a missing sender as unknown, not a disagreement', () => {
    const wiki = mv('wiki:x#1', '2008-02-20', [{ ...player(null, LAC, 'Bobby Brown'), gap: 'party_unknown' }]);
    const bbref = mv('bbref:x', '2008-02-21', [player(HOU, LAC, 'Bobby Brown', { bbrefId: 'brownbo01' })]);
    const out = run({ bbref: [bbref], wiki: [wiki], nba: [] });
    expect(out).toHaveLength(1);
    expect(out[0].parts[0]).toMatchObject({ from: HOU, to: LAC });
    expect(out[0].parts[0].gap).toBeUndefined();
    expect(out[0].conflicts).toEqual([]);
  });

  it('marks disagreeing parts source_conflict and keeps both readings', () => {
    const bbref = mv('bbref:c', '2003-07-01', [
      player(LAC, MIA, 'Aaron Able', { bbrefId: 'ablea01' }),
      player(MIA, LAC, 'Carl Cole', { bbrefId: 'coleca01' }),
      pick(MIA, LAC, 2004, 1, { originalFranchiseId: MIA }),
    ]);
    const wiki = mv('wiki:c#1', '2003-07-01', [
      player(MIA, LAC, 'Aaron Able'), // direction disagrees on the Clippers side
      player(MIA, LAC, 'Carl Cole'), // agrees, so this is the same deal
      pick(MIA, LAC, 2004, 1, { originalFranchiseId: HOU }),
      { from: MIA, to: LAC, kind: 'cash', text: 'cash' },
    ]);
    const out = run({ bbref: [bbref], wiki: [wiki], nba: [] });
    expect(out).toHaveLength(1);
    const m = out[0];
    // Base (BBRef) reading kept.
    expect(m.parts).toHaveLength(3);
    expect(m.parts[0]).toMatchObject({ from: LAC, to: MIA, gap: 'source_conflict' });
    expect(m.parts[1].gap).toBeUndefined();
    expect(m.parts[2].pick!.originalFranchiseId).toBe(MIA);
    expect(m.parts[2].gap).toBe('source_conflict');
    expect(m.complete).toBe(false);
    expect(m.conflicts).toHaveLength(3);
    const c0 = m.conflicts.find((c) => c.partIndex === 0)!;
    expect(c0.readings).toHaveLength(2);
    expect(c0.readings[0]).toMatch(/^bbref: .*LAC→MIA/);
    expect(c0.readings[1]).toMatch(/^wiki: .*MIA→LAC/);
    // A part only the other source has: base reading (absent) kept, both readings recorded.
    expect(m.conflicts.map((c) => c.partIndex).sort()).toEqual([0, 2, null]);
    const extra = m.conflicts.find((c) => c.partIndex === null)!;
    expect(extra.readings[0]).toMatch(/^bbref: \(absent\)/);
    expect(extra.readings[1]).toMatch(/^wiki: .*cash/);
  });

  it('keeps nba transaction_key when nba is a source', () => {
    const nba = mv('nba:Trade 42', '2019-07-10', [player(OKC, LAC, 'Paul George', { nbaPersonId: 202331 })]);
    const bbref = mv('bbref:2019-07-07:trade:pg', '2019-07-07', [player(OKC, LAC, 'Paul George', { bbrefId: 'georgpa01' })]);
    const wiki = mv('wiki:2019–20#1', '2019-07-08', [player(OKC, LAC, 'Paul George')]);
    const out = run({ bbref: [bbref], wiki: [wiki], nba: [nba] });
    expect(out).toHaveLength(1);
    expect(out[0].transactionKey).toBe('nba:Trade 42');
    expect(out[0].sources).toHaveLength(3);
    // nba: date always wins, even when another source is earlier.
    expect(out[0].date).toBe('2019-07-10');
  });

  it('passes an unmatched move from any source through on its own', () => {
    const wiki = mv('wiki:solo#1', '1999-01-01', [player(LAC, MIA, 'Only Wiki')]);
    const bbref = mv('bbref:solo', '1998-01-01', [player(LAC, MIA, 'Only Bbref', { bbrefId: 'onlyb01' })]);
    const nba = mv('nba:Trade 7', '2020-01-01', [player(MIA, HOU, 'Not Clippers', { nbaPersonId: 7 })], { involvesClippers: false });
    const out = run({ bbref: [bbref], wiki: [wiki], nba: [nba] });
    expect(out).toHaveLength(3);
    const w = out.find((m) => m.sources[0] === wiki.sourceKey)!;
    expect(w).toMatchObject({ transactionKey: wiki.sourceKey, sources: [wiki.sourceKey], conflicts: [], date: '1999-01-01' });
    expect(out.find((m) => m.transactionKey === 'nba:Trade 7')!.involvesClippers).toBe(false);
  });

  it('unions notes across sources', () => {
    const bbref = mv('bbref:n', '2010-06-24', [player(LAC, MIA, 'Aaron Able', { bbrefId: 'ablea01' })], { notes: ['a', 'b'] });
    const wiki = mv('wiki:n#1', '2010-06-24', [player(LAC, MIA, 'Aaron Able')], { notes: ['b', 'c'] });
    const out = run({ bbref: [bbref], wiki: [wiki], nba: [] });
    expect(out).toHaveLength(1);
    expect(out[0].notes).toEqual(['a', 'b', 'c']);
  });

  it('adds what NBA.com hides (draft rights, cash) without calling it a conflict', () => {
    const nba = mv('nba:Trade 5', '2019-07-06', [player(LAC, OKC, 'Aaron Able', { nbaPersonId: 11 })]);
    const bbref = mv('bbref:h', '2019-07-06', [
      player(LAC, OKC, 'Aaron Able', { bbrefId: 'ablea01' }),
      { from: OKC, to: LAC, kind: 'draft_rights', person: { bbrefId: 'stash01', name: 'Euro Stash' } },
      { from: LAC, to: OKC, kind: 'cash', text: '$1M cash' },
    ]);
    const wiki = mv('wiki:h#1', '2019-07-06', [player(LAC, OKC, 'Aaron Able'), player(OKC, LAC, 'Euro Stash'), { from: LAC, to: OKC, kind: 'cash', text: 'cash' }]);
    const out = run({ bbref: [bbref], wiki: [wiki], nba: [nba] });
    expect(out).toHaveLength(1);
    expect(out[0].parts.map((p) => p.person?.name ?? p.text)).toEqual(['Aaron Able', 'Euro Stash', '$1M cash']);
    expect(out[0].conflicts).toEqual([]);
  });

  it('lets a vague pick stand for a pick the deal already has going the same way', () => {
    const bbref = mv('bbref:v2', '2011-12-14', [player(LAC, MIA, 'Aaron Able', { bbrefId: 'ablea01' }), pick(MIA, LAC, 2012, 1)]);
    const wiki = mv('wiki:v2#1', '2011-12-14', [player(LAC, MIA, 'Aaron Able'), pick(MIA, LAC, 0, 1, { vague: true })]);
    const out = run({ bbref: [bbref], wiki: [wiki], nba: [] });
    expect(out[0].parts).toHaveLength(2);
    expect(out[0].conflicts).toEqual([]);
  });

  it('fills an end one source leaves unstated', () => {
    // NBA.com doesn't say where a waiver claim came from.
    const nba = mv('nba:AwardedOnWaivers 1:7', '2019-04-09', [player(null, LAC, 'Rodney McGruder', { nbaPersonId: 7 })], { kind: 'claim' });
    const bbref = mv('bbref:claim', '2019-04-09', [player(MIA, LAC, 'Rodney McGruder', { bbrefId: 'mcgruro01' })], { kind: 'claim' });
    const out = run({ bbref: [bbref], wiki: [], nba: [nba] });
    expect(out).toHaveLength(1);
    expect(out[0].parts[0]).toMatchObject({ from: MIA, to: LAC });
    expect(out[0].conflicts).toEqual([]);
  });

  it('sends a player traded twice in one day to the deal that agrees on his direction', () => {
    const nbaIn = mv('nba:Trade 21', '2023-11-01', [player(MIA, LAC, 'Flip Flop', { nbaPersonId: 3 }), player(LAC, MIA, 'Big Star', { nbaPersonId: 4 })]);
    const nbaOut = mv('nba:Trade 22', '2023-11-01', [player(LAC, HOU, 'Flip Flop', { nbaPersonId: 3 })]);
    // Listed so the first-come match would be wrong.
    const bbOut = mv('bbref:out', '2023-11-01', [player(LAC, HOU, 'Flip Flop', { bbrefId: 'flipfl01' })]);
    const bbIn = mv('bbref:in', '2023-11-01', [player(MIA, LAC, 'Flip Flop', { bbrefId: 'flipfl01' })]);
    const out = run({ bbref: [bbOut, bbIn], wiki: [], nba: [nbaIn, nbaOut] });
    expect(out).toHaveLength(2);
    expect(out.find((m) => m.transactionKey === 'nba:Trade 21')!.sources).toContain('bbref:in');
    expect(out.find((m) => m.transactionKey === 'nba:Trade 22')!.sources).toContain('bbref:out');
    expect(out.every((m) => m.conflicts.length === 0)).toBe(true);
  });

  it('joins a deal Wikipedia split over two rows', () => {
    const bbref = mv('bbref:r', '2013-07-10', [player(LAC, MIA, 'Aaron Able', { bbrefId: 'ablea01' }), player(HOU, LAC, 'Bobby Brown', { bbrefId: 'brownbo01' })]);
    const w1 = mv('wiki:r#2', '2013-07-10', [player(LAC, MIA, 'Aaron Able'), player(HOU, LAC, 'Bobby Brown')]);
    const w2 = mv('wiki:r#3', '2013-07-10', [player(HOU, LAC, 'Bobby Brown')], { notes: ['sign-and-trade'] });
    const out = run({ bbref: [bbref], wiki: [w1, w2], nba: [] });
    expect(out).toHaveLength(1);
    expect(out[0].sources).toEqual(['bbref:r', 'wiki:r#2', 'wiki:r#3']);
    expect(out[0].notes).toEqual(['sign-and-trade']);
  });

  it('does not merge on a person who goes the other way (a different event)', () => {
    const nba = mv('nba:Trade A', '2020-01-01', [player(MIA, LAC, 'Flip Flop', { nbaPersonId: 3 })]);
    const bbref = mv('bbref:b', '2020-01-03', [player(LAC, HOU, 'Flip Flop', { bbrefId: 'flipfl01' }), player(HOU, LAC, 'Joe X', { bbrefId: 'joexx01' })]);
    const out = run({ bbref: [bbref], wiki: [], nba: [nba] });
    expect(out).toHaveLength(2);
    expect(out.find((m) => m.transactionKey === 'nba:Trade A')!.parts.map((p) => p.person?.name)).toEqual(['Flip Flop']);
  });

  it('does not let a leftover Wikipedia row bring a different event into a deal', () => {
    const bbref = mv('bbref:r', '2013-07-10', [player(LAC, MIA, 'Aaron Able', { bbrefId: 'ablea01' }), player(HOU, LAC, 'Bobby Brown', { bbrefId: 'brownbo01' })]);
    const w1 = mv('wiki:r#2', '2013-07-10', [player(LAC, MIA, 'Aaron Able'), player(HOU, LAC, 'Bobby Brown')]);
    const w2 = mv('wiki:r#3', '2013-07-10', [player(HOU, LAC, 'Bobby Brown'), player(LAC, HOU, 'Zed New')]);
    const out = run({ bbref: [bbref], wiki: [w1, w2], nba: [] });
    expect(out).toHaveLength(2);
    expect(out.find((m) => m.transactionKey === 'bbref:r')!.parts.some((p) => p.person?.name === 'Zed New')).toBe(false);
  });

  it('does not match a player trade to a pick-only deal on a shared pick', () => {
    const bbref = mv('bbref:p1', '2010-06-24', [player(LAC, MIA, 'Aaron Able', { bbrefId: 'ablea01' }), pick(MIA, LAC, 2011, 2)]);
    const wiki = mv('wiki:p2#1', '2010-06-24', [pick(MIA, LAC, 2011, 2), { from: LAC, to: MIA, kind: 'cash', text: 'cash' }]);
    expect(run({ bbref: [bbref], wiki: [wiki], nba: [] })).toHaveLength(2);
  });

  it('never merges on a lone name match, but lets two agreeing names corroborate', () => {
    // NBA id 99 isn't in the index, so "Marcus Williams" vs willima04 is a name match only.
    const nba = mv('nba:Signing 1:99', '2008-07-01', [player(null, LAC, 'Marcus Williams', { nbaPersonId: 99 })], { kind: 'signing' });
    const bbref = mv('bbref:mw', '2008-07-01', [player(null, LAC, 'Marcus Williams', { bbrefId: 'willima04' })], { kind: 'signing' });
    expect(run({ bbref: [bbref], wiki: [], nba: [nba] })).toHaveLength(2);

    const nba2 = mv('nba:Trade 77', '2018-07-01', [player(LAC, MIA, 'Marcus Williams', { nbaPersonId: 99 }), player(MIA, LAC, 'Carl Cole', { nbaPersonId: 98 })]);
    const bb2 = mv('bbref:mw2', '2018-07-01', [player(LAC, MIA, 'Marcus Williams', { bbrefId: 'willima04' }), player(MIA, LAC, 'Carl Cole', { bbrefId: 'coleca01' })]);
    expect(run({ bbref: [bb2], wiki: [], nba: [nba2] })).toHaveLength(1);
  });

  it('treats a player NBA.com does not list as a conflict, and leaves the move incomplete', () => {
    const nba = mv('nba:Trade 8', '2019-07-06', [player(LAC, OKC, 'Aaron Able', { nbaPersonId: 11 })]);
    const bbref = mv('bbref:x8', '2019-07-06', [player(LAC, OKC, 'Aaron Able', { bbrefId: 'ablea01' }), player(OKC, LAC, 'Carl Cole', { bbrefId: 'coleca01' })]);
    const out = run({ bbref: [bbref], wiki: [], nba: [nba] });
    expect(out).toHaveLength(1);
    expect(out[0].parts.map((p) => p.person?.name)).toEqual(['Aaron Able']);
    expect(out[0].conflicts).toEqual([{ partIndex: null, readings: ['nba: (absent)', 'bbref: Carl Cole OKC→LAC'] }]);
    expect(out[0].parts.every((p) => !p.gap)).toBe(true);
    expect(out[0].complete).toBe(false);
  });

  it('does not mutate its input', () => {
    const nba = mv('nba:Trade 1', '2017-06-22', [player(LAC, ATL, 'Jamal Crawford', { nbaPersonId: 2037 }), considerations(ATL, LAC)]);
    const bbref = mv('bbref:jc', '2017-06-22', [player(LAC, ATL, 'Jamal Crawford', { bbrefId: 'crawfja01' }), pick(ATL, LAC, 2018, 1)]);
    const snapshot = JSON.stringify([nba, bbref]);
    run({ bbref: [bbref], wiki: [], nba: [nba] });
    expect(JSON.stringify([nba, bbref])).toBe(snapshot);
  });
});
