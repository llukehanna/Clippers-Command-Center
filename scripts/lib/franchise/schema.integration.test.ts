// Integration test of Docs/migrations/2026-11-franchise-history.sql against a LOCAL Postgres.
// Skipped unless FIXTURE_DATABASE_URL is set. The database is WIPED.
//   FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55499/fixture npx vitest run scripts/lib/franchise/schema
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const url = process.env.FIXTURE_DATABASE_URL;
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe.skipIf(!url)('franchise history schema (fixture DB)', () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = postgres(url!, { max: 1, onnotice: () => {} }); // max 1: the SQL files have BEGIN/COMMIT
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await sql.unsafe(read('Docs/DB_SCHEMA.sql'));
  });
  afterAll(async () => { await sql?.end(); });

  it('applies the migration twice without error', async () => {
    const migration = read('Docs/migrations/2026-11-franchise-history.sql');
    await sql.unsafe(migration);
    await sql.unsafe(migration);
    const rows = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    const names = rows.map((r) => r.table_name);
    for (const t of ['person_xref', 'draft_picks', 'pick_swaps', 'transactions', 'transaction_parts',
      'draft_lottery', 'salaries', 'payroll_seasons', 'contracts', 'coach_seasons', 'executive_terms', 'honors']) {
      expect(names).toContain(t);
    }
  });

  it('rejects a second transactions row with the same transaction_key', async () => {
    await sql`INSERT INTO transactions (transaction_key, slug, date, kind, description, involves_clippers, sources, is_complete)
      VALUES ('nba:Trade 1', 'trade-1', '2005-07-01', 'trade', 'd', true, ARRAY['nba:Trade 1'], true)`;
    await expect(sql`INSERT INTO transactions (transaction_key, slug, date, kind, description, involves_clippers, sources, is_complete)
      VALUES ('nba:Trade 1', 'trade-1b', '2005-07-02', 'trade', 'd', true, ARRAY['nba:Trade 1'], true)`).rejects.toThrow();
  });

  it('cascades a person_key rename to transaction_parts', async () => {
    await sql`INSERT INTO person_xref (person_key, kind, display_name) VALUES ('name:old-1999', 'player', 'Old Name')`;
    const [t] = await sql`SELECT transaction_id FROM transactions WHERE transaction_key = 'nba:Trade 1'`;
    await sql`INSERT INTO transaction_parts (transaction_id, asset_kind, person_key)
      VALUES (${t.transaction_id}, 'player', 'name:old-1999')`;
    await sql`UPDATE person_xref SET person_key = 'bbref:oldna01' WHERE person_key = 'name:old-1999'`;
    const parts = await sql`SELECT person_key FROM transaction_parts WHERE transaction_id = ${t.transaction_id}`;
    expect(parts.map((p) => p.person_key)).toEqual(['bbref:oldna01']);
  });

  it('accepts every GapReason value in transaction_parts.gap_reason', async () => {
    const gapReasons = ['pick_unidentified', 'protections_unknown', 'source_conflict', 'person_unmatched', 'party_unknown'];
    const [t] = await sql`INSERT INTO transactions (transaction_key, slug, date, kind, description, involves_clippers, sources, is_complete)
      VALUES ('nba:Gap Test', 'gap-test', '2006-02-01', 'trade', 'd', true, ARRAY['nba:Gap Test'], false)
      RETURNING transaction_id`;
    for (const gap of gapReasons) {
      await expect(sql`INSERT INTO transaction_parts (transaction_id, asset_kind, gap_reason)
        VALUES (${t.transaction_id}, 'other', ${gap})`).resolves.toBeDefined();
    }
  });
});
