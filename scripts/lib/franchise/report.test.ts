import { describe, expect, it } from 'vitest';
import { NBA_TEAM_IDS } from '../nba-teams.js';
import { applyOverrides } from './apply-overrides.js';
import type { PickRow } from './picks.js';
import type { MergedMove } from './reconcile-moves.js';
import { buildReport, gateFailures, summarizeReport } from './report.js';
import type { FranchiseDataset, MovePart } from './types.js';

const { LAC, BOS, MIA } = NBA_TEAM_IDS;

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
const row = (key: string, year: number, extra: Partial<PickRow> = {}): PickRow => ({
  pickKey: key, year, round: 1, originalFranchiseId: LAC, protections: null, protectionsText: null, protectionsKnown: false,
  status: 'future', overall: null, selectedPersonKey: null, finalOwnerFranchiseId: null, ...extra,
});

describe('buildReport and gateFailures', () => {
  it('drops an ignored unparsed line from gate failures', () => {
    const line = { source: 'LAC-1999_transactions', index: 3, date: '1999-01-01', text: 'Odd sentence.' };
    const data = ds({ unparsed: [line] });
    expect(gateFailures(buildReport(data))).toEqual(['1 unparsed line not marked ignored']);
    const out = applyOverrides(data, [{ kind: 'ignore', match: { source: line.source, text: line.text }, reason: 'not a move', source: 's' }]);
    const r = buildReport(out.data, out.stale);
    expect(r.unparsed).toEqual([]);
    expect(r.counts.ignored).toBe(1);
    expect(gateFailures(r)).toEqual([]);
  });

  it('gates on a future pick without known protections', () => {
    const r = buildReport(ds({ picks: [row('2028-1-LAC', 2028), row('2029-1-LAC', 2029, { protectionsKnown: true, protections: [] })] }));
    expect(r.futureWithoutProtections).toEqual(['2028-1-LAC']);
    expect(gateFailures(r)).toEqual(['1 future pick without known protections']);
  });

  it('does not gate on an old unlinked pick', () => {
    const r = buildReport(ds({
      picks: [row('1986-1-LAC', 1986, { status: 'used' })],
      moves: [mv('bbref:o', '1984-06-01', [{ from: BOS, to: LAC, kind: 'pick', pick: { year: 0, round: 1, vague: true }, text: 'a future 1st round draft pick', gap: 'pick_unidentified' }])],
    }));
    expect(r.gaps.pick_unidentified).toHaveLength(1);
    expect(r.futureWithoutProtections).toEqual([]);
    expect(gateFailures(r)).toEqual([]);
  });

  it('finds an unmerged pair from different sources 10 days apart as a possible duplicate', () => {
    const free = (name: string): MovePart => ({ from: BOS, to: LAC, kind: 'player', person: { name } });
    const r = buildReport(ds({
      moves: [
        mv('bbref:a', '1978-08-04', [free('World B. Free'), { from: LAC, to: BOS, kind: 'cash' }]),
        mv('wiki:b', '1978-08-14', [free('World Free')]), // no shared person: not paired with a
        mv('wiki:c', '1978-08-14', [free('World B. Free')]),
        mv('bbref:d', '1978-08-20', [free('World B. Free')]), // same source as a: never paired with it
        mv('wiki:e', '1978-10-30', [free('World B. Free')]), // too far from everything
        mv('wiki:f', '1978-08-05', [{ ...free('World B. Free'), from: MIA }]), // no shared counterparty
      ],
    }));
    expect(r.possibleDuplicates.map((d) => [d.a, d.b, d.days])).toEqual([['bbref:a', 'wiki:c', 10], ['wiki:c', 'bbref:d', 6]]);
    expect(r.counts.possibleDuplicates).toBe(2);
  });

  it('prints skipped counts by reason', () => {
    const sk = (reason: 'g_league' | 'duplicate', i: number) => ({ source: 'LAC-2019_transactions', index: i, date: '2019-01-01', text: 't', reason });
    const r = buildReport(ds({ skipped: [sk('g_league', 1), sk('g_league', 2), sk('duplicate', 3)] }));
    expect(r.skippedByReason).toEqual({ g_league: 2, duplicate: 1 });
    expect(summarizeReport(r)).toContain('skipped: g_league 2, duplicate 1');
  });

  it('lists conflicts, unsettled past swaps, lottery flags and skipped categories', () => {
    const r = buildReport(ds({
      moves: [mv('nba:1', '2019-07-06', [{ from: MIA, to: LAC, kind: 'player', person: { name: 'X' }, gap: 'source_conflict' }], {
        complete: false,
        conflicts: [{ partIndex: 0, readings: ['nba: X', 'bbref: Y'] }, { partIndex: null, readings: ['wiki: a 2020 2nd'] }],
      })],
      swaps: [
        { swapKey: '2021-1-LAC-MIA', year: 2021, round: 1, franchiseA: LAC, franchiseB: MIA, protections: null, protectionsText: null, protectionsKnown: false, exercised: null },
        { swapKey: '2029-1-LAC-MIA', year: 2029, round: 1, franchiseA: LAC, franchiseB: MIA, protections: null, protectionsText: null, protectionsKnown: false, exercised: null },
      ],
      lottery: [{ year: 1996, pickKey: '1996-1-LAC', preSlot: null, oddsFirst: null, pickWon: 7, source: 'derived', tieUnresolved: true, flags: ['team_seasons_incomplete'] }],
      skippedCategories: ['Sportsmanship Award'],
    }));
    expect(r.counts.conflicts).toBe(2);
    expect(r.conflicts.map((c) => c.part)).toEqual(['part 0', 'absent in base']);
    expect(r.unsettledSwaps).toEqual(['2021-1-LAC-MIA']);
    expect(r.lotteryFlags).toEqual([{ pickKey: '1996-1-LAC', flags: ['team_seasons_incomplete'] }]);
    expect(r.tieUnresolved).toEqual(['1996-1-LAC']);
    expect(r.skippedCategories).toEqual(['Sportsmanship Award']);
    expect(r.bySeasonKind['2019']).toEqual({ trade: 1 });
  });
});
