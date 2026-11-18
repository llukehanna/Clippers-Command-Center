// Integration test of scripts/lib/franchise/write.ts against a LOCAL Postgres.
// Skipped unless FIXTURE_DATABASE_URL is set. The database is WIPED.
//   FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55499/fixture npx vitest run scripts/lib/franchise/write
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { NBA_TEAM_IDS } from '../nba-teams.js';
import type { Db } from '../history/write.js';
import type { MergedMove } from './reconcile-moves.js';
import type { FranchiseDataset, MovePart } from './types.js';
import { adoptExisting, mergePerson, writeFranchise, type WriteMode } from './write.js';

const url = process.env.FIXTURE_DATABASE_URL;
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const { LAC, BOS, OKC, CHA } = NBA_TEAM_IDS;
const imp = (seasons: number[]): WriteMode => ({ kind: 'import', importSources: ['bbref:', 'wiki:', 'override:'], seasons });
const IMPORT = imp([2004, 2019, 2026]);
const NIGHTLY: WriteMode = { kind: 'job', job: 'nightly' };

const FRANCHISE_TABLES = [
  'person_xref', 'draft_picks', 'pick_swaps', 'transactions', 'transaction_parts', 'draft_lottery',
  'salaries', 'payroll_seasons', 'contracts', 'coach_seasons', 'executive_terms', 'honors', 'players',
] as const;

function dataset(over: Partial<FranchiseDataset> = {}): FranchiseDataset {
  return {
    currentDraftYear: 2027, people: [], moves: [], picks: [], swaps: [], lottery: [], salaries: [],
    payrollSeasons: [], contracts: [], coachSeasons: [], execTerms: [], honors: [], unparsed: [], ignored: [],
    dropped: [], skipped: [], peopleUnmatched: [], peopleAmbiguous: [], breaks: [], disputes: [], unkeyed: [],
    skippedCategories: [], ...over,
  };
}

function move(key: string, date: string, kind: MergedMove['kind'], parts: MovePart[], sources = [key]): MergedMove {
  return {
    sourceKey: key, transactionKey: key, sources, date, kind, parts, involvesClippers: true, complete: true, conflicts: [],
  };
}

const person = (personKey: string, displayName: string, extra: { nbaPersonId?: number; playerId?: string; kind?: 'player' | 'coach' | 'executive' } = {}) => ({
  personKey, kind: extra.kind ?? 'player' as const, displayName, birthdate: null,
  nbaPersonId: extra.nbaPersonId ?? null, playerId: extra.playerId ?? null,
});

const total = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

