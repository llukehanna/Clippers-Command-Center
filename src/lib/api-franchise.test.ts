// src/lib/api-franchise.test.ts
// Franchise loaders and routes with a mocked sql (same pattern as api-history.test.ts).
// Rows are illustrative, not real history.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSql = vi.fn();

vi.mock('./db.js', () => ({
  sql: new Proxy(mockSql, {
    apply(target: typeof mockSql, thisArg: unknown, args: unknown[]) {
      return Reflect.apply(target, thisArg, args);
    },
    get(target: typeof mockSql, prop: string | symbol) {
      if (prop === 'unsafe') return (fragment: string) => fragment;
      return (target as unknown as Record<string | symbol, unknown>)[prop];
    },
  }),
  LAC_NBA_TEAM_ID: 13,
}));

const LAC = 1610612746;
const OKC = 1610612760;
const PHI = 1610612755;

type Handler = (q: string, values: unknown[]) => unknown[] | undefined;
function route(handler: Handler) {
  mockSql.mockImplementation(async (strings: readonly string[], ...values: unknown[]) => {
    return handler(strings.join('?'), values) ?? [];
  });
}
const queries = () => mockSql.mock.calls.map((c) => (c[0] as string[]).join('?'));
const callFor = (marker: string) => mockSql.mock.calls.find((c) => (c[0] as string[]).join('?').includes(marker));

beforeEach(() => {
  vi.clearAllMocks();
  route(() => []);
});

// ─── Moves ───────────────────────────────────────────────────────────────────

