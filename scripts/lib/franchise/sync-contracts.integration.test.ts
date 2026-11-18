// Integration test of the weekly contracts and current-season job (syncContracts) against a LOCAL Postgres.
// Skipped unless FIXTURE_DATABASE_URL is set. The database is WIPED.
//   FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55499/fixture npx vitest run --project integration scripts/lib/franchise/sync-contracts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { NBA_TEAM_IDS } from '../nba-teams.js';
import type { Db } from '../history/write.js';
import { IMPORT_SOURCES } from './build-dataset.js';
import { FetchStopped } from './fetcher.js';
import { FeedShapeError, SALARY_SOURCE, syncContracts, UnparsedLinesError } from './sync-contracts.js';
import { syncMoves, SYNCED_THROUGH_KEY } from './sync-moves.js';
import type { FranchiseDataset, Override } from './types.js';
import { writeFranchise } from './write.js';

const url = process.env.FIXTURE_DATABASE_URL;
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const { LAC, CLE } = NBA_TEAM_IDS;
const CACHE = 'scripts/lib/__fixtures__/franchise/cache';
const CONTRACTS = read(`${CACHE}/bbref/contracts.html`);
const WIKI = JSON.parse(read(`${CACHE}/wiki/2026–27_Los_Angeles_Clippers_season.json`)) as { title: string; wikitext: string };

const txPage = (...lines: string[]) =>
  `<ul class='page_index'><li><span><span>November 18, 2026</span></span>${lines.map((l) => `<p><p class="transaction ">${l}</p></p>`).join('')}</li></ul>`;
const CLE_LINK = '<a data-attr-from="CLE" href="/teams/CLE/2027.html">Cleveland Cavaliers</a>';
const STRUS_TRADE = `Traded a 2031 2nd round draft pick to the ${CLE_LINK} for <a href="/players/s/strusma01.html">Max Strus</a>. 2031 2nd-rd pick is LAC own`;
const WESLEY_TRADE = `Traded a 2032 2nd round draft pick to the ${CLE_LINK} for <a href="/players/w/weslebl01.html">Blake Wesley</a>.`;
const STRUS_KEY = 'bbref:2026-11-18:trade:pick2031r2|strusma01';

const row = (type: string, date: string, desc: string, team: number, player: number, group: string) => ({
  Transaction_Type: type, TRANSACTION_DATE: `${date}T00:00:00`, TRANSACTION_DESCRIPTION: desc, TEAM_ID: team, PLAYER_ID: player, GroupSort: group,
});
const nbaTrade = (group: string, name: string, id: number) => [
  row('Trade', '2026-11-18', `LA Clippers received guard ${name} from Cleveland Cavaliers.`, LAC, id, group),
  row('Trade', '2026-11-18', 'Cleveland Cavaliers received draft consideration from LA Clippers.', CLE, 0, group),
];

const FRANCHISE_TABLES = [
  'person_xref', 'draft_picks', 'pick_swaps', 'transactions', 'transaction_parts', 'draft_lottery', 'salaries', 'payroll_seasons',
  'contracts', 'app_kv', 'players',
] as const;

const wikiJson = () => JSON.stringify({ query: { pages: [{ title: WIKI.title, revisions: [{ slots: { main: { content: WIKI.wikitext } } }] }] } });

function fakeFetch(pages: { contracts?: string; transactions?: string; status?: Record<string, number> } = {}) {
  return vi.fn(async (u: string | URL | Request) => {
    const s = String(u);
    const code = Object.entries(pages.status ?? {}).find(([k]) => s.includes(k))?.[1] ?? 200;
    if (code !== 200) return new Response('', { status: code });
    if (s.includes('wikipedia.org')) return new Response(wikiJson());
    if (s.includes('/contracts/LAC.html')) return new Response(pages.contracts ?? CONTRACTS);
    return new Response(pages.transactions ?? txPage(STRUS_TRADE));
  });
}

