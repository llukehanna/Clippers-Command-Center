import { describe, expect, it } from 'vitest';
import { NBA_TEAM_IDS } from '../nba-teams.js';
import { applyMoveOverrides, applyOverrides } from './apply-overrides.js';
import { buildPicks, type DraftInput, type PickRow } from './picks.js';
import type { MergedMove } from './reconcile-moves.js';
import { buildReport, gateFailures } from './report.js';
import { franchiseFromName } from './team-names.js';
import type { FranchiseDataset, MovePart, Override } from './types.js';
import type { DraftPickRow } from './wiki-draft.js';

const { LAC, BOS, MIA, SAC } = NBA_TEAM_IDS;

function ds(d: Partial<FranchiseDataset> = {}): FranchiseDataset {
  return {
    currentDraftYear: 2027, people: [], moves: [], picks: [], swaps: [], lottery: [], salaries: [], payrollSeasons: [],
    contracts: [], coachSeasons: [], execTerms: [], honors: [], unparsed: [], ignored: [], dropped: [], skipped: [],
    peopleUnmatched: [], peopleAmbiguous: [], breaks: [], disputes: [], unkeyed: [], skippedCategories: [], ...d,
  };
}
function mv(key: string, date: string, parts: MovePart[], extra: Partial<MergedMove> = {}): MergedMove {
  return {
    sourceKey: key, date, kind: 'trade', parts, involvesClippers: true, complete: parts.every((p) => !p.gap),
    sources: [key], transactionKey: key, conflicts: [], ...extra,
  };
}
const row = (key: string, year: number, round: number, original: number, extra: Partial<PickRow> = {}): PickRow => ({
  pickKey: key, year, round, originalFranchiseId: original, protections: null, protectionsText: null, protectionsKnown: false,
  status: 'future', overall: null, selectedPersonKey: null, finalOwnerFranchiseId: null, ...extra,
});
const wrow = (year: number, round: number, overall: number, name: string, team: number, chain: number[] = []): DraftPickRow => ({
  year, round, overall, name, teamFranchise: team, chain, tradedTo: [],
});
const draft = (wiki: DraftPickRow[], originals: DraftInput['originals'] = []): DraftInput => ({ bbref: [], wiki, espn: new Map(), originals });
const phase1 = (moves: MergedMove[], overrides: Override[], extra: { unparsed?: FranchiseDataset['unparsed']; draftRows?: Array<{ year: number; overall: number }> } = {}) =>
  applyMoveOverrides({ moves, unparsed: extra.unparsed ?? [], draftRows: extra.draftRows ?? [] }, overrides);
const player = (from: number | null, to: number | null, name: string, bbrefId?: string): MovePart => ({
  from, to, kind: 'player', person: { name, ...(bbrefId ? { bbrefId } : {}) },
});

