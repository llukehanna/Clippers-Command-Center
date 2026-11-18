import { describe, it, expect } from 'vitest';
import { buildTradeTree, type TreeRows, type TreePart, type TreePick } from './trade-tree';
import { NBA_FRANCHISE_IDS as F } from './franchise-ids';

// Illustrative rows shaped like the loader's queries (not real history).

const txn = (id: string, slug: string, date: string, kind = 'trade', involves_clippers = false) => ({
  transaction_id: id, slug, date, season_id: Number(date.slice(5, 7)) <= 6 ? Number(date.slice(0, 4)) - 1 : Number(date.slice(0, 4)),
  kind, involves_clippers,
});

const part = (transaction_id: string, from: number | null, to: number | null, p: Partial<TreePart>): TreePart => ({
  transaction_id, from_franchise_id: from, to_franchise_id: to, asset_kind: 'player',
  person_key: null, pick_id: null, swap_id: null, unlinked_text: null, gap_reason: null, ...p,
});

const pick = (p: Partial<TreePick> & Pick<TreePick, 'pick_id' | 'draft_year' | 'round' | 'original_franchise_id'>): TreePick => ({
  pick_key: `${p.draft_year}-${p.round}-${p.original_franchise_id}`, protections: null, protections_text: null,
  protections_known: true, status: 'future', overall_pick: null, selected_person: null, final_owner_franchise_id: null, ...p,
});

function rows(): TreeRows {
  return {
    transactions: [
      txn('1', 'root-george', '2019-07-10', 'trade', true),
      txn('2', 'gallo-okc-atl', '2020-11-22'),
      txn('3', 'gallo-atl-sas', '2022-02-08'),
      txn('4', 'gallo-waived', '2022-02-15', 'waiver'),
      txn('5', 'gallo-signs-bos', '2022-03-02', 'signing'),
      txn('6', 'zubac-draft-night', '2016-06-23', 'trade', true), // before the root: never followed
      txn('7', 'drafted-guy-traded', '2022-08-01', 'trade'),
    ],
    parts: [
      part('1', F.OKC, F.LAC, { person_key: 'georgpa01' }),
      part('1', F.LAC, F.OKC, { person_key: 'gallida01' }),
      part('1', F.LAC, F.OKC, { asset_kind: 'pick', pick_id: 10 }),
      part('1', F.LAC, F.OKC, { asset_kind: 'pick', pick_id: 11 }),
      part('1', F.LAC, F.OKC, { asset_kind: 'pick', pick_id: 12, gap_reason: 'protections_unknown' }),
      part('2', F.OKC, F.ATL, { person_key: 'gallida01' }),
      part('2', F.ATL, F.OKC, { asset_kind: 'cash', unlinked_text: 'cash considerations' }),
      part('3', F.ATL, F.SAS, { person_key: 'gallida01' }),
      part('4', F.SAS, null, { person_key: 'gallida01' }),
      part('5', null, F.BOS, { person_key: 'gallida01' }),
      part('6', F.LAC, F.LAL, { person_key: 'georgpa01' }),
      part('7', F.OKC, F.UTA, { person_key: 'draftee01' }),
    ],
    picks: [
      // Used by OKC: becomes the player drafted, who is then traded
      pick({ pick_id: 10, draft_year: 2022, round: 1, original_franchise_id: F.LAC, status: 'used', overall_pick: 25,
        selected_person: 'draftee01', final_owner_franchise_id: F.OKC }),
      // No later hop recorded, but its final owner is Phoenix: moved on without details
      pick({ pick_id: 11, draft_year: 2026, round: 1, original_franchise_id: F.LAC, status: 'future', final_owner_franchise_id: F.PHX }),
      // Unknown protections, still with OKC
      pick({ pick_id: 12, draft_year: 2028, round: 1, original_franchise_id: F.LAC, status: 'future',
        protections_known: null, final_owner_franchise_id: F.OKC }),
    ],
    swaps: [],
    people: [
      { person_key: 'georgpa01', display_name: 'Paul George', player_id: '4' },
      { person_key: 'gallida01', display_name: 'Danilo Gallinari', player_id: null },
      { person_key: 'draftee01', display_name: 'Drafted Guy', player_id: '9' },
    ],
  };
}

const find = (nodes: ReturnType<typeof buildTradeTree>['became'], label: RegExp) => {
  const n = nodes.find((x) => label.test(x.label));
  if (!n) throw new Error(`no node ${label}: ${nodes.map((x) => x.label).join(' | ')}`);
  return n;
};