describe.skipIf(!url)('weekly contracts job (fixture DB)', () => {
  let sql: postgres.Sql;
  const db = () => sql as unknown as Db;
  const MONDAY = new Date('2026-11-23T15:00:00Z');
  const deps = (fetch: ReturnType<typeof fakeFetch>, now = MONDAY) => ({
    fetch: fetch as unknown as typeof globalThis.fetch, sleep: async () => {}, db: db(), now: () => now, overrides: [] as Override[],
  });
  /** The nightly job's rows: each trade with NBA.com's "draft consideration" (incomplete). */
  const nightly = (...rows: unknown[]) => syncMoves({
    fetchNba: async () => ({ NBA_Player_Movement: { rows } }), fetchEspn: async () => { throw new Error('unused'); },
    db: db(), now: () => new Date('2026-11-19T13:30:00Z'), overrides: [],
  });
  const dump = async () => {
    const out: Record<string, string[]> = {};
    for (const t of FRANCHISE_TABLES) out[t] = (await sql<{ j: string }[]>`SELECT to_jsonb(x)::text AS j FROM ${sql(t)} x ORDER BY 1`).map((r) => r.j);
    return out;
  };
  const trades = () => sql<{ transaction_key: string; sources: string[]; is_complete: boolean }[]>`
    SELECT transaction_key, sources, is_complete FROM transactions ORDER BY transaction_key`;

  beforeAll(async () => {
    sql = postgres(url!, { max: 1, onnotice: () => {} }); // max 1: DB_SCHEMA.sql has BEGIN/COMMIT
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await sql.unsafe(read('Docs/DB_SCHEMA.sql'));
  });
  beforeEach(async () => {
    await sql.unsafe(`TRUNCATE ${FRANCHISE_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
    await sql`
      INSERT INTO players (first_name, last_name, display_name, nba_person_id) VALUES
        ('Blake', 'Wesley', 'Blake Wesley', 1631104), ('Max', 'Strus', 'Max Strus', 1629622)`;
    await sql`
      INSERT INTO person_xref (person_key, kind, display_name, nba_person_id, player_id)
      SELECT 'strusma01', 'player', 'Max Strus', 1629622, player_id FROM players WHERE nba_person_id = 1629622`;
    await sql`INSERT INTO app_kv (key, value) VALUES (${SYNCED_THROUGH_KEY}, ${sql.json('2026-11-10')})`;
    // Last week's snapshot.
    await sql`
      INSERT INTO contracts (snapshot_id, person_key, season_id, amount_usd, guaranteed_usd, option, fetched_at)
      VALUES ('2026-11-16T15:00:00.000Z', 'strusma01', 2026, 1, 1, NULL, '2026-11-16T15:00:00.000Z')`;
  });
  afterAll(async () => { await sql?.end(); });

  it('fetches exactly two bbref pages and fills a draft consideration from the current transactions page', async () => {
    await nightly(...nbaTrade('Trade 2026020', 'Max Strus', 1629622));
    expect(await trades()).toEqual([{ transaction_key: 'nba:Trade 2026020', sources: ['nba:Trade 2026020'], is_complete: false }]);

    const fetch = fakeFetch();
    const r = await syncContracts(deps(fetch));
    const urls = fetch.mock.calls.map(([u]) => String(u));
    expect(urls.filter((u) => u.includes('basketball-reference.com')).sort()).toEqual([
      'https://www.basketball-reference.com/contracts/LAC.html',
      'https://www.basketball-reference.com/teams/LAC/2027_transactions.html',
    ]);
    expect(urls).toHaveLength(3);
    expect(r).toMatchObject({ season: 2026, filledPicks: 1, stillIncomplete: [], skipped: 0 });
    expect(r.contracts).toBeGreaterThan(0);
    expect(r.salaries).toBeGreaterThan(0);

    // The trade is complete, its consideration now the Clippers' own 2031 2nd; the job's source carries weekly: (R16).
    expect(await trades()).toEqual([{ transaction_key: 'nba:Trade 2026020', sources: ['nba:Trade 2026020', `weekly:${STRUS_KEY}`], is_complete: true }]);
    expect(await sql`
      SELECT p.from_franchise_id, p.to_franchise_id, p.asset_kind, p.person_key, d.pick_key, p.gap_reason
      FROM transaction_parts p LEFT JOIN draft_picks d ON d.pick_id = p.pick_id ORDER BY p.part_id`).toEqual([
      { from_franchise_id: CLE, to_franchise_id: LAC, asset_kind: 'player', person_key: 'strusma01', pick_key: null, gap_reason: null },
      { from_franchise_id: LAC, to_franchise_id: CLE, asset_kind: 'pick', person_key: null, pick_key: '2031-2-LAC', gap_reason: null },
    ]);
    expect((await sql`SELECT pick_key FROM draft_picks`).map((x) => x.pick_key)).toEqual(['2031-2-LAC']);

    // The snapshot is replaced; this season's salaries carry the weekly: source.
    const snaps = await sql`SELECT DISTINCT snapshot_id FROM contracts`;
    expect(snaps).toEqual([{ snapshot_id: '2026-11-23T15:00:00.000Z' }]);
    expect(await sql`SELECT count(*)::int AS n FROM contracts`).toEqual([{ n: r.contracts }]);
    const salaries = await sql<{ season_id: number; source: string }[]>`SELECT season_id, source FROM salaries`;
    expect(salaries).toHaveLength(r.salaries);
    expect(salaries.every((s) => s.season_id === 2026 && s.source === SALARY_SOURCE)).toBe(true);
    expect(await sql`SELECT amount_usd::int FROM salaries WHERE person_key = 'garlada01'`).toEqual([{ amount_usd: 42166510 }]);
    // Contract players new to person_xref got rows.
    expect(await sql`SELECT kind FROM person_xref WHERE person_key = 'garlada01'`).toEqual([{ kind: 'player' }]);

    // A week later: a new snapshot, nothing else changes.
    const before = await dump();
    const again = await syncContracts(deps(fakeFetch(), new Date('2026-11-30T15:00:00Z')));
    expect(again).toMatchObject({ filledPicks: 0, stillIncomplete: [], salaries: 0, contracts: r.contracts });
    const after = await dump();
    expect(await sql`SELECT DISTINCT snapshot_id FROM contracts`).toEqual([{ snapshot_id: '2026-11-30T15:00:00.000Z' }]);
    for (const t of FRANCHISE_TABLES.filter((x) => x !== 'contracts')) expect(after[t]).toEqual(before[t]);
  });

  it('never guesses a pick: lists the trade it can\'t complete, and merges the nba: person into the BBRef id', async () => {
    await nightly(...nbaTrade('Trade 2026021', 'Blake Wesley', 1631104));
    const r = await syncContracts(deps(fakeFetch({ transactions: txPage(WESLEY_TRADE) })));
    expect(r).toMatchObject({ filledPicks: 0, stillIncomplete: ['nba:Trade 2026021'] });
    const [t] = await trades();
    expect(t.is_complete).toBe(false);
    // Not better, so not rewritten: the job only adds its (weekly:) source.
    expect(t.sources).toEqual(['nba:Trade 2026021', 'weekly:bbref:2026-11-18:trade:pick2032r2|weslebl01']);
    expect(await sql`SELECT person_key, gap_reason FROM transaction_parts ORDER BY part_id`).toEqual([
      { person_key: 'weslebl01', gap_reason: null },
      { person_key: null, gap_reason: 'pick_unidentified' },
    ]);
    expect(await sql`SELECT person_key FROM person_xref WHERE nba_person_id = 1631104`).toEqual([{ person_key: 'weslebl01' }]);
    expect(await sql`SELECT count(*)::int AS n FROM draft_picks`).toEqual([{ n: 0 }]);
  });

  it('keeps the old contracts snapshot when parsing fails', async () => {
    await nightly(...nbaTrade('Trade 2026020', 'Max Strus', 1629622));
    const before = await dump();
    const err = await syncContracts(deps(fakeFetch({ contracts: '<html><body>Payroll moved</body></html>' }))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FeedShapeError);
    expect(await dump()).toEqual(before);
    expect(await sql`SELECT snapshot_id FROM contracts`).toEqual([{ snapshot_id: '2026-11-16T15:00:00.000Z' }]);
  });

  it('changes nothing when BBRef refuses a page, naming it', async () => {
    await nightly(...nbaTrade('Trade 2026020', 'Max Strus', 1629622));
    const before = await dump();
    const fetch = fakeFetch({ status: { '2027_transactions': 403 } });
    const err = await syncContracts(deps(fetch)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchStopped);
    expect(err).toMatchObject({ key: 'bbref/LAC-2027_transactions', status: 403 });
    expect(await dump()).toEqual(before);
  });

  it('changes nothing on an unparsed line', async () => {
    await nightly(...nbaTrade('Trade 2026020', 'Max Strus', 1629622));
    const before = await dump();
    const odd = 'The Los Angeles Clippers did something new.';
    const err = await syncContracts(deps(fakeFetch({ transactions: txPage(STRUS_TRADE, odd) }))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnparsedLinesError);
    expect((err as UnparsedLinesError).lines.map((l) => l.text)).toEqual([odd]);
    expect(await dump()).toEqual(before);
  });

  it('an import never deletes what the weekly job wrote (R16)', async () => {
    // An import-only incomplete trade, keyed by its BBRef line (no NBA.com source).
    await sql`
      INSERT INTO transactions (transaction_key, slug, date, season_id, involves_clippers, kind, description, sources, is_complete)
      VALUES (${STRUS_KEY}, '2026-11-18-abcdef', '2026-11-18', 2026, true, 'trade', 'x', ${[STRUS_KEY]}::text[], false)`;
    await sql`
      INSERT INTO transaction_parts (transaction_id, from_franchise_id, to_franchise_id, asset_kind, person_key, unlinked_text, gap_reason)
      SELECT transaction_id, ${CLE}::int, ${LAC}::int, 'player', 'strusma01', NULL, NULL FROM transactions UNION ALL
      SELECT transaction_id, ${LAC}::int, ${CLE}::int, 'pick', NULL, NULL, 'pick_unidentified' FROM transactions`;
    const r = await syncContracts(deps(fakeFetch()));
    expect(r).toMatchObject({ filledPicks: 1, stillIncomplete: [] });
    expect(await trades()).toEqual([{ transaction_key: STRUS_KEY, sources: [STRUS_KEY, `weekly:${STRUS_KEY}`], is_complete: true }]);
    const salaries = (await sql`SELECT count(*)::int AS n FROM salaries`)[0].n as number;

    // A re-import of 2026 that no longer produces that trade nor those salaries: its stale-row deletes skip them.
    const empty: FranchiseDataset = {
      currentDraftYear: 2027, people: [], picks: [], swaps: [], lottery: [], payrollSeasons: [], contracts: [], coachSeasons: [],
      execTerms: [], honors: [], unparsed: [], ignored: [], dropped: [], skipped: [], peopleUnmatched: [], peopleAmbiguous: [],
      breaks: [], disputes: [], unkeyed: [], skippedCategories: [],
      salaries: [{ seasonId: 2026, personKey: 'strusma01', amountUsd: 5, source: 'bbref:LAC-2027' }],
      moves: [{
        sourceKey: 'bbref:2026-08-01:waiver:strusma01', transactionKey: 'bbref:2026-08-01:waiver:strusma01', sources: ['bbref:2026-08-01:waiver:strusma01'],
        date: '2026-08-01', kind: 'waiver', involvesClippers: true, complete: true, conflicts: [],
        parts: [{ from: LAC, to: null, kind: 'player', person: { bbrefId: 'strusma01', name: 'Max Strus' } }],
      }],
    };
    const res = await writeFranchise(db(), empty, { kind: 'import', importSources: IMPORT_SOURCES, seasons: [2026] });
    expect(res.deleted.transactions ?? 0).toBe(0);
    expect(res.deleted.salaries ?? 0).toBe(0);
    expect((await trades()).map((t) => t.transaction_key)).toContain(STRUS_KEY);
    // Strus's row is the import's to overwrite (it lists him); every other weekly row stays.
    expect((await sql`SELECT count(*)::int AS n FROM salaries`)[0].n).toBe(salaries);
    expect((await sql`SELECT count(*)::int AS n FROM salaries WHERE source = ${SALARY_SOURCE}`)[0].n).toBe(salaries - 1);
  });
});