describe('applyMoveOverrides (phase 1, before buildPicks)', () => {
  it('settles compensation as "compensation not recorded" and keeps the move incomplete', () => {
    const moves = [mv('bbref:c', '1981-10-01', [{ from: BOS, to: LAC, kind: 'pick', text: 'compensation', gap: 'pick_unidentified' }])];
    const parts: MovePart[] = [{ from: BOS, to: LAC, kind: 'other', text: 'compensation not recorded' }];
    const out = phase1(moves, [{ kind: 'move', match: { moveKey: 'bbref:c' }, replaceParts: parts, complete: false, source: 's' }]);
    expect(out.stale).toEqual([]);
    expect(out.moves[0]).toMatchObject({ parts, complete: false, conflicts: [] });
    expect(moves[0].parts[0].kind).toBe('pick'); // input untouched
  });

  it('creates a move from an unparsed line', () => {
    const line = { source: 'LAC-1982_transactions', index: 4, date: '1982-09-01', text: 'Some sentence no rule reads.' };
    const parts: MovePart[] = [player(LAC, BOS, 'Joe Smith', 'smithjo01')];
    const o: Override = { kind: 'move', match: { source: line.source, text: line.text }, create: { kind: 'trade' }, replaceParts: parts, source: 's' };
    const out = phase1([], [o], { unparsed: [line] });
    expect(out.stale).toEqual([]);
    expect(out.unparsed).toEqual([]);
    expect(out.moves).toHaveLength(1);
    const m = out.moves[0];
    expect(m).toMatchObject({ date: '1982-09-01', kind: 'trade', parts, involvesClippers: true, complete: true, conflicts: [] });
    expect(m.transactionKey).toMatch(/^override:LAC-1982_transactions#[0-9a-f]{8}$/);
    expect(m.sources).toEqual([m.transactionKey]);
    expect(phase1([], [o], { unparsed: [line] }).moves[0].transactionKey).toBe(m.transactionKey); // stable key
  });

  it('drops a move, listing it with its sources and reason', () => {
    const moves = [mv('wiki:dup', '1978-08-14', [player(BOS, LAC, 'World Free')]), mv('bbref:keep', '1978-08-04', [])];
    const out = phase1(moves, [{ kind: 'move', match: { moveKey: 'wiki:dup' }, drop: true, reason: 'same trade as bbref:keep', source: 's' }]);
    expect(out.moves.map((m) => m.transactionKey)).toEqual(['bbref:keep']);
    expect(out.dropped).toEqual([{ transactionKey: 'wiki:dup', sources: ['wiki:dup'], reason: 'same trade as bbref:keep' }]);
    const r = buildReport(ds({ moves: out.moves, dropped: out.dropped }));
    expect(r.dropped).toEqual(out.dropped);
    expect(r.counts.dropped).toBe(1);
  });

  it('merges a move into another: sources and notes unioned, ids filled, disagreements marked, nothing contradicting added', () => {
    const target = mv('bbref:t', '1978-08-04', [player(BOS, LAC, 'World B. Free'), player(LAC, BOS, 'Kevin Kunnert')], { notes: ['a'] });
    const src = mv('wiki:s', '1978-08-14', [
      player(BOS, LAC, 'World B. Free', 'freewo01'), // agrees, and has the id
      player(BOS, LAC, 'Kevin Kunnert', 'kunneke01'), // the other way
      player(LAC, BOS, 'Someone Else'), // the target lacks it
    ], { notes: ['b'] });
    const out = phase1([target, src], [{ kind: 'move', match: { moveKey: 'wiki:s' }, mergeInto: 'bbref:t', source: 's' }]);
    expect(out.stale).toEqual([]);
    expect(out.moves).toHaveLength(1);
    const m = out.moves[0];
    expect(m.transactionKey).toBe('bbref:t');
    expect(m.sources).toEqual(['bbref:t', 'wiki:s']);
    expect(m.notes).toEqual(['a', 'b']);
    expect(m.parts).toHaveLength(2);
    expect(m.parts[0].person).toEqual({ name: 'World B. Free', bbrefId: 'freewo01' });
    expect(m.parts[1].gap).toBe('source_conflict');
    expect(m.conflicts.map((c) => c.partIndex)).toEqual([1, null]);
    expect(m.complete).toBe(false);
  });

  it('reports phase-1 overrides that match nothing as stale', () => {
    const overrides: Override[] = [
      { kind: 'move', match: { moveKey: 'bbref:nope' }, replaceParts: [], source: 's' },
      { kind: 'move', match: { moveKey: 'bbref:a' }, mergeInto: 'bbref:a', source: 's' },
      { kind: 'move', match: { moveKey: 'bbref:a' }, mergeInto: 'bbref:nope', source: 's' },
      { kind: 'move', match: { moveKey: 'bbref:nope' }, drop: true, reason: 'r', source: 's' },
      { kind: 'pick', match: { moveKey: 'bbref:a', partIndex: 3 }, set: { year: 1990 }, source: 's' },
      { kind: 'pick', match: { draftYear: 1978, overall: 99 }, set: { originalFranchiseId: BOS }, source: 's' },
    ];
    expect(phase1([mv('bbref:a', '1980-01-01', [])], overrides).stale).toEqual(overrides);
  });

  it('a linking override clears a chain break', () => {
    // The Clippers' 2010 #8 came from Miami; the only stored part is a vague pick from Miami.
    const wiki = [wrow(2010, 1, 8, 'Al Farouq-Aminu', LAC, [MIA])];
    const moves = [mv('bbref:p', '2008-02-01', [{ from: MIA, to: LAC, kind: 'pick', pick: { year: 0, round: 0, vague: true }, text: 'a future draft pick', gap: 'pick_unidentified' }])];
    const before = buildPicks(moves, draft(wiki), 2027);
    expect(before.breaks).toEqual([{ pickKey: '2010-1-MIA', missingHop: [MIA, LAC] }]);

    const out = phase1(moves, [{ kind: 'pick', match: { moveKey: 'bbref:p', partIndex: 0 }, set: { year: 2010, round: 1, originalFranchiseId: MIA }, source: 's' }]);
    expect(out.stale).toEqual([]);
    const after = buildPicks(out.moves, draft(wiki), 2027);
    expect(after.breaks).toEqual([]);
    expect(after.moves[0].parts[0]).toMatchObject({ pickKey: '2010-1-MIA' });
    expect(after.moves[0].parts[0].gap).toBeUndefined();
    expect(after.moves[0].complete).toBe(true);
    expect(after.picks.find((p) => p.pickKey === '2010-1-MIA')).toMatchObject({ status: 'used', overall: 8, finalOwnerFranchiseId: LAC });
  });

  it('a draft-row identity override keys a previously unkeyed row', () => {
    // Two chainless Clippers third-rounders both default to "own pick": a tie, so neither is keyed.
    const wiki = [wrow(1978, 3, 50, 'Ab One', LAC), wrow(1978, 3, 60, 'Cd Two', LAC)];
    expect(buildPicks([], draft(wiki), 2027).unkeyed.map((u) => u.overall)).toEqual([50, 60]);

    const out = phase1([], [{ kind: 'pick', match: { draftYear: 1978, overall: 60 }, set: { originalFranchiseId: BOS }, source: 's' }], { draftRows: wiki });
    expect(out.stale).toEqual([]);
    expect(out.originals).toEqual([{ year: 1978, overall: 60, originalFranchiseId: BOS }]);
    const after = buildPicks([], draft(wiki, out.originals), 2027);
    expect(after.unkeyed).toEqual([]);
    expect(after.picks.filter((p) => p.year === 1978).map((p) => [p.pickKey, p.overall])).toEqual([['1978-3-BOS', 60], ['1978-3-LAC', 50]]);
  });
});

describe('applyOverrides (phase 2, after buildPicks)', () => {
  it('fills pick protections from an override and marks them known', () => {
    const data = ds({ picks: [row('2028-1-LAC', 2028, 1, LAC)] });
    const o: Override = {
      kind: 'pick', match: { pickKey: '2028-1-LAC' },
      set: { protections: [{ year: 0, range: '1-3', then: null }], protectionsText: 'Top-3 protected' }, source: 'test note',
    };
    const out = applyOverrides(data, [o]);
    expect(out.stale).toEqual([]);
    expect(out.invalid).toEqual([]);
    expect(out.data.picks[0]).toMatchObject({ protectionsKnown: true, protectionsText: 'Top-3 protected', protections: [{ year: 0, range: '1-3', then: null }] });
    expect(data.picks[0].protectionsKnown).toBe(false); // input untouched
  });

  it('does not mark protections known from text it cannot read', () => {
    const data = ds({ picks: [row('2028-1-LAC', 2028, 1, LAC)] });
    const o: Override = { kind: 'pick', match: { pickKey: '2028-1-LAC' }, set: { protectionsText: 'Lottery protected through 2029, then a second' }, source: 's' };
    const out = applyOverrides(data, [o]);
    expect(out.invalid).toEqual([o]);
    expect(out.data.picks[0].protectionsKnown).toBe(false);
    const r = buildReport(out.data, out.stale, out.invalid);
    expect(r.invalidOverrides).toEqual([o]);
    expect(gateFailures(r)).toEqual(['1 future pick without known protections']);
    // The text alone is enough when it parses.
    const ok = applyOverrides(data, [{ kind: 'pick', match: { pickKey: '2028-1-LAC' }, set: { protectionsText: 'Top-10 protected' }, source: 's' }]);
    expect(ok.data.picks[0]).toMatchObject({ protectionsKnown: true, protections: [{ year: 0, range: '1-10', then: null }] });
  });

  it('reports phase-2 overrides that match nothing as stale, and leaves phase-1 kinds alone', () => {
    const data = ds({ picks: [row('2028-1-LAC', 2028, 1, LAC)] });
    const stale: Override[] = [
      { kind: 'pick', match: { pickKey: '2029-1-LAC' }, set: { protectionsText: 'Unprotected', protections: [] }, source: 's' },
      { kind: 'ignore', match: { source: 'LAC-1999_transactions', text: 'gone' }, reason: 'r', source: 's' },
      { kind: 'person', match: { ref: 'Nobody Here' }, personKey: 'nobodhe01', source: 's' },
      // The base tables already read this name: the override no longer does anything.
      { kind: 'teamName', match: { text: 'Kansas City Kings', seasonId: 1976 }, franchise: SAC, source: 's' },
    ];
    const phase1Only: Override = { kind: 'move', match: { moveKey: 'bbref:nope' }, replaceParts: [], source: 's' };
    expect(applyOverrides(data, [...stale, phase1Only]).stale).toEqual(stale);
  });

  it('maps a person by name only where no id is carried', () => {
    const data = ds({
      moves: [
        mv('wiki:x', '1980-08-01', [{ ...player(LAC, BOS, 'World Free'), gap: 'person_unmatched' }]),
        mv('bbref:y', '1990-08-01', [player(LAC, BOS, 'World Free', 'freewo01')]),
      ],
      honors: [
        { seasonId: 1979, name: 'World Free', honor: 'all_star', detail: null, personKey: null },
        { seasonId: 1980, name: 'World Free', honor: 'all_star', detail: null, personKey: 'freewo01' },
      ],
    });
    const out = applyOverrides(data, [{ kind: 'person', match: { ref: 'World Free' }, personKey: 'freewo02', source: 's' }]);
    expect(out.stale).toEqual([]);
    expect(out.data.moves[0].parts[0]).toMatchObject({ personKey: 'freewo02' });
    expect(out.data.moves[0].parts[0].gap).toBeUndefined();
    expect(out.data.moves[0].complete).toBe(true);
    expect(out.data.moves[1].parts[0].personKey).toBeUndefined();
    expect(out.data.honors.map((h) => h.personKey)).toEqual(['freewo02', 'freewo01']);
  });

  it('never overwrites a part that carries a different id', () => {
    // A name override for the son must not land on the father's BBRef-linked 1990 part.
    const data = ds({ moves: [mv('bbref:1990', '1990-07-01', [{ from: null, to: LAC, kind: 'other', person: { bbrefId: 'dunlemi01', name: 'Mike Dunleavy' }, text: 'Head Coach' }], { kind: 'hire' })] });
    const o: Override = { kind: 'person', match: { ref: 'Mike Dunleavy' }, personKey: 'dunlemi02', source: 's' };
    const out = applyOverrides(data, [o]);
    expect(out.data.moves[0].parts[0].personKey).toBeUndefined();
    expect(out.stale).toEqual([o]);
  });

  it('maps a person by id, and narrows a name to a scope', () => {
    const data = ds({
      moves: [
        mv('nba:1', '2016-07-01', [{ from: null, to: LAC, kind: 'player', person: { nbaPersonId: 77, name: 'A B' } }], { kind: 'signing' }),
        mv('wiki:2', '1981-01-01', [player(LAC, BOS, 'Joe Smith')]),
        mv('wiki:3', '1999-01-01', [player(LAC, BOS, 'Joe Smith')]),
      ],
    });
    const out = applyOverrides(data, [
      { kind: 'person', match: { ref: 'nba:77' }, personKey: 'bbab01', source: 's' },
      { kind: 'person', match: { ref: 'Joe Smith', scope: { seasonId: 1998 } }, personKey: 'smithjo02', source: 's' },
    ]);
    expect(out.stale).toEqual([]);
    expect(out.data.moves.map((m) => m.parts[0].personKey)).toEqual(['bbab01', undefined, 'smithjo02']);
  });

  it('moves an ignored line out of unparsed', () => {
    const line = { source: 'nba', index: 1, date: null, text: 'x' };
    const out = applyOverrides(ds({ unparsed: [line] }), [{ kind: 'ignore', match: { source: 'nba', text: 'x' }, reason: 'not a move', source: 's' }]);
    expect(out.data.unparsed).toEqual([]);
    expect(out.data.ignored).toEqual([{ ...line, reason: 'not a move' }]);
  });

  it('a teamName override resolves a name the tables miss', () => {
    const o: Override = { kind: 'teamName', match: { text: 'Kings of Kansas', seasonId: 1976 }, franchise: SAC, source: 's' };
    expect(franchiseFromName('the Kings of Kansas', 1976, [])).toBeNull();
    expect(franchiseFromName('the Kings of Kansas', 1976, [o])).toBe(SAC);
    expect(applyOverrides(ds(), [o]).stale).toEqual([]);
  });
});
