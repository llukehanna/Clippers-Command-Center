// Integration test of the nightly moves job (syncMoves) against a LOCAL Postgres.
// Skipped unless FIXTURE_DATABASE_URL is set. The database is WIPED.
//   FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55499/fixture npx vitest run --project integration scripts/lib/franchise/sync-moves
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { NBA_TEAM_IDS } from '../nba-teams.js';
import type { Db } from '../history/write.js';
import { NBA_TIMEOUT_MS, SYNCED_THROUGH_KEY, syncMoves, UnparsedMovesError } from './sync-moves.js';
import type { Override } from './types.js';

const url = process.env.FIXTURE_DATABASE_URL;
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const { LAC, CLE } = NBA_TEAM_IDS;

const row = (type: string, date: string, desc: string, team: number, player: number, group: string) => ({
  Transaction_Type: type, TRANSACTION_DATE: `${date}T00:00:00`, TRANSACTION_DESCRIPTION: desc, TEAM_ID: team, PLAYER_ID: player, GroupSort: group,
});
const nbaFeed = (...rows: unknown[]) => ({ NBA_Player_Movement: { rows } });
const OLD = row('Signing', '2026-11-08', 'LA Clippers signed guard Old Hand to a contract.', LAC, 1, 'Signing 1');
const WESLEY = row('Signing', '2026-11-17', 'LA Clippers signed guard Blake Wesley to a 10-Day Contract.', LAC, 1631104, 'Signing 2');
const ODD = row('Signing', '2026-11-18', 'LA Clippers and guard Blake Wesley agreed to terms.', LAC, 1631104, 'Signing 3');
const strusTrade = (date: string) => [
  row('Trade', date, 'LA Clippers received guard Max Strus from Cleveland Cavaliers.', LAC, 1629622, 'Trade 2026020'),
  row('Trade', date, 'Cleveland Cavaliers received draft consideration from LA Clippers.', CLE, 0, 'Trade 2026020'),
];
const ESPN_STRUS = { transactions: [{ date: '2026-11-17T08:00Z', description: 'Acquired G Max Strus from Cleveland.' }] };

const FRANCHISE_TABLES = ['person_xref', 'transactions', 'transaction_parts', 'app_kv', 'players'] as const;

