// src/lib/db.test.ts — importing the db module without DATABASE_URL must not
// throw (next build imports every route); using it must.
import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  delete (globalThis as { _sql?: unknown })._sql;
});

describe('src/lib/db without DATABASE_URL', () => {
  it('imports cleanly and throws on first query', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const { sql, LAC_NBA_TEAM_ID } = await import('./db');
    expect(LAC_NBA_TEAM_ID).toBe(13);
    expect(() => sql`SELECT 1`).toThrow(/DATABASE_URL is not set/);
    expect(() => sql.unsafe('SELECT 1')).toThrow(/DATABASE_URL is not set/);
  });
});