describe('buildTradeTree', () => {
  it('stops at depth 3 with a continue slug', () => {
    const { became } = buildTradeTree('root-george', rows());
    const gallo = find(became, /Gallinari/);
    const step1 = gallo.children[0];
    expect(step1).toMatchObject({ label: 'Traded to Atlanta Hawks for cash considerations', href: '/franchise/trades/gallo-okc-atl', date: '2020-11-22' });
    const step2 = step1.children[0];
    expect(step2).toMatchObject({ label: 'Traded to San Antonio Spurs', href: '/franchise/trades/gallo-atl-sas' });
    const step3 = step2.children[0];
    expect(step3).toMatchObject({ label: 'Waived by San Antonio Spurs', href: null, children: [] });
    // The fourth step (a signing) is not shown; continue on the deepest trade on the path.
    expect(step3.truncatedAt).toBe('gallo-atl-sas');
    expect(step1.truncatedAt).toBeNull();
    expect(step2.truncatedAt).toBeNull();
  });

  it('continues on the next trade itself when the hidden step is a trade', () => {
    const { became } = buildTradeTree('root-george', rows(), 1);
    const step1 = find(became, /Gallinari/).children[0];
    expect(step1.children).toEqual([]);
    expect(step1.truncatedAt).toBe('gallo-atl-sas');
  });

  it('follows every step when the chain fits the depth', () => {
    const { became } = buildTradeTree('root-george', rows(), 4);
    const step4 = find(became, /Gallinari/).children[0].children[0].children[0].children[0];
    expect(step4).toMatchObject({ label: 'Signed with Boston Celtics', truncatedAt: null, note: 'no further record' });
  });

  it('shows "no further record" when an asset has no later move', () => {
    const { became } = buildTradeTree('root-george', rows());
    const george = find(became, /Paul George/);
    expect(george).toMatchObject({ kind: 'player', href: '/players/4', children: [], note: 'no further record', truncatedAt: null });
  });

  it('shows "traded on to T (details not recorded)" for an unidentified pick', () => {
    const { became } = buildTradeTree('root-george', rows());
    const p = find(became, /^2026 first-round pick/);
    expect(p.kind).toBe('pick');
    expect(p.note).toBe('traded on to Phoenix Suns (details not recorded)');
    expect(p.children).toEqual([]);
  });

  it('turns a used pick into the player drafted, then that player\'s next move', () => {
    const { became } = buildTradeTree('root-george', rows());
    const p = find(became, /^2022 first-round pick/);
    const drafted = p.children[0];
    expect(drafted).toMatchObject({ kind: 'player', label: 'Drafted Drafted Guy (No. 25, 2022)', href: '/players/9' });
    expect(drafted.children[0]).toMatchObject({ label: 'Traded to Utah Jazz', href: '/franchise/trades/drafted-guy-traded' });
  });

  it('marks unknown protections and never calls them unprotected', () => {
    const { became } = buildTradeTree('root-george', rows());
    const p = find(became, /^2028 first-round pick/);
    expect(p.note).toContain('protections not recorded');
    expect(JSON.stringify(became)).not.toMatch(/unprotected/i);
  });

  it('builds one side per franchise, Clippers first', () => {
    const { sides } = buildTradeTree('root-george', rows());
    expect(sides.map((s) => s.team.abbreviation)).toEqual(['LAC', 'OKC']);
    expect(sides[0].team.is_clippers).toBe(true);
    expect(sides[0].received.map((a) => a.label)).toEqual(['Paul George']);
    expect(sides[0].sent.map((a) => a.label)).toEqual([
      'Danilo Gallinari', '2022 first-round pick', '2026 first-round pick', '2028 first-round pick',
    ]);
    expect(sides[1].received).toHaveLength(4);
    const unknown = sides[0].sent[3];
    expect(unknown.pick).toMatchObject({ protections_known: null, protections_text: null, protections_label: 'Protections not recorded' });
    expect(unknown.gap_note).toBe('protections not recorded');
  });

  it('lists a party_unknown part under the receiving team with its gap note (three-team deal)', () => {
    const r: TreeRows = {
      transactions: [txn('1', 'three', '2021-03-25', 'trade', true)],
      parts: [
        part('1', F.DET, F.LAC, { person_key: 'kennalu01' }),
        part('1', F.LAC, F.SAC, { person_key: 'mcgruro01' }),
        part('1', null, F.DET, { person_key: 'wrighde01', gap_reason: 'party_unknown' }),
      ],
      picks: [], swaps: [], people: [],
    };
    const { sides, became } = buildTradeTree('three', r);
    expect(sides.map((s) => s.team.abbreviation)).toEqual(['LAC', 'DET', 'SAC']);
    const det = sides[1];
    expect(det.received).toHaveLength(1);
    expect(det.received[0]).toMatchObject({ person: { person_key: 'wrighde01' }, counterparty: null, gap_note: 'team not recorded' });
    expect(det.sent.map((a) => a.person?.person_key)).toEqual(['kennalu01']);
    expect(became).toHaveLength(3);
    expect(became[0].team?.abbreviation).toBe('LAC');
  });

  it('uses the era team names the lookup provides', () => {
    const r = rows();
    r.team = (franchiseId, seasonId) => ({
      franchise_id: franchiseId, abbreviation: franchiseId === F.OKC && seasonId === 2019 ? 'OKX' : 'ZZZ',
      name: 'Era', city: 'Old', is_clippers: franchiseId === F.LAC,
    });
    const { sides } = buildTradeTree('root-george', r);
    expect(sides[1].team.abbreviation).toBe('OKX');
  });

  it('throws on an unknown root slug', () => {
    expect(() => buildTradeTree('nope', rows())).toThrow(/nope/);
  });
});