describe.skipIf(!url)('nightly moves job (fixture DB)', () => {
  let sql: postgres.Sql;
  const db = () => sql as unknown as Db;
  const NOW = () => new Date('2026-11-19T13:30:00Z');
  const fail = async (): Promise<unknown> => { throw new Error('HTTP 403'); };
  const deps = (over: Partial<Parameters<typeof syncMoves>[0]> = {}) => ({
    fetchNba: fail, fetchEspn: fail, db: db(), now: NOW, overrides: [] as Override[], ...over,
  });
  const syncedThrough = async () =>
    (await sql<{ v: string }[]>`SELECT value #>> '{}' AS v FROM app_kv WHERE key = ${SYNCED_THROUGH_KEY}`)[0]?.v ?? null;
  const transactions = () => sql<{ transaction_key: string; sources: string[]; is_complete: boolean }[]>`
    SELECT transaction_key, sources, is_complete FROM transactions ORDER BY date, transaction_key`;

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
    // The import already knows Strus under his BBRef id.
    await sql`
      INSERT INTO person_xref (person_key, kind, display_name, nba_person_id, player_id)
      SELECT 'strusma01', 'player', 'Max Strus', 1629622, player_id FROM players WHERE nba_person_id = 1629622`;
    await sql`INSERT INTO app_kv (key, value) VALUES (${SYNCED_THROUGH_KEY}, ${sql.json('2026-11-10')})`;
  });
  afterEach(() => { vi.useRealTimers(); });
  afterAll(async () => { await sql?.end(); });

  it('writes only moves after the synced-through date', async () => {
    const r = await syncMoves(deps({ fetchNba: async () => nbaFeed(OLD, WESLEY, ...strusTrade('2026-11-18')) }));
    expect(r).toEqual({ source: 'nba', written: 2, incomplete: ['nba:Trade 2026020'] });
    expect((await transactions()).map((t) => t.transaction_key)).toEqual(['nba:Signing 2:1631104', 'nba:Trade 2026020']);
    expect(await syncedThrough()).toBe('2026-11-18');
    // The trade's player resolved to the person the import already holds; Wesley is new, as nba:<id>.
    const parts = await sql`SELECT person_key, gap_reason FROM transaction_parts ORDER BY part_id`;
    expect(parts).toEqual([
      { person_key: 'nba:1631104', gap_reason: null },
      { person_key: 'strusma01', gap_reason: null },
      { person_key: null, gap_reason: 'pick_unidentified' },
    ]);

    // The next night the same feed brings nothing new: nothing written, the key stays.
    const again = await syncMoves(deps({ fetchNba: async () => nbaFeed(OLD, WESLEY, ...strusTrade('2026-11-18')) }));
    expect(again).toEqual({ source: 'nba', written: 0, incomplete: [] });
    expect(await transactions()).toHaveLength(2);
    expect(await syncedThrough()).toBe('2026-11-18');
  });

  it('starts from the latest NBA.com or ESPN transaction already stored when the key is missing', async () => {
    await sql`DELETE FROM app_kv`;
    await sql`
      INSERT INTO transactions (transaction_key, slug, date, season_id, involves_clippers, kind, description, sources, is_complete) VALUES
        ('nba:Signing 0:5', '2026-11-16-aaaaaa', '2026-11-16', 2026, true, 'signing', 'x', ARRAY['nba:Signing 0:5'], true),
        ('bbref:2026-11-18:x', '2026-11-18-bbbbbb', '2026-11-18', 2026, true, 'signing', 'y', ARRAY['bbref:2026-11-18:x'], true)`;
    const r = await syncMoves(deps({ fetchNba: async () => nbaFeed(OLD, WESLEY) }));
    expect(r.written).toBe(1);
    expect(await syncedThrough()).toBe('2026-11-17');
  });

  it('falls back to espn when nba times out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fetchEspn = vi.fn(async () => ESPN_STRUS);
    const p = syncMoves(deps({ fetchNba: () => new Promise(() => {}), fetchEspn }));
    await vi.advanceTimersByTimeAsync(NBA_TIMEOUT_MS - 1);
    expect(fetchEspn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();
    const r = await p;
    expect(r.source).toBe('espn');
    expect(r.written).toBe(1);
    const [t] = await transactions();
    expect(t.transaction_key).toMatch(/^espn:2026-11-17:/);
    expect(await sql`SELECT person_key, from_franchise_id, to_franchise_id FROM transaction_parts`)
      .toEqual([{ person_key: 'strusma01', from_franchise_id: CLE, to_franchise_id: LAC }]);
    expect(await syncedThrough()).toBe('2026-11-17');
  });

  it('exits without writing on an unparsed line', async () => {
    const err = await syncMoves(deps({ fetchNba: async () => nbaFeed(WESLEY, ODD) })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnparsedMovesError);
    expect((err as UnparsedMovesError).lines.map((l) => l.text)).toEqual([ODD.TRANSACTION_DESCRIPTION]);
    expect(await transactions()).toEqual([]);
    expect(await sql`SELECT person_key FROM person_xref`).toEqual([{ person_key: 'strusma01' }]);
    expect(await syncedThrough()).toBe('2026-11-10');
  });

  it('stays one row when espn then nba report the same trade', async () => {
    const first = await syncMoves(deps({ fetchEspn: async () => ESPN_STRUS }));
    expect(first.source).toBe('espn');
    const [espnRow] = await transactions();
    const [{ slug }] = await sql`SELECT slug FROM transactions`;

    // NBA.com dates it the day it became official, a day after ESPN's line.
    const second = await syncMoves(deps({ fetchNba: async () => nbaFeed(...strusTrade('2026-11-18')) }));
    expect(second.source).toBe('nba');
    expect(second.written).toBe(1);
    const rows = await transactions();
    expect(rows).toHaveLength(1);
    expect(rows[0].transaction_key).toBe(espnRow.transaction_key);
    expect(rows[0].sources).toEqual([espnRow.transaction_key, 'nba:Trade 2026020']);
    expect((await sql`SELECT slug FROM transactions`)[0].slug).toBe(slug);
    expect(await syncedThrough()).toBe('2026-11-18');
  });

  it('applies a committed override on the next run', async () => {
    const feed = nbaFeed(WESLEY, ODD);
    await expect(syncMoves(deps({ fetchNba: async () => feed }))).rejects.toBeInstanceOf(UnparsedMovesError);
    expect(await transactions()).toEqual([]);

    // The fix is committed: the line becomes a move of our own wording.
    const create: Override = {
      kind: 'move', match: { source: 'nba', text: ODD.TRANSACTION_DESCRIPTION }, create: { kind: 'extension' },
      replaceParts: [{ from: null, to: LAC, kind: 'player', person: { nbaPersonId: 1631104, name: 'Blake Wesley' } }],
      source: 'test: NBA.com wording for an extension',
    };
    const r = await syncMoves(deps({ fetchNba: async () => feed, overrides: [create] }));
    expect(r).toMatchObject({ source: 'nba', written: 2, incomplete: [] });
    const rows = await sql<{ transaction_key: string; kind: string }[]>`SELECT transaction_key, kind FROM transactions ORDER BY date`;
    expect(rows.map((x) => x.kind)).toEqual(['ten_day', 'extension']);
    expect(rows[1].transaction_key).toMatch(/^override:nba#[0-9a-f]{8}$/);
    expect(await syncedThrough()).toBe('2026-11-18');
  });
});