describe('GET /api/franchise/moves', () => {
  const txns = [
    { transaction_id: '1', slug: '2019-07-10-paul-george', date: '2019-07-10', season_id: 2019, kind: 'trade',
      description: 'The Clippers acquired Paul George.', is_complete: true, involves_clippers: true },
    { transaction_id: '2', slug: '2020-11-22-gallinari-okc-atl', date: '2020-11-22', season_id: 2020, kind: 'trade',
      description: 'Oklahoma City sent Danilo Gallinari to Atlanta.', is_complete: true, involves_clippers: false },
    { transaction_id: '3', slug: '2025-07-06-bradley-beal-signs', date: '2025-07-06', season_id: 2025, kind: 'signing',
      description: 'Bradley Beal signed with the Clippers.', is_complete: false, involves_clippers: true },
  ];
  const parts = [
    { transaction_id: '1', from_franchise_id: OKC, to_franchise_id: LAC, person_key: 'georgpa01', display_name: 'Paul George', player_id: '4', nba_person_id: 202331 },
    { transaction_id: '1', from_franchise_id: LAC, to_franchise_id: OKC, person_key: 'gilgesh01', display_name: 'Shai Gilgeous-Alexander', player_id: null },
    { transaction_id: '1', from_franchise_id: LAC, to_franchise_id: OKC, person_key: null, display_name: null, player_id: null },
    { transaction_id: '3', from_franchise_id: null, to_franchise_id: LAC, person_key: 'bealbr01', display_name: 'Bradley Beal', player_id: null },
  ];
  beforeEach(() => {
    route((q) => {
      // The fake DB honors the involves_clippers filter only if the query states it.
      if (q.includes('DISTINCT season_id')) return [{ season_id: 2025 }, { season_id: 2019 }];
      if (q.includes('FROM transactions t')) {
        return q.includes('involves_clippers = true') ? txns.filter((t) => t.involves_clippers) : txns;
      }
      if (q.includes('FROM transaction_parts p')) return parts;
      return [];
    });
  });

  it('moves loader excludes involves_clippers=false rows', async () => {
    const { GET } = await import('../../app/api/franchise/moves/route.js');
    const res = await GET(new Request('http://localhost/api/franchise/moves'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.moves.map((m: { slug: string }) => m.slug)).toEqual(['2019-07-10-paul-george', '2025-07-06-bradley-beal-signs']);
    expect(callFor('FROM transactions t')![0].join('?')).toContain('involves_clippers = true');
  });

  it('returns rows with kind group, era teams (Clippers first), people and trade links', async () => {
    const { GET } = await import('../../app/api/franchise/moves/route.js');
    const body = await (await GET(new Request('http://localhost/api/franchise/moves'))).json();
    const george = body.moves[0];
    expect(george).toMatchObject({ kind: 'trade', kind_group: 'trade', href: '/franchise/trades/2019-07-10-paul-george', is_complete: true });
    expect(george.teams.map((t: { abbreviation: string }) => t.abbreviation)).toEqual(['LAC', 'OKC']);
    expect(george.teams[1]).toMatchObject({ franchise_id: OKC, name: 'Thunder', city: 'Oklahoma City', is_clippers: false });
    expect(george.people).toEqual([
      { person_key: 'georgpa01', name: 'Paul George', player_id: '4', nba_person_id: 202331, href: '/players/4' },
      { person_key: 'gilgesh01', name: 'Shai Gilgeous-Alexander', player_id: null, nba_person_id: null, href: null },
    ]);
    const beal = body.moves[1];
    expect(beal).toMatchObject({ kind_group: 'signing', href: null, is_complete: false });
    expect(body.seasons).toEqual([2025, 2019]);
    expect(body.filters).toEqual({ season: null, type: null, player: null });
    expect(body.meta).toMatchObject({ source: 'db', ttl_seconds: 3600 });
  });

  it('passes season, kind group and player filters to SQL', async () => {
    const { GET } = await import('../../app/api/franchise/moves/route.js');
    const res = await GET(new Request('http://localhost/api/franchise/moves?season=2019&type=signing&player=georgpa01'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
    const call = callFor('FROM transactions t')!;
    const values = call.slice(1);
    expect(values).toContain(2019);
    expect(values).toContain('georgpa01');
    expect(values).toContainEqual(['signing', 're_signing', 'extension', 'two_way', 'ten_day', 'conversion']);
    const body = await res.json();
    expect(body.filters).toEqual({ season: 2019, type: 'signing', player: 'georgpa01' });
  });

  it('treats type=other as everything outside the named groups', async () => {
    const { GET } = await import('../../app/api/franchise/moves/route.js');
    await GET(new Request('http://localhost/api/franchise/moves?type=other'));
    const values = callFor('FROM transactions t')!.slice(1);
    const lists = values.filter(Array.isArray) as string[][];
    expect(lists.some((l) => l.includes('trade') && l.includes('waiver') && l.includes('draft'))).toBe(true);
  });

  it('season strip returns trades first, at most 5', async () => {
    const { GET } = await import('../../app/api/franchise/moves/route.js');
    const res = await GET(new Request('http://localhost/api/franchise/moves?season=2019&limit=5&sort=significance'));
    expect(res.status).toBe(200);
    const call = callFor('FROM transactions t')!;
    const q = (call[0] as string[]).join('?');
    // Trades first, then by number of parts, then newest; capped by the limit parameter.
    expect(q).toMatch(/ORDER BY[\s\S]*t\.kind = 'trade'[\s\S]*count\(\*\)[\s\S]*t\.date DESC/);
    expect(q).toContain('LIMIT');
    expect(call.slice(1)).toContain(5);
    expect(call.slice(1)).toContain(2019);
    for (const bad of ['0', '51', 'x', '2.5']) {
      expect((await GET(new Request(`http://localhost/api/franchise/moves?limit=${bad}`))).status).toBe(400);
    }
    expect((await GET(new Request('http://localhost/api/franchise/moves?sort=newest'))).status).toBe(400);
  });

  it("player filter returns only that person's moves", async () => {
    const { GET } = await import('../../app/api/franchise/moves/route.js');
    const res = await GET(new Request('http://localhost/api/franchise/moves?player_id=1'));
    expect(res.status).toBe(200);
    const call = callFor('FROM transactions t')!;
    const q = (call[0] as string[]).join('?');
    expect(q).toContain('person_xref');
    expect(q).toContain('involves_clippers = true');
    expect(call.slice(1)).toContain('1');
    expect((await GET(new Request('http://localhost/api/franchise/moves?player_id=abc'))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/franchise/moves?player_id=1'%20OR%201=1"))).status).toBe(400);
  });

  it('rejects an unknown type or a malformed season with 400', async () => {
    const { GET } = await import('../../app/api/franchise/moves/route.js');
    expect((await GET(new Request('http://localhost/api/franchise/moves?type=bogus'))).status).toBe(400);
    expect((await GET(new Request('http://localhost/api/franchise/moves?season=19x'))).status).toBe(400);
    expect((await GET(new Request('http://localhost/api/franchise/moves?season=newest'))).status).toBe(400);
  });

  it('counts moves per season for the type and player filters, ignoring the season filter', async () => {
    route((q) => {
      if (q.includes('GROUP BY s.season_id')) return [{ season_id: 2019, n: 3 }, { season_id: 2016, n: '1' }];
      return [];
    });
    const { GET } = await import('../../app/api/franchise/moves/route.js');
    const body = await (await GET(new Request('http://localhost/api/franchise/moves?season=2019&type=trade&player=georgpa01'))).json();
    expect(body.season_counts).toEqual([{ season_id: 2019, count: 3 }, { season_id: 2016, count: 1 }]);
    const call = callFor('GROUP BY s.season_id')!;
    const text = call[0].join('?');
    expect(text).toContain('involves_clippers = true');
    const values = call.slice(1);
    expect(values).toContain('georgpa01');
    expect(values).toContainEqual(['trade']);
    expect(values).not.toContain(2019);
  });

  it('names the filtered player from person_xref, and is null without a player filter', async () => {
    route((q) => (q.includes('WHERE x.person_key =') ? [{ display_name: 'Paul George', player_id: '4', nba_person_id: 202331 }] : []));
    const { GET } = await import('../../app/api/franchise/moves/route.js');
    const withPlayer = await (await GET(new Request('http://localhost/api/franchise/moves?player=georgpa01'))).json();
    expect(withPlayer.player).toEqual({ person_key: 'georgpa01', name: 'Paul George', player_id: '4', nba_person_id: 202331, href: '/players/4' });
    const without = await (await GET(new Request('http://localhost/api/franchise/moves'))).json();
    expect(without.player).toBeNull();
    expect(without.season_counts).toEqual([]);
  });

  it('reads headshot ids from person_xref, else the linked player', async () => {
    const { GET } = await import('../../app/api/franchise/moves/route.js');
    await GET(new Request('http://localhost/api/franchise/moves'));
    const text = callFor('LEFT JOIN person_xref x ON x.person_key = p.person_key')![0].join('?');
    expect(text).toContain('COALESCE(x.nba_person_id, pl.nba_person_id) AS nba_person_id');
    expect(text).toContain('LEFT JOIN players pl ON pl.player_id = x.player_id');
  });

  it('resolves season=latest to the newest season with a matching move, and echoes it', async () => {
    route((q) => {
      if (q.includes('GROUP BY s.season_id')) return [{ season_id: 2023, n: 2 }, { season_id: 2019, n: 1 }];
      if (q.includes('FROM transactions t')) return [];
      return [];
    });
    const { GET } = await import('../../app/api/franchise/moves/route.js');
    const res = await GET(new Request('http://localhost/api/franchise/moves?season=latest&type=signing'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.filters.season).toBe(2023);
    expect(callFor('FROM transactions t')!.slice(1)).toContain(2023);
  });

  it('never runs an unfiltered query when season=latest has no matching season', async () => {
    const { GET } = await import('../../app/api/franchise/moves/route.js');
    const body = await (await GET(new Request('http://localhost/api/franchise/moves?season=latest&type=release'))).json();
    expect(body.filters.season).toBeNull();
    expect(body.moves).toEqual([]);
    expect(callFor('FROM transactions t')).toBeUndefined();
  });
});

// ─── Era names (R1) through the real resolution query ───────────────────────
// A fake team_seasons/team_era_names answer keyed by the (franchise, season) arrays the
// query sends, so the payload's names come from the SQL row, not the static fallback.

type FakeTeamRow = Record<string, string | number | null>;
function teamRow(franchise_id: number, season_id: number, fields: Partial<Record<
  'ts_abbr' | 'ts_name' | 'ts_city' | 'era_abbr' | 'era_name' | 'era_city' | 'last_abbr' | 'last_name' | 'last_city', string>>): FakeTeamRow {
  return {
    franchise_id, season_id, ts_abbr: null, ts_name: null, ts_city: null, era_abbr: null, era_name: null, era_city: null,
    last_abbr: null, last_name: null, last_city: null, ...fields,
  };
}
function fakeTeams(rows: FakeTeamRow[]) {
  return (values: unknown[]): FakeTeamRow[] => {
    const [fids, sids] = values as [number[], number[]];
    return fids.flatMap((f, i) => rows.filter((r) => r.franchise_id === f && r.season_id === sids[i]));
  };
}

describe('resolveTeams (R1 era names)', () => {
  it('reads (OKC, 1975) as the Seattle SuperSonics from the query, and falls back to the static name otherwise', async () => {
    const teams = fakeTeams([teamRow(OKC, 1975, { era_abbr: 'SEA', era_name: 'SuperSonics', era_city: 'Seattle',
      last_abbr: 'OKC', last_name: 'Thunder', last_city: 'Oklahoma City' })]);
    route((q, values) => (q.includes('unnest(') ? teams(values) : []));
    const { resolveTeams } = await import('./data/franchise-teams.js');
    const team = await resolveTeams([[OKC, 1975], [OKC, 2019], [OKC, 1975]]);
    expect(team(OKC, 1975)).toEqual({ franchise_id: OKC, abbreviation: 'SEA', name: 'SuperSonics', city: 'Seattle', is_clippers: false });
    expect(team(OKC, 2019)).toMatchObject({ abbreviation: 'OKC', name: 'Thunder' }); // no row → static
    const call = callFor('unnest(')!;
    const q = call[0].join('?');
    expect(q).toContain('LEFT JOIN team_seasons ts ON ts.nba_franchise_id = q.f AND ts.season_id = q.s');
    expect(q).toContain('LEFT JOIN team_era_names e ON e.team_id = tid.team_id');
    expect(call[1]).toEqual([OKC, OKC]); // de-duplicated pairs
    expect(call[2]).toEqual([1975, 2019]);
  });

  it('prefers the season row, then the era row, then the latest row, then the static name — field by field', async () => {
    const { teamFromRow } = await import('./data/franchise-teams.js');
    const all = { ts_abbr: 'SEA', ts_name: 'SuperSonics', ts_city: 'Seattle', era_abbr: 'XXE', era_name: 'Era', era_city: 'EraCity',
      last_abbr: 'OKC', last_name: 'Thunder', last_city: 'Oklahoma City' };
    expect(teamFromRow(teamRow(OKC, 1975, all) as never)).toMatchObject({ abbreviation: 'SEA', name: 'SuperSonics', city: 'Seattle' });
    expect(teamFromRow(teamRow(OKC, 1975, { ...all, ts_abbr: undefined, ts_name: undefined, ts_city: undefined }) as never))
      .toMatchObject({ abbreviation: 'XXE', name: 'Era', city: 'EraCity' });
    expect(teamFromRow(teamRow(OKC, 1975, { ts_name: 'SuperSonics', last_abbr: 'OKC', last_city: 'Oklahoma City' }) as never))
      .toMatchObject({ abbreviation: 'OKC', name: 'SuperSonics', city: 'Oklahoma City' });
    expect(teamFromRow(teamRow(LAC, 1975, {}) as never)).toEqual({ franchise_id: LAC, abbreviation: 'LAC', name: 'Clippers', city: 'LA', is_clippers: true });
  });

  it('names a 1975 move by its era: Buffalo Braves and Seattle SuperSonics, not LAC/OKC', async () => {
    const teams = fakeTeams([
      teamRow(LAC, 1975, { ts_abbr: 'BUF', ts_name: 'Braves', ts_city: 'Buffalo' }),
      teamRow(OKC, 1975, { era_abbr: 'SEA', era_name: 'SuperSonics', era_city: 'Seattle', last_abbr: 'OKC', last_name: 'Thunder' }),
    ]);
    route((q, values) => {
      if (q.includes('unnest(')) return teams(values);
      if (q.includes('FROM transactions t')) {
        return [{ transaction_id: '7', slug: '1975-10-14-braves-supersonics', date: '1975-10-14', season_id: 1975, kind: 'trade',
          description: 'The Buffalo Braves traded Bob Kauffman to Seattle.', is_complete: true }];
      }
      if (q.includes('FROM transaction_parts p')) {
        return [{ transaction_id: '7', from_franchise_id: LAC, to_franchise_id: OKC, person_key: 'kaufmbo01', display_name: 'Bob Kauffman', player_id: null }];
      }
      return [];
    });
    const { GET } = await import('../../app/api/franchise/moves/route.js');
    const body = await (await GET(new Request('http://localhost/api/franchise/moves?season=1975'))).json();
    expect(body.moves[0].teams).toEqual([
      { franchise_id: LAC, abbreviation: 'BUF', name: 'Braves', city: 'Buffalo', is_clippers: true },
      { franchise_id: OKC, abbreviation: 'SEA', name: 'SuperSonics', city: 'Seattle', is_clippers: false },
    ]);
  });
});

// ─── Picks owed ──────────────────────────────────────────────────────────────

describe('GET /api/franchise/picks', () => {
  it('keeps unknown protections null in picks owed', async () => {
    route((q) => {
      if (q.includes('FROM draft_picks dp')) {
        return [
          // final_owner_franchise_id stays null for future picks: the holder comes from linked parts.
          { pick_id: 6, pick_key: `2028-1-${LAC}`, draft_year: 2028, round: 1, original_franchise_id: LAC,
            protections: null, protections_text: null, protections_known: null, final_owner_franchise_id: null },
          { pick_id: 7, pick_key: `2028-2-${PHI}`, draft_year: 2028, round: 2, original_franchise_id: PHI,
            protections: null, protections_text: null, protections_known: true, final_owner_franchise_id: null },
        ];
      }
      if (q.includes('FROM transaction_parts p') && q.includes('p.pick_id')) {
        return [
          { pick_id: 6, transaction_id: '31', slug: '2023-10-31-james-harden', date: '2023-10-31', season_id: 2023, kind: 'trade',
            from_franchise_id: LAC, to_franchise_id: PHI, gap_reason: 'protections_unknown' },
          { pick_id: 7, transaction_id: '31', slug: '2023-10-31-james-harden', date: '2023-10-31', season_id: 2023, kind: 'trade',
            from_franchise_id: PHI, to_franchise_id: LAC, gap_reason: null },
        ];
      }
      return [];
    });
    const { GET } = await import('../../app/api/franchise/picks/route.js');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.owed).toHaveLength(1);
    const owed = body.owed[0];
    expect(owed.protections_known).toBeNull();
    expect(owed.protections_text).toBeNull();
    expect(owed.protections).toBeNull();
    expect(owed.protections_label).toBe('Protections not recorded');
    expect(owed).toMatchObject({ kind: 'pick', holder_status: 'owed', draft_year: 2028, round: 1, is_own: true,
      trade: { slug: '2023-10-31-james-harden', href: '/franchise/trades/2023-10-31-james-harden', date: '2023-10-31' },
      gap_notes: ['protections not recorded'] });
    expect(owed.owner.abbreviation).toBe('PHI');
    const owned = body.owned[0];
    expect(owned).toMatchObject({ kind: 'pick', holder_status: 'held', is_own: false, protections_known: true, protections_label: 'Unprotected' });
    expect(body.uncertain).toEqual([]);
    expect(callFor('FROM draft_picks dp')![0].join('?')).not.toContain('final_owner');
    expect(owned.original_team.abbreviation).toBe('PHI');
    expect(JSON.stringify(body.owed)).not.toMatch(/Unprotected/);
  });

  // A future pick's holder: to_franchise_id of its latest linked part; no part → the original franchise.
  const BKN = 1610612751;
  const DEN = 1610612743;
  const futurePick = (pick_id: number, draft_year: number, round: number, original_franchise_id: number) => ({
    pick_id, pick_key: `${draft_year}-${round}-${original_franchise_id}`, draft_year, round, original_franchise_id,
    protections: null, protections_text: null, protections_known: true, final_owner_franchise_id: null,
  });

  it("takes a future pick's holder from its latest linked part", async () => {
    route((q) => {
      if (q.includes('FROM draft_picks dp')) return [futurePick(20, 2027, 1, LAC)];
      if (q.includes('FROM transaction_parts p') && q.includes('p.pick_id')) {
        // Returned out of order on purpose: the loader must pick the latest by date.
        return [
          { pick_id: 20, transaction_id: '30', slug: 'phi-bkn', date: '2025-02-01', season_id: 2024, kind: 'trade',
            from_franchise_id: PHI, to_franchise_id: BKN, gap_reason: null },
          { pick_id: 20, transaction_id: '20', slug: 'lac-phi', date: '2023-10-31', season_id: 2023, kind: 'trade',
            from_franchise_id: LAC, to_franchise_id: PHI, gap_reason: null },
        ];
      }
      return [];
    });
    const { GET } = await import('../../app/api/franchise/picks/route.js');
    const body = await (await GET()).json();
    expect(body.owned).toEqual([]);
    expect(body.owed).toHaveLength(1);
    expect(body.owed[0]).toMatchObject({ holder_status: 'owed', note: null, trade: { slug: 'lac-phi' } });
    expect(body.owed[0].owner.abbreviation).toBe('BKN');
    expect(body.owed[0].counterparty.abbreviation).toBe('BKN');
  });

  it('treats a future pick with no linked part as held by its original franchise', async () => {
    route((q) => (q.includes('FROM draft_picks dp') ? [futurePick(21, 2030, 1, LAC)] : []));
    const { GET } = await import('../../app/api/franchise/picks/route.js');
    const body = await (await GET()).json();
    expect(body.owed).toEqual([]);
    expect(body.uncertain).toEqual([]);
    expect(body.owned).toHaveLength(1);
    expect(body.owned[0]).toMatchObject({ holder_status: 'held', is_own: true, trade: null, counterparty: null, note: null });
    expect(body.owned[0].owner.abbreviation).toBe('LAC');
  });

  it('marks a Clippers pick uncertain when a Clippers trade sent an unidentified pick of the same year and round', async () => {
    route((q) => {
      if (q.includes('FROM draft_picks dp')) return [futurePick(22, 2029, 2, LAC), futurePick(23, 2029, 1, LAC)];
      if (q.includes('FROM transaction_parts u')) {
        return [
          { transaction_id: '40', slug: '2024-02-08-lac-den', date: '2024-02-08', season_id: 2023, kind: 'trade',
            unlinked_text: 'a 2029 second round draft pick', from_franchise_id: LAC, to_franchise_id: DEN },
          { transaction_id: '41', slug: '2024-06-01-other', date: '2024-06-01', season_id: 2023, kind: 'trade',
            unlinked_text: 'a 2031 first round draft pick', from_franchise_id: LAC, to_franchise_id: DEN },
        ];
      }
      return [];
    });
    const { GET } = await import('../../app/api/franchise/picks/route.js');
    const body = await (await GET()).json();
    expect(body.uncertain).toHaveLength(1);
    const u = body.uncertain[0];
    expect(u).toMatchObject({
      kind: 'pick', key: `2029-2-${LAC}`, holder_status: 'uncertain', owner: null, is_own: true,
      note: 'may have been traded; details not recorded',
      trade: { slug: '2024-02-08-lac-den', href: '/franchise/trades/2024-02-08-lac-den', date: '2024-02-08' },
    });
    expect(u.counterparty.abbreviation).toBe('DEN');
    // The 2029 first (round differs) is still held.
    expect(body.owned.map((a: { key: string }) => a.key)).toEqual([`2029-1-${LAC}`]);
    const unlinked = callFor('FROM transaction_parts u')![0].join('?');
    expect(unlinked).toContain('u.pick_id IS NULL');
    expect(unlinked).toContain("u.gap_reason = 'pick_unidentified'");
  });

  it('does not mark a pick uncertain once a linked part already sent it out', async () => {
    route((q) => {
      if (q.includes('FROM draft_picks dp')) return [futurePick(24, 2029, 2, LAC)];
      if (q.includes('FROM transaction_parts p') && q.includes('p.pick_id')) {
        return [{ pick_id: 24, transaction_id: '50', slug: 'lac-den-linked', date: '2024-02-08', season_id: 2023, kind: 'trade',
          from_franchise_id: LAC, to_franchise_id: DEN, gap_reason: null }];
      }
      if (q.includes('FROM transaction_parts u')) {
        return [{ transaction_id: '40', slug: 'x', date: '2024-02-08', season_id: 2023, kind: 'trade',
          unlinked_text: 'a 2029 second round draft pick', from_franchise_id: LAC, to_franchise_id: DEN }];
      }
      return [];
    });
    const { GET } = await import('../../app/api/franchise/picks/route.js');
    const body = await (await GET()).json();
    expect(body.uncertain).toEqual([]);
    expect(body.owed[0]).toMatchObject({ holder_status: 'owed', trade: { slug: 'lac-den-linked' } });
  });

  it('lists a future swap the Clippers hold as owned', async () => {
    route((q) => {
      if (q.includes('FROM pick_swaps s')) {
        return [{ swap_id: 3, swap_key: `2029-1-${LAC}-${PHI}`, draft_year: 2029, round: 1, franchise_a: LAC, franchise_b: PHI,
          protections: null, protections_text: null, protections_known: null,
          slug: '2023-10-31-james-harden', date: '2023-10-31', season_id: 2023, kind: 'trade',
          from_franchise_id: PHI, to_franchise_id: LAC, gap_reason: 'protections_unknown' }];
      }
      return [];
    });
    const { GET } = await import('../../app/api/franchise/picks/route.js');
    const body = await (await GET()).json();
    expect(body.owned).toHaveLength(1);
    expect(body.owned[0]).toMatchObject({ kind: 'swap', holder_status: 'held', draft_year: 2029, protections_known: null, protections_label: 'Protections not recorded' });
    expect(body.owned[0].counterparty.abbreviation).toBe('PHI');
    expect(body.owed).toEqual([]);
  });
});

// ─── Draft ───────────────────────────────────────────────────────────────────

describe('GET /api/franchise/draft', () => {
  it('groups picks by year with provenance, owner and an optional lottery line', async () => {
    const ORL = 1610612753;
    const HOU = 1610612745;
    const CLE = 1610612739;
    route((q) => {
      if (q.includes('FROM draft_picks dp')) {
        return [
          { pick_id: 9, pick_key: `2021-2-${ORL}`, draft_year: 2021, round: 2, original_franchise_id: ORL, status: 'used', overall_pick: 33,
            final_owner_franchise_id: LAC, selected_person: 'prestja01', display_name: 'Jason Preston', player_id: null,
            pre_lottery_slot: null, odds_first: null, pick_won: null, tie_unresolved: null, lottery_source: null },
          { pick_id: 15, pick_key: `2011-1-${LAC}`, draft_year: 2011, round: 1, original_franchise_id: LAC, status: 'used', overall_pick: 1,
            final_owner_franchise_id: CLE, selected_person: 'irvinky01', display_name: 'Kyrie Irving', player_id: '77', nba_person_id: 202681,
            pre_lottery_slot: 8, odds_first: '2.800', pick_won: 1, tie_unresolved: false, lottery_source: 'wiki' },
        ];
      }
      if (q.includes('FROM transaction_parts p')) {
        return [
          { pick_id: 9, slug: 'orl-hou', date: '2020-11-18', season_id: 2020, kind: 'trade', from_franchise_id: ORL, to_franchise_id: HOU },
          { pick_id: 9, slug: 'hou-lac', date: '2021-02-25', season_id: 2020, kind: 'trade', from_franchise_id: HOU, to_franchise_id: LAC },
        ];
      }
      return [];
    });
    const { GET } = await import('../../app/api/franchise/draft/route.js');
    const body = await (await GET()).json();
    expect(body.years.map((y: { draft_year: number }) => y.draft_year)).toEqual([2021, 2011]);
    const preston = body.years[0].picks[0];
    expect(preston.original_team.abbreviation).toBe('ORL');
    expect(preston.via.map((t: { abbreviation: string }) => t.abbreviation)).toEqual(['HOU']);
    expect(preston).toMatchObject({ traded_away: false, lottery: null, player: { name: 'Jason Preston', href: null, nba_person_id: null } });
    expect(body.years[1].picks[0].player).toMatchObject({ name: 'Kyrie Irving', nba_person_id: 202681 });
    expect(callFor('FROM draft_picks dp')![0].join('?')).toContain('COALESCE(x.nba_person_id, pl.nba_person_id)');
    expect(preston.chain.map((h: { slug: string }) => h.slug)).toEqual(['orl-hou', 'hou-lac']);
    const kyrie = body.years[1].picks[0];
    expect(kyrie).toMatchObject({ traded_away: true, player: { href: '/players/77' } });
    expect(kyrie.owner.abbreviation).toBe('CLE');
    expect(kyrie.lottery).toEqual({ pre_lottery_slot: 8, odds_first: 2.8, pick_won: 1, tie_unresolved: false, movement: 'jumped', source: 'wiki' });
  });

  it('falls back to the latest linked part for a pick with no recorded final owner', async () => {
    const HOU = 1610612745;
    route((q) => {
      if (q.includes('FROM draft_picks dp')) {
        return [{ pick_id: 30, pick_key: `2019-2-${LAC}`, draft_year: 2019, round: 2, original_franchise_id: LAC, status: null, overall_pick: null,
          final_owner_franchise_id: null, selected_person: null, display_name: null, player_id: null,
          pre_lottery_slot: null, odds_first: null, pick_won: null, tie_unresolved: null, lottery_source: null }];
      }
      if (q.includes('FROM transaction_parts p')) {
        return [{ pick_id: 30, transaction_id: '5', slug: 'lac-hou', date: '2017-06-28', season_id: 2016, kind: 'trade', from_franchise_id: LAC, to_franchise_id: HOU }];
      }
      return [];
    });
    const { GET } = await import('../../app/api/franchise/draft/route.js');
    const pick = (await (await GET()).json()).years[0].picks[0];
    expect(pick.owner.abbreviation).toBe('HOU');
    expect(pick.traded_away).toBe(true);
  });

  it('keeps unknown lottery odds null', async () => {
    route((q) => q.includes('FROM draft_picks dp') ? [{
      pick_id: 1, pick_key: 'k', draft_year: 1985, round: 1, original_franchise_id: LAC, status: 'used', overall_pick: 3,
      final_owner_franchise_id: LAC, selected_person: null, display_name: null, player_id: null,
      pre_lottery_slot: 3, odds_first: null, pick_won: 3, tie_unresolved: null, lottery_source: 'derived' }] : []);
    const { GET } = await import('../../app/api/franchise/draft/route.js');
    const body = await (await GET()).json();
    expect(body.years[0].picks[0].lottery).toMatchObject({ odds_first: null, tie_unresolved: null, movement: 'held' });
    expect(body.years[0].picks[0].player).toBeNull();
  });
});

// ─── Contracts ───────────────────────────────────────────────────────────────

describe('GET /api/franchise/contracts', () => {
  it('reads only the newest snapshot and keeps unknown guarantees null', async () => {
    route((q) => {
      if (q.includes('FROM contracts c')) {
        return [
          { snapshot_id: 'cap-2026-11-09', fetched_at: new Date('2026-11-09T06:00:00Z'), person_key: 'leonaka01', display_name: 'Kawhi Leonard',
            player_id: '1', nba_person_id: 202695, season_id: 2026, amount_usd: '50000000', guaranteed_usd: '50000000', option: null },
          { snapshot_id: 'cap-2026-11-09', fetched_at: new Date('2026-11-09T06:00:00Z'), person_key: 'leonaka01', display_name: 'Kawhi Leonard',
            player_id: '1', season_id: 2027, amount_usd: '57500000', guaranteed_usd: null, option: 'player' },
        ];
      }
      if (q.includes('FROM payroll_seasons')) {
        return [{ season_id: 1984, listed_players: 3, roster_players: 14, listed_total_usd: '2520000', is_partial: true }];
      }
      return [];
    });
    const { GET } = await import('../../app/api/franchise/contracts/route.js');
    const res = await GET();
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
    const body = await res.json();
    expect(callFor('FROM contracts c')![0].join('?')).toMatch(/ORDER BY fetched_at DESC[\s\S]*LIMIT 1/);
    expect(body.snapshot_fetched_at).toBe('2026-11-09T06:00:00.000Z');
    expect(body.snapshot_id).toBe('cap-2026-11-09');
    expect(body.seasons).toEqual([2026, 2027]);
    expect(body.players[0].person).toMatchObject({ name: 'Kawhi Leonard', href: '/players/1', nba_person_id: 202695 });
    expect(callFor('FROM contracts c')![0].join('?')).toContain('COALESCE(x.nba_person_id, pl.nba_person_id)');
    expect(body.players[0].seasons[1]).toEqual({ season_id: 2027, amount_usd: 57500000, guaranteed_usd: null, option: 'player' });
    expect(body.payroll[0]).toEqual({ season_id: 1984, season_label: '1984-85', listed_players: 3, roster_players: 14, listed_total_usd: 2520000, is_partial: true });
  });

  it('returns an empty cap sheet with null snapshot when there is no snapshot', async () => {
    const { GET } = await import('../../app/api/franchise/contracts/route.js');
    const body = await (await GET()).json();
    expect(body).toMatchObject({ snapshot_id: null, snapshot_fetched_at: null, players: [], seasons: [], payroll: [] });
  });
});

// ─── Front office ────────────────────────────────────────────────────────────

describe('GET /api/franchise/front-office', () => {
  it('returns coach seasons with ordinal and null playoff records, and executive terms', async () => {
    route((q) => {
      if (q.includes('FROM coach_seasons cs')) {
        return [
          { season_id: 2002, ordinal: 1, person_key: 'gentral01', display_name: 'Alvin Gentry', player_id: null,
            games: 41, wins: 14, losses: 27, playoff_wins: null, playoff_losses: null },
          { season_id: 2002, ordinal: 2, person_key: 'dunlemi01', display_name: 'Mike Dunleavy', player_id: null,
            games: 41, wins: 17, losses: 24, playoff_wins: null, playoff_losses: null },
        ];
      }
      if (q.includes('FROM executive_terms e')) {
        return [{ person_key: 'baylore01', display_name: 'Elgin Baylor', player_id: null, nba_person_id: 76127, title: 'Vice President', start_date: '1986-07-01', end_date: null }];
      }
      return [];
    });
    const { GET } = await import('../../app/api/franchise/front-office/route.js');
    const res = await GET();
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
    const body = await res.json();
    expect(body.meta.ttl_seconds).toBe(86400);
    expect(body.coach_seasons[1]).toMatchObject({ season_id: 2002, season_label: '2002-03', ordinal: 2, playoff_wins: null, playoff_losses: null,
      coach: { person_key: 'dunlemi01', name: 'Mike Dunleavy', nba_person_id: null } });
    expect(body.executives[0]).toMatchObject({ title: 'Vice President', start_date: '1986-07-01', end_date: null, person: { name: 'Elgin Baylor', nba_person_id: 76127 } });
  });
});

// ─── Honors ──────────────────────────────────────────────────────────────────

describe('GET /api/franchise/honors', () => {
  it('separates Clippers retired numbers from league-wide ones and groups awards by season', async () => {
    route((q) => q.includes('FROM honors h') ? [
      { season_id: null, person_key: 'russebi01', display_name: 'Bill Russell', player_id: null, honor: 'retired_number_league', detail: 'No. 6' },
      { season_id: null, person_key: 'waltobi01', display_name: 'Bill Walton', player_id: null, honor: 'hall_of_fame', detail: '1993' },
      { season_id: 2020, person_key: 'leonaka01', display_name: 'Kawhi Leonard', player_id: '1', nba_person_id: '202695', honor: 'all_nba_1', detail: null },
      { season_id: 2019, person_key: 'leonaka01', display_name: 'Kawhi Leonard', player_id: '1', honor: 'all_star', detail: null },
    ] : []);
    const { GET } = await import('../../app/api/franchise/honors/route.js');
    const res = await GET();
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
    const body = await res.json();
    expect(body.retired_number).toEqual([]);
    expect(body.retired_number_league).toHaveLength(1);
    expect(body.retired_number_league[0]).toMatchObject({ detail: 'No. 6', person: { name: 'Bill Russell' } });
    expect(body.hall_of_fame[0]).toMatchObject({ season_id: null, detail: '1993' });
    expect(body.awards_by_season.map((s: { season_id: number }) => s.season_id)).toEqual([2020, 2019]);
    expect(body.awards_by_season[0].honors[0]).toMatchObject({ honor: 'all_nba_1', label: 'All-NBA First Team', person: { href: '/players/1', nba_person_id: 202695 } });
    expect(body.retired_number_league[0].person.nba_person_id).toBeNull();
  });
});

// ─── Trade ───────────────────────────────────────────────────────────────────

describe('GET /api/franchise/trades/[slug]', () => {
  it('returns 404 for an unknown slug', async () => {
    const { GET } = await import('../../app/api/franchise/trades/[slug]/route.js');
    const res = await GET(new Request('http://localhost/api/franchise/trades/nope'), { params: Promise.resolve({ slug: 'nope' }) });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });

  it('returns the header, sides, gap notes and tree for a trade', async () => {
    route((q) => {
      if (q.includes('WHERE t.slug')) {
        return [{ transaction_id: '8', slug: '2022-02-10-batum-denver-partial', date: '2022-02-10', season_id: 2021, kind: 'trade',
          description: 'The Clippers sent Nicolas Batum to Denver.', is_complete: false, involves_clippers: true, sources: ['nba:Trade 1'] }];
      }
      if (q.includes('FROM transaction_parts p')) {
        return [
          { transaction_id: '8', slug: '2022-02-10-batum-denver-partial', date: '2022-02-10', season_id: 2021, kind: 'trade', involves_clippers: true,
            from_franchise_id: LAC, to_franchise_id: 1610612743, asset_kind: 'player', person_key: 'batumni01', pick_id: null, swap_id: null,
            unlinked_text: null, gap_reason: null },
          { transaction_id: '8', slug: '2022-02-10-batum-denver-partial', date: '2022-02-10', season_id: 2021, kind: 'trade', involves_clippers: true,
            from_franchise_id: 1610612743, to_franchise_id: LAC, asset_kind: 'pick', person_key: null, pick_id: null, swap_id: null,
            unlinked_text: 'a future second-round pick', gap_reason: 'pick_unidentified' },
        ];
      }
      if (q.includes('FROM person_xref x')) return [{ person_key: 'batumni01', display_name: 'Nicolas Batum', player_id: null, nba_person_id: 201587 }];
      return [];
    });
    const { GET } = await import('../../app/api/franchise/trades/[slug]/route.js');
    const res = await GET(new Request('http://localhost/api/franchise/trades/x'), { params: Promise.resolve({ slug: '2022-02-10-batum-denver-partial' }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
    const body = await res.json();
    expect(body.trade).toMatchObject({ slug: '2022-02-10-batum-denver-partial', date: '2022-02-10', is_complete: false });
    expect(body.sides.map((s: { team: { abbreviation: string } }) => s.team.abbreviation)).toEqual(['LAC', 'DEN']);
    expect(body.sides[0].received[0]).toMatchObject({ label: 'a future second-round pick', gap_note: 'pick not identified', pick: null });
    expect(body.gap_notes).toEqual(['pick not identified']);
    expect(body.became.map((n: { label: string }) => n.label)).toEqual(['a future second-round pick', 'Nicolas Batum']);
    expect(body.became[1].note).toBe('no further record');
    expect(body.sides[1].received[0].person).toMatchObject({ name: 'Nicolas Batum', nba_person_id: 201587 });
    expect(body.became[1].person).toMatchObject({ nba_person_id: 201587 });
    expect(queries().some((q) => q.includes('WHERE t.slug'))).toBe(true);
  });
});

// ─── People (Moves player search) ────────────────────────────────────────────

describe('GET /api/franchise/people', () => {
  it('lists the distinct people in Clippers moves by name, with move counts and headshot ids', async () => {
    route((q) =>
      q.includes('FROM transaction_parts p')
        ? [
            { person_key: 'gallida01', display_name: 'Danilo Gallinari', player_id: null, nba_person_id: 201568, move_count: '2' },
            { person_key: 'georgpa01', display_name: 'Paul George', player_id: '4', nba_person_id: null, move_count: 1 },
          ]
        : [],
    );
    const { GET } = await import('../../app/api/franchise/people/route.js');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
    const body = await res.json();
    expect(body.people).toEqual([
      { person_key: 'gallida01', name: 'Danilo Gallinari', player_id: null, nba_person_id: 201568, href: null, move_count: 2 },
      { person_key: 'georgpa01', name: 'Paul George', player_id: '4', nba_person_id: null, href: '/players/4', move_count: 1 },
    ]);
    const text = callFor('FROM transaction_parts p')![0].join('?');
    expect(text).toContain('t.involves_clippers = true');
    expect(text).toContain('count(DISTINCT t.transaction_id)');
    expect(text).toMatch(/ORDER BY COALESCE\(x\.display_name, p\.person_key\)/);
  });

  it('is registered for server pages (getJson)', async () => {
    vi.resetModules();
    vi.doMock('next/cache', () => ({ unstable_cache: <T>(fn: T) => fn }));
    const api = await import('./ui/api');
    route((q) => (q.includes('FROM transaction_parts p') ? [{ person_key: 'k', display_name: 'K', player_id: null, nba_person_id: null, move_count: 1 }] : []));
    const body = await api.getJson<{ people: unknown[] }>('/api/franchise/people');
    expect(body?.people).toHaveLength(1);
  });
});
