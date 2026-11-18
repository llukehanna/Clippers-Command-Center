import { describe, expect, it } from 'vitest';
import { NBA_TEAM_IDS } from '../nba-teams.js';
import { applyOverrides } from './apply-overrides.js';
import type { PickRow } from './picks.js';
import type { MergedMove } from './reconcile-moves.js';
import { franchiseFromName } from './team-names.js';
import type { FranchiseDataset, MovePart, Override } from './types.js';

const { LAC, BOS, MIA, SAC } = NBA_TEAM_IDS;

function ds(d: Partial<FranchiseDataset> = {}): FranchiseDataset {
  return {
    currentDraftYear: 2027, people: [], moves: [], picks: [], swaps: [], lottery: [], salaries: [], payrollSeasons: [],
    contracts: [], coachSeasons: [], execTerms: [], honors: [], unparsed: [], ignored: [], skipped: [],
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

describe('applyOverrides', () => {
  it('fills pick protections from an override and marks them known', () => {
    const data = ds({ picks: [row('2028-1-LAC', 2028, 1, LAC)] });
    const o: Override = {
      kind: 'pick', match: { pickKey: '2028-1-LAC' },
      set: { protections: [{ year: 0, range: '1-3', then: null }], protectionsText: 'Top-3 protected' }, source: 'test note',
    };
    const out = applyOverrides(data, [o]);
    expect(out.stale).toEqual([]);
    expect(out.data.picks[0]).toMatchObject({ protectionsKnown: true, protectionsText: 'Top-3 protected', protections: [{ year: 0, range: '1-3', then: null }] });
    expect(data.picks[0].protectionsKnown).toBe(false); // input untouched
  });

  it('reports an override that matches nothing as stale', () => {
    const data = ds({ picks: [row('2028-1-LAC', 2028, 1, LAC)], moves: [mv('bbref:a', '2004-07-14', [])] });
    const overrides: Override[] = [
      { kind: 'pick', match: { pickKey: '2029-1-LAC' }, set: { protectionsText: 'Unprotected', protections: [] }, source: 's' },
      { kind: 'move', match: { moveKey: 'bbref:nope' }, replaceParts: [], source: 's' },
      { kind: 'ignore', match: { source: 'LAC-1999_transactions', text: 'gone' }, reason: 'r', source: 's' },
      { kind: 'person', match: { ref: 'Nobody Here' }, personKey: 'nobodhe01', source: 's' },
      // The base tables already read this name: the override no longer does anything.
      { kind: 'teamName', match: { text: 'Kansas City Kings', seasonId: 1976 }, franchise: SAC, source: 's' },
    ];
    expect(applyOverrides(data, overrides).stale).toEqual(overrides);
  });

  it('settles compensation as "compensation not recorded" and keeps the move incomplete', () => {
    const data = ds({ moves: [mv('bbref:c', '1981-10-01', [{ from: BOS, to: LAC, kind: 'pick', text: 'compensation', gap: 'pick_unidentified' }])] });
    const parts: MovePart[] = [{ from: BOS, to: LAC, kind: 'other', text: 'compensation not recorded' }];
    const out = applyOverrides(data, [{ kind: 'move', match: { moveKey: 'bbref:c' }, replaceParts: parts, complete: false, source: 's' }]);
    expect(out.stale).toEqual([]);
    expect(out.data.moves[0]).toMatchObject({ parts, complete: false, conflicts: [] });
  });

  it('creates a move from an unparsed line', () => {
    const line = { source: 'LAC-1982_transactions', index: 4, date: '1982-09-01', text: 'Some sentence no rule reads.' };
    const data = ds({ unparsed: [line] });
    const parts: MovePart[] = [{ from: LAC, to: BOS, kind: 'player', person: { bbrefId: 'smithjo01', name: 'Joe Smith' } }];
    const o: Override = { kind: 'move', match: { source: line.source, text: line.text }, create: { kind: 'trade' }, replaceParts: parts, source: 's' };
    const out = applyOverrides(data, [o]);
    expect(out.stale).toEqual([]);
    expect(out.data.unparsed).toEqual([]);
    expect(out.data.moves).toHaveLength(1);
    const m = out.data.moves[0];
    expect(m).toMatchObject({ date: '1982-09-01', kind: 'trade', parts, involvesClippers: true, complete: true, conflicts: [] });
    expect(m.transactionKey).toMatch(/^override:LAC-1982_transactions#[0-9a-f]{8}$/);
    expect(m.sources).toEqual([m.transactionKey]);
    // Same line, same key: the key survives re-imports.
    expect(applyOverrides(data, [o]).data.moves[0].transactionKey).toBe(m.transactionKey);
  });

  it('links an unlinked pick part and completes the move', () => {
    const data = ds({
      picks: [row('1986-1-MIA', 1986, 1, MIA, { status: 'used' })],
      moves: [mv('bbref:p', '1984-06-01', [{ from: BOS, to: LAC, kind: 'pick', pick: { year: 0, round: 1, vague: true }, text: 'a future 1st round draft pick', gap: 'pick_unidentified' }])],
    });
    const out = applyOverrides(data, [{ kind: 'pick', match: { moveKey: 'bbref:p', partIndex: 0 }, set: { year: 1986, originalFranchiseId: MIA }, source: 's' }]);
    expect(out.stale).toEqual([]);
    const p = out.data.moves[0].parts[0];
    expect(p).toMatchObject({ pickKey: '1986-1-MIA', pick: { year: 1986, round: 1, originalFranchiseId: MIA } });
    expect(p.gap).toBeUndefined();
    expect(p.pick!.vague).toBeUndefined();
    expect(out.data.moves[0].complete).toBe(true);
  });

  it('maps a person ref to a key on parts and honors', () => {
    const data = ds({
      moves: [mv('wiki:x', '1980-08-01', [{ from: LAC, to: BOS, kind: 'player', person: { name: 'World Free' }, gap: 'person_unmatched' }])],
      honors: [{ seasonId: 1979, name: 'World B. Free', honor: 'all_star', detail: null, personKey: null }],
    });
    const out = applyOverrides(data, [
      { kind: 'person', match: { ref: 'World Free' }, personKey: 'freewo01', source: 's' },
      { kind: 'person', match: { ref: 'World B. Free' }, personKey: 'freewo01', source: 's' },
    ]);
    expect(out.stale).toEqual([]);
    expect(out.data.moves[0].parts[0]).toMatchObject({ personKey: 'freewo01' });
    expect(out.data.moves[0].parts[0].gap).toBeUndefined();
    expect(out.data.moves[0].complete).toBe(true);
    expect(out.data.honors[0].personKey).toBe('freewo01');
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