describe.skipIf(!url)('franchise writer (fixture DB)', () => {
  let sql: postgres.Sql;
  const db = () => sql as unknown as Db;

  async function snapshot(): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {};
    for (const t of FRANCHISE_TABLES) {
      const rows = await sql<{ j: string }[]>`SELECT to_jsonb(x)::text AS j FROM ${sql(t)} x ORDER BY 1`;
      out[t] = rows.map((r) => r.j);
    }
    return out;
  }

  beforeAll(async () => {
    sql = postgres(url!, { max: 1, onnotice: () => {} }); // max 1: DB_SCHEMA.sql has BEGIN/COMMIT
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await sql.unsafe(read('Docs/DB_SCHEMA.sql'));
  });
  beforeEach(async () => {
    await sql.unsafe(`TRUNCATE ${FRANCHISE_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  });
  afterAll(async () => { await sql?.end(); });

  it('is idempotent: a second identical write changes nothing', async () => {
    const [p] = await sql<{ player_id: string }[]>`
      INSERT INTO players (first_name, last_name, display_name) VALUES ('Melvin', 'Ely', 'Melvin Ely') RETURNING player_id::text`;
    const data = dataset({
      people: [
        person('elyme01', 'Melvin Ely', { playerId: p.player_id, nbaPersonId: 2405 }),
        person('houseed01', 'Eddie House'),
      ],
      picks: [{
        pickKey: '2005-2-CHA', year: 2005, round: 2, originalFranchiseId: CHA, protections: [], protectionsText: null,
        protectionsKnown: true, status: 'used', overall: 41, selectedPersonKey: null, finalOwnerFranchiseId: LAC,
      }],
      swaps: [{
        swapKey: '2006-2-CHA-LAC', year: 2006, round: 2, franchiseA: CHA, franchiseB: LAC, protections: null,
        protectionsText: null, protectionsKnown: false, exercised: null,
      }],
      lottery: [{ year: 2005, pickKey: '2005-2-CHA', preSlot: 5, oddsFirst: 8.9, pickWon: 5, source: 'wiki', tieUnresolved: false, flags: [] }],
      moves: [
        move('bbref:2005-02-24:trade:elyme01|houseed01', '2005-02-24', 'trade', [
          { from: LAC, to: CHA, kind: 'player', person: { name: 'Melvin Ely', bbrefId: 'elyme01' } },
          { from: LAC, to: CHA, kind: 'player', person: { name: 'Eddie House', bbrefId: 'houseed01' } },
          { from: CHA, to: LAC, kind: 'pick', pick: { year: 2005, round: 2 }, pickKey: '2005-2-CHA' },
          { from: CHA, to: LAC, kind: 'swap', swap: { year: 2006, round: 2, franchiseA: CHA, franchiseB: LAC }, swapKey: '2006-2-CHA-LAC' },
          { from: CHA, to: LAC, kind: 'player', person: { name: 'Nobody Known' } },
        ], ['bbref:2005-02-24:trade:elyme01|houseed01', 'wiki:2004–05 season#Trades']),
        move('bbref:2004-08-01:signing:houseed01', '2004-08-01', 'signing', [
          { from: null, to: LAC, kind: 'player', person: { name: 'Eddie House', bbrefId: 'houseed01' } },
        ]),
      ],
      salaries: [{ seasonId: 2004, personKey: 'elyme01', amountUsd: 1_000_000, source: 'bbref:LAC-2005' }],
      payrollSeasons: [{ seasonId: 2004, listedPlayers: 1, rosterPlayers: 14, listedTotalUsd: 1_000_000, isPartial: true }],
      contracts: [{ personKey: 'houseed01', seasonId: 2026, amountUsd: 5_000_000, guaranteedUsd: null, option: 'team', fetchedAt: '2026-11-01T00:00:00.000Z' }],
      coachSeasons: [{ seasonId: 2004, bbrefId: 'dunlemi01c', name: 'Mike Dunleavy', games: 82, wins: 37, losses: 45, playoffWins: null, playoffLosses: null, order: 1 }],
      execTerms: [
        { personKey: 'bayloel99x', name: 'Elgin Baylor', title: 'VP of Basketball Operations', startDate: '1986-04-01', endDate: '2008-10-06' },
        { personKey: null, name: 'Unlinked Exec', title: null, startDate: null, endDate: null },
      ],
      honors: [
        { seasonId: 2004, name: 'Melvin Ely', honor: 'all_star', detail: null, personKey: 'elyme01' },
        { seasonId: null, name: 'Nobody', honor: 'retired_number', detail: '99', personKey: null },
      ],
    });

    const first = await writeFranchise(db(), data, IMPORT);
    expect(first.inserted.transactions).toBe(2);
    expect(first.inserted.transaction_parts).toBe(6);
    expect(first.skipped.map((s) => s.table).sort()).toEqual(['executive_terms', 'honors']);
    const [ely] = await sql`SELECT description, slug, sources, is_complete FROM transactions WHERE transaction_key LIKE 'bbref:2005%'`;
    expect(ely.description).toMatch(/Melvin Ely/);
    expect(ely.sources).toEqual(['bbref:2005-02-24:trade:elyme01|houseed01', 'wiki:2004–05 season#Trades']);
    expect(ely.is_complete).toBe(false); // the unknown person
    const unknown = await sql`SELECT person_key, gap_reason FROM transaction_parts WHERE unlinked_text IS NULL AND asset_kind = 'player' AND person_key IS NULL`;
    expect(unknown).toEqual([{ person_key: null, gap_reason: 'person_unmatched' }]);
    const [coach] = await sql`SELECT kind, display_name FROM person_xref WHERE person_key = 'dunlemi01c'`;
    expect(coach).toEqual({ kind: 'coach', display_name: 'Mike Dunleavy' });

    const before = await snapshot();
    const second = await writeFranchise(db(), data, IMPORT);
    expect(await snapshot()).toEqual(before);
    expect(total(second.inserted) + total(second.updated) + total(second.deleted) + second.merged).toBe(0);
  });

  it('adopts an existing job row instead of inserting a duplicate', async () => {
    await sql`INSERT INTO person_xref (person_key, kind, display_name) VALUES ('georgpa01', 'player', 'Paul George')`;
    const [t] = await sql`
      INSERT INTO transactions (transaction_key, slug, date, season_id, involves_clippers, kind, description, sources, is_complete)
      VALUES ('espn:2019-07-06:trade:1', '2019-07-06-abcdef', '2019-07-06', 2019, true, 'trade', 'Acquired Paul George',
              ARRAY['espn:2019-07-06:trade:1'], false)
      RETURNING transaction_id`;
    await sql`INSERT INTO transaction_parts (transaction_id, from_franchise_id, to_franchise_id, asset_kind, person_key)
      VALUES (${t.transaction_id}, ${OKC}, ${LAC}, 'player', 'georgpa01')`;

    const m = move('nba:Trade 1158000', '2019-07-08', 'trade', [
      { from: OKC, to: LAC, kind: 'player', person: { name: 'Paul George', bbrefId: 'georgpa01' } },
      { from: LAC, to: OKC, kind: 'cash', text: 'cash' },
    ], ['nba:Trade 1158000', 'bbref:2019-07-10:trade:georgpa01']);
    expect(await adoptExisting(db(), m)).toBe('espn:2019-07-06:trade:1');
    // A different kind or a date more than 3 days away is a different event.
    expect(await adoptExisting(db(), { ...m, kind: 'signing' })).toBeNull();
    expect(await adoptExisting(db(), { ...m, date: '2019-07-10' })).toBeNull();

    await writeFranchise(db(), dataset({ people: [person('georgpa01', 'Paul George')], moves: [m] }), IMPORT);
    const rows = await sql`SELECT transaction_key, slug, sources FROM transactions`;
    expect(rows).toHaveLength(1);
    expect(rows[0].transaction_key).toBe('espn:2019-07-06:trade:1');
    expect(rows[0].slug).toBe('2019-07-06-abcdef');
    expect(rows[0].sources).toEqual(['espn:2019-07-06:trade:1', 'nba:Trade 1158000', 'bbref:2019-07-10:trade:georgpa01']);
    const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM transaction_parts`;
    expect(n).toBe(2);

  });

  it('merges an nba-only person into the bbref row', async () => {
    await sql`INSERT INTO person_xref (person_key, kind, display_name, nba_person_id) VALUES
      ('nba:201935', 'player', 'James Harden', 201935), ('hardeja01', 'player', 'James Harden', NULL)`;
    const [t] = await sql`
      INSERT INTO transactions (transaction_key, slug, date, season_id, involves_clippers, kind, description, sources, is_complete)
      VALUES ('nba:Trade 9', '2023-10-31-aaaaaa', '2023-10-31', 2023, true, 'trade', 'Acquired James Harden', ARRAY['nba:Trade 9'], true)
      RETURNING transaction_id`;
    await sql`INSERT INTO transaction_parts (transaction_id, from_franchise_id, to_franchise_id, asset_kind, person_key)
      VALUES (${t.transaction_id}, 1610612755, ${LAC}, 'player', 'nba:201935')`;
    await sql`INSERT INTO salaries (season_id, person_key, amount_usd, source) VALUES
      (2023, 'nba:201935', 35000000, 'weekly'), (2024, 'nba:201935', 33000000, 'weekly'), (2023, 'hardeja01', 35000000, 'bbref:LAC-2024')`;

    // A part whose personKey is the old `nba:` key still resolves once the person is merged this run.
    const later = move('nba:1700:201935', '2024-07-01', 're_signing', [
      { from: null, to: LAC, kind: 'player', person: { name: 'James Harden', nbaPersonId: 201935 }, personKey: 'nba:201935' },
    ]);
    const res = await writeFranchise(db(), dataset({ people: [person('hardeja01', 'James Harden', { nbaPersonId: 201935 })], moves: [later] }), NIGHTLY);
    expect(res.merged).toBe(1);
    const people = await sql`SELECT person_key, nba_person_id FROM person_xref ORDER BY person_key`;
    expect(people).toEqual([{ person_key: 'hardeja01', nba_person_id: 201935 }]);
    const parts = await sql`SELECT person_key, gap_reason FROM transaction_parts`;
    expect(parts).toEqual([{ person_key: 'hardeja01', gap_reason: null }, { person_key: 'hardeja01', gap_reason: null }]);
    const sal = await sql`SELECT season_id, person_key FROM salaries ORDER BY season_id`;
    expect(sal).toEqual([{ season_id: 2023, person_key: 'hardeja01' }, { season_id: 2024, person_key: 'hardeja01' }]);

    // No target row yet: the key is renamed and references follow by ON UPDATE CASCADE.
    await sql`INSERT INTO person_xref (person_key, kind, display_name, nba_person_id) VALUES ('nba:5', 'player', 'Five', 5)`;
    await sql`INSERT INTO honors (season_id, person_key, honor) VALUES (2020, 'nba:5', 'all_star')`;
    await mergePerson(db(), 'nba:5', 'fiveon01');
    expect(await sql`SELECT person_key FROM honors`).toEqual([{ person_key: 'fiveon01' }]);
    expect(await sql`SELECT person_key FROM person_xref WHERE person_key IN ('nba:5', 'fiveon01')`).toEqual([{ person_key: 'fiveon01' }]);
  });

  it('import mode deletes its own stale rows but keeps job rows', async () => {
    const people = [person('aaa01', 'A A'), person('bbb01', 'B B')];
    const a = move('bbref:2010-01-05:release:aaa01', '2010-01-05', 'release', [{ from: LAC, to: null, kind: 'player', person: { name: 'A A', bbrefId: 'aaa01' } }]);
    const b = move('bbref:2010-02-05:release:bbb01', '2010-02-05', 'release', [{ from: LAC, to: null, kind: 'player', person: { name: 'B B', bbrefId: 'bbb01' } }]);
    const old = move('bbref:1990-02-05:release:aaa01', '1990-02-05', 'release', [{ from: LAC, to: null, kind: 'player', person: { name: 'A A', bbrefId: 'aaa01' } }]);
    await writeFranchise(db(), dataset({ people, moves: [a, b, old] }), imp([1989, 2009]));

    // Job rows in the same season: one from a job source only, one shared with an import source.
    const job = move('nba:Trade 77', '2010-03-01', 'trade', [{ from: BOS, to: LAC, kind: 'cash', text: 'cash' }]);
    const shared = move('nba:Trade 78', '2010-03-02', 'trade', [{ from: LAC, to: BOS, kind: 'cash', text: 'cash' }],
      ['nba:Trade 78', 'bbref:2010-03-02:trade:x']);
    await writeFranchise(db(), dataset({ moves: [job, shared] }), NIGHTLY);

    // Job mode never deletes, even with an empty dataset.
    const jobRes = await writeFranchise(db(), dataset({ people }), NIGHTLY);
    expect(total(jobRes.deleted)).toBe(0);

    // Re-import covering 2009 only, without `a` (or `old`, from an uncovered season).
    // Import mode needs the seasons its cache covers.
    await expect(writeFranchise(db(), dataset({ people, moves: [b] }), { kind: 'import', importSources: ['bbref:'] } as unknown as WriteMode))
      .rejects.toThrow(/seasons/);
    const res = await writeFranchise(db(), dataset({ people, moves: [b] }), imp([2009]));
    expect(res.deleted.transactions).toBe(1);
    const keys = (await sql`SELECT transaction_key FROM transactions ORDER BY transaction_key`).map((r) => r.transaction_key);
    expect(keys).toEqual(['bbref:1990-02-05:release:aaa01', 'bbref:2010-02-05:release:bbb01', 'nba:Trade 77', 'nba:Trade 78']);
    const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM transaction_parts`;
    expect(n).toBe(4);
  });

  it('keeps the previous contracts snapshot when the new insert fails', async () => {
    const people = [person('zubaciv01', 'Ivica Zubac')];
    const row = (fetchedAt: string, amountUsd: number, option: string | null = null) => ({
      personKey: 'zubaciv01', seasonId: 2026, amountUsd, guaranteedUsd: null, option: option as 'team' | null, fetchedAt,
    });
    await writeFranchise(db(), dataset({ people, contracts: [row('2026-10-01T00:00:00.000Z', 1)] }), IMPORT);
    const amounts = async () => (await sql`SELECT amount_usd::int AS a FROM contracts`).map((r) => r.a);
    expect(await amounts()).toEqual([1]);

    const bad = dataset({ people, contracts: [row('2026-11-01T00:00:00.000Z', 2), { ...row('2026-11-01T00:00:00.000Z', 3, 'bogus'), seasonId: 2027 }] });
    await expect(writeFranchise(db(), bad, IMPORT)).rejects.toThrow();
    expect(await amounts()).toEqual([1]);

    // An import whose cached page is older than the newest snapshot leaves contracts alone.
    await writeFranchise(db(), dataset({ people, contracts: [row('2026-09-01T00:00:00.000Z', 4)] }), IMPORT);
    expect(await amounts()).toEqual([1]);

    // A newer page replaces the snapshot.
    await writeFranchise(db(), dataset({ people, contracts: [row('2026-11-02T00:00:00.000Z', 5)] }), IMPORT);
    expect(await amounts()).toEqual([5]);
  });

  it('keeps two trades of the same player days apart as two rows', async () => {
    const people = [person('georgpa01', 'Paul George')];
    const pg = { name: 'Paul George', bbrefId: 'georgpa01' };
    const tradeA = move('nba:Trade 100', '2019-07-06', 'trade', [{ from: OKC, to: LAC, kind: 'player', person: pg }]);
    const tradeB = move('nba:Trade 101', '2019-07-08', 'trade', [{ from: LAC, to: BOS, kind: 'player', person: pg }]);
    await writeFranchise(db(), dataset({ people, moves: [tradeA] }), NIGHTLY);
    await writeFranchise(db(), dataset({ people, moves: [tradeB] }), NIGHTLY);
    await writeFranchise(db(), dataset({ people, moves: [tradeA, tradeB] }), NIGHTLY);
    const rows = await sql`SELECT transaction_key, sources FROM transactions ORDER BY transaction_key`;
    expect(rows).toEqual([
      { transaction_key: 'nba:Trade 100', sources: ['nba:Trade 100'] },
      { transaction_key: 'nba:Trade 101', sources: ['nba:Trade 101'] },
    ]);
    // Same direction but a different NBA.com trade id: still a different event.
    const tradeC = move('nba:Trade 102', '2019-07-07', 'trade', [{ from: OKC, to: LAC, kind: 'player', person: pg }]);
    expect(await adoptExisting(db(), tradeC)).toBeNull();
    // A source the stored row lacks (no rival key), same player, other direction: a different event.
    const away = move('bbref:2019-07-07:trade:georgpa01', '2019-07-07', 'trade', [{ from: LAC, to: BOS, kind: 'player', person: pg }]);
    expect(await adoptExisting(db(), { ...away, date: '2019-07-04' })).toBeNull();
    expect(await adoptExisting(db(), { ...away, parts: [{ from: OKC, to: LAC, kind: 'player', person: pg }], date: '2019-07-04' }))
      .toBe('nba:Trade 100');
  });

  it('a job never loses a linked part of an incomplete row', async () => {
    const people = [person('georgpa01', 'Paul George'), person('gallida01', 'Danilo Gallinari')];
    const picks = [{
      pickKey: '2022-1-LAC', year: 2022, round: 1, originalFranchiseId: LAC, protections: [], protectionsText: null,
      protectionsKnown: true, status: 'used' as const, overall: 12, selectedPersonKey: null, finalOwnerFranchiseId: OKC,
    }];
    const pg: MovePart = { from: OKC, to: LAC, kind: 'player', person: { name: 'Paul George', bbrefId: 'georgpa01' } };
    const linkedPick: MovePart = { from: LAC, to: OKC, kind: 'pick', pick: { year: 2022, round: 1 }, pickKey: '2022-1-LAC' };
    const imported = move('bbref:2019-07-10:trade:georgpa01', '2019-07-10', 'trade',
      [pg, linkedPick, { from: LAC, to: OKC, kind: 'player', person: { name: 'Danilo Gallinari' } }]);
    await writeFranchise(db(), dataset({ people, picks, moves: [imported] }), imp([2019]));
    const partsOf = async () => (await sql`SELECT person_key, pick_id, gap_reason FROM transaction_parts ORDER BY part_id`)
      .map((r) => [r.person_key, r.pick_id, r.gap_reason]);
    const before = await partsOf();
    expect(before).toEqual([['georgpa01', null, null], [null, 1, null], [null, null, 'person_unmatched']]);
    const [{ description }] = await sql`SELECT description FROM transactions`;

    // NBA.com's nightly reading: "draft consideration" instead of the linked pick. Only its source key is added.
    const worse = move('nba:Trade 1158000', '2019-07-08', 'trade',
      [pg, { from: LAC, to: OKC, kind: 'pick', text: 'draft consideration', gap: 'pick_unidentified' }]);
    await writeFranchise(db(), dataset({ people, moves: [{ ...worse, complete: false }] }), NIGHTLY);
    expect(await partsOf()).toEqual(before);
    const [row] = await sql`SELECT transaction_key, description, sources, is_complete FROM transactions`;
    expect(row).toEqual({
      transaction_key: 'bbref:2019-07-10:trade:georgpa01', description, is_complete: false,
      sources: ['bbref:2019-07-10:trade:georgpa01', 'nba:Trade 1158000'],
    });

    // A strictly better reading (the unmatched person now resolves, the pick stays linked) does replace it.
    const better = move('nba:Trade 1158000', '2019-07-08', 'trade',
      [pg, linkedPick, { from: LAC, to: OKC, kind: 'player', person: { name: 'Danilo Gallinari', bbrefId: 'gallida01' } }]);
    await writeFranchise(db(), dataset({ people, moves: [better] }), NIGHTLY);
    expect(await partsOf()).toEqual([['georgpa01', null, null], [null, 1, null], ['gallida01', null, null]]);
    const [after] = await sql`SELECT is_complete FROM transactions`;
    expect(after.is_complete).toBe(true);
  });

  it('import mode prunes stale picks, swaps and lottery rows but keeps referenced ones', async () => {
    const pick = (pickKey: string, year: number) => ({
      pickKey, year, round: 1, originalFranchiseId: Number(pickKey.endsWith('BOS') ? BOS : LAC), protections: null,
      protectionsText: null, protectionsKnown: false, status: 'used' as const, overall: 5, selectedPersonKey: null,
      finalOwnerFranchiseId: LAC,
    });
    const swap = (swapKey: string) => ({
      swapKey, year: 2012, round: 1, franchiseA: BOS, franchiseB: LAC, protections: null, protectionsText: null,
      protectionsKnown: false, exercised: null,
    });
    const lot = (pickKey: string, year: number) => ({ year, pickKey, preSlot: 5, oddsFirst: 8.8, pickWon: 5, source: 'wiki' as const, tieUnresolved: false, flags: [] });
    const seasons = imp([2009]); // the 2010 draft
    await writeFranchise(db(), dataset({
      picks: [pick('2010-1-LAC', 2010), pick('2010-1-BOS', 2010), pick('2011-1-LAC', 2011)],
      swaps: [swap('2012-1-BOS-LAC'), swap('2013-1-BOS-LAC')],
      lottery: [lot('2010-1-LAC', 2010), lot('2010-1-BOS', 2010), lot('2011-1-LAC', 2011)],
    }), seasons);
    // A job move references the 2010 BOS pick and the 2012 swap.
    await writeFranchise(db(), dataset({ moves: [move('nba:Trade 5', '2010-02-01', 'trade', [
      { from: BOS, to: LAC, kind: 'pick', pick: { year: 2010, round: 1 }, pickKey: '2010-1-BOS' },
      { from: BOS, to: LAC, kind: 'swap', swap: { year: 2012, round: 1, franchiseA: BOS, franchiseB: LAC }, swapKey: '2012-1-BOS-LAC' },
    ])] }), NIGHTLY);

    // Re-import: only the 2011 pick (and its lottery row) remain in the dataset; no swaps.
    const res = await writeFranchise(db(), dataset({ picks: [pick('2011-1-LAC', 2011)], lottery: [lot('2011-1-LAC', 2011)] }), seasons);
    const picks = (await sql`SELECT pick_key FROM draft_picks ORDER BY pick_key`).map((r) => r.pick_key);
    expect(picks).toEqual(['2010-1-BOS', '2011-1-LAC']); // 2010-1-LAC: stale and unreferenced
    const swaps = (await sql`SELECT swap_key FROM pick_swaps`).map((r) => r.swap_key);
    expect(swaps).toEqual(['2012-1-BOS-LAC']);
    const lottery = (await sql`SELECT d.pick_key FROM draft_lottery l JOIN draft_picks d USING (pick_id) ORDER BY 1`).map((r) => r.pick_key);
    expect(lottery).toEqual(['2011-1-LAC']); // 2010 rows: covered draft, gone from the dataset
    expect(res.deleted).toMatchObject({ draft_picks: 1, pick_swaps: 1, draft_lottery: 2 });
  });

  it('auto-created coach and executive rows never change an existing person', async () => {
    await sql`INSERT INTO person_xref (person_key, kind, display_name) VALUES ('westje01', 'player', 'Jerry West')`;
    await writeFranchise(db(), dataset({
      execTerms: [{ personKey: 'westje01', name: 'J. West', title: 'Consultant', startDate: '2017-06-19', endDate: null }],
    }), IMPORT);
    expect(await sql`SELECT kind, display_name FROM person_xref`).toEqual([{ kind: 'player', display_name: 'Jerry West' }]);
    expect(await sql`SELECT person_key, title FROM executive_terms`).toEqual([{ person_key: 'westje01', title: 'Consultant' }]);
  });

  it('never overwrites an existing players.nba_person_id', async () => {
    const [p1] = await sql<{ player_id: string }[]>`INSERT INTO players (first_name, last_name, display_name, nba_person_id)
      VALUES ('One', 'Player', 'One Player', 999) RETURNING player_id::text`;
    const [p2] = await sql<{ player_id: string }[]>`INSERT INTO players (first_name, last_name, display_name)
      VALUES ('Two', 'Player', 'Two Player') RETURNING player_id::text`;
    await writeFranchise(db(), dataset({
      people: [
        person('onepl01', 'One Player', { playerId: p1.player_id, nbaPersonId: 201 }),
        person('twopl01', 'Two Player', { playerId: p2.player_id, nbaPersonId: 202 }),
      ],
    }), IMPORT);
    const rows = await sql`SELECT player_id::text, nba_person_id FROM players ORDER BY player_id`;
    expect(rows).toEqual([{ player_id: p1.player_id, nba_person_id: 999 }, { player_id: p2.player_id, nba_person_id: 202 }]);
  });
});
