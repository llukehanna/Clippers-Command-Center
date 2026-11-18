// End-to-end test of the franchise import (scripts/import-franchise-history.ts via runImport) against the fake
// cache in scripts/lib/__fixtures__/franchise/cache/ (two seasons per source) and a LOCAL Postgres.
// Skipped unless FIXTURE_DATABASE_URL is set. The database is WIPED.
//   FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55499/fixture npx vitest run scripts/lib/franchise/import
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import type { Db } from '../history/write.js';
import { parseImportArgs, runImport } from './import-run.js';

const url = process.env.FIXTURE_DATABASE_URL;
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const FIXTURE_CACHE = path.join(process.cwd(), 'scripts/lib/__fixtures__/franchise/cache');

const FRANCHISE_TABLES = [
  'person_xref', 'draft_picks', 'pick_swaps', 'transactions', 'transaction_parts', 'draft_lottery',
  'salaries', 'payroll_seasons', 'contracts', 'coach_seasons', 'executive_terms', 'honors',
] as const;

const total = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

describe.skipIf(!url)('import-franchise-history (fake cache, fixture DB)', () => {
  let sql: postgres.Sql;
  let dir: string;
  const db = () => sql as unknown as Db;
  const quiet = () => {};
  /** The fake cache holds 2017-18 and 2026-27; the draft after 2026-27 is 2027's. */
  // No overrides: the fake cache copies real pages, and overrides.ts settles some of their lines.
  const args = (...flags: string[]) => ({
    ...parseImportArgs([`--dir=${dir}`, `--report=${path.join(dir, 'report.json')}`, '--from=2017', '--to=2026', ...flags], new Date('2026-11-17T12:00:00Z')),
    overrides: [],
  });

  async function counts(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const t of FRANCHISE_TABLES) {
      const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ${sql(t)}`;
      out[t] = r.n;
    }
    return out;
  }

  async function snapshot(): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {};
    for (const t of [...FRANCHISE_TABLES, 'players'] as const) {
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
    await sql.unsafe(`TRUNCATE ${FRANCHISE_TABLES.join(', ')}, players RESTART IDENTITY CASCADE`);
    // Part 1 knows Gallinari (birthdate as on his BBRef roster row), so BBRef and NBA.com connect him by id.
    await sql`
      INSERT INTO players (first_name, last_name, display_name, nba_person_id, birthdate)
      VALUES ('Danilo', 'Gallinari', 'Danilo Gallinari', 201568, '1988-08-08')`;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'franchise-cache-'));
    fs.cpSync(FIXTURE_CACHE, dir, { recursive: true });
  });
  afterAll(async () => { await sql?.end(); });

  it('dry run writes nothing and produces a report', async () => {
    const out = await runImport(db(), args('--dry-run'), quiet);
    expect(out.status).toBe('dry-run');
    expect(Object.values(await counts()).every((n) => n === 0)).toBe(true);

    const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
    expect(report.counts.clippersMoves).toBeGreaterThan(0);
    expect(report.counts.picks).toBeGreaterThan(0);
    expect(report.counts.salaries).toBeGreaterThan(0);
    expect(report.counts.coachSeasons).toBe(2);
    // The 2027 five-team BBRef line is unreadable (it names a team with no link): a gate.
    expect(report.unparsed.map((l: { source: string }) => l.source)).toContain('LAC-2027_transactions');
    expect(report.import.coveredSeasons).toEqual([2017, 2026]);
    // A season whose BBRef page 404'd (or was never fetched) is reported, never silently skipped.
    const miss = 'season 2018 not covered: LAC-2019 not fetched, LAC-2019_transactions HTTP 404';
    expect(report.import.uncoveredSeasons).toContain(miss);
    expect(out.lines).toContain(`NOTE: ${miss}`);
    // 2027's draft page redirects to the general article: skipped, not parsed.
    expect(report.import.draftPagesSkipped).toEqual(['2027 NBA draft']);
    // R15: Gallinari's three-team trade merges NBA.com and BBRef; Jamil Wilson's two-way signing can't (no roster row).
    expect(report.import.nbaBbrefMerged).toBeGreaterThanOrEqual(1);
    expect(report.import.unmergedSignings.map((u: { name: string }) => u.name)).toContain('Jamil Wilson');
    expect(out.lines.join('\n')).toMatch(/WARNING/);

    const cp = JSON.parse(fs.readFileSync(path.join(dir, 'counterparties.json'), 'utf8'));
    expect(Array.isArray(cp)).toBe(true);
  });

  it('real run refuses to write when gates fail', async () => {
    const out = await runImport(db(), args(), quiet);
    expect(out.status).toBe('gates-failed');
    expect(out.gateFailures.join('; ')).toMatch(/unparsed line/);
    expect(Object.values(await counts()).every((n) => n === 0)).toBe(true);
  });

  it('real run with --allow-gaps writes, and a second run is idempotent', async () => {
    const first = await runImport(db(), args('--allow-gaps'), quiet);
    expect(first.status).toBe('written');
    const c = await counts();
    for (const t of ['person_xref', 'transactions', 'transaction_parts', 'draft_picks', 'salaries', 'payroll_seasons', 'contracts', 'coach_seasons', 'executive_terms'] as const) {
      expect(c[t], t).toBeGreaterThan(0);
    }
    // Gallinari's person row carries his Part 1 player link.
    const [g] = await sql<{ player_id: string | null; nba_person_id: number | null }[]>`
      SELECT player_id::text, nba_person_id FROM person_xref WHERE person_key = 'gallida01'`;
    expect(g.nba_person_id).toBe(201568);
    expect(g.player_id).not.toBeNull();
    const before = await snapshot();

    const second = await runImport(db(), args('--allow-gaps'), quiet);
    expect(second.status).toBe('written');
    expect(total(second.write!.inserted)).toBe(0);
    expect(total(second.write!.updated)).toBe(0);
    expect(total(second.write!.deleted)).toBe(0);
    expect(await snapshot()).toEqual(before);
  });

  it('a narrowed real run keeps an existing undated honor', async () => {
    await sql`INSERT INTO person_xref (person_key, kind, display_name) VALUES ('waltobi01', 'player', 'Bill Walton')`;
    await sql`INSERT INTO honors (season_id, person_key, honor, detail) VALUES (NULL, 'waltobi01', 'hall_of_fame', '1993')`;
    const out = await runImport(db(), parseImportArgs(
      [`--dir=${dir}`, `--report=${path.join(dir, 'report.json')}`, '--from=2026', '--to=2026', '--allow-gaps'],
      new Date('2026-11-17T12:00:00Z'),
    ), quiet);
    expect(out.status).toBe('written');
    expect(out.checks.writeScope.pruneUndatedHonors).toBe(false);
    const rows = await sql<{ honor: string }[]>`SELECT honor FROM honors WHERE person_key = 'waltobi01' AND season_id IS NULL`;
    expect(rows.map((r) => r.honor)).toEqual(['hall_of_fame']);
  });
});
