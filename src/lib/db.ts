// src/lib/db.ts
// Next.js-safe postgres singleton with hot-reload protection.
// Unlike scripts/lib/db.ts, this throws instead of calling process.exit()
// so Next.js can surface the error in its error overlay rather than hard-crashing.

import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;

type Sql = ReturnType<typeof postgres>;

/**
 * Without DATABASE_URL (e.g. Vercel preview builds, where the variable is
 * Production-only) importing this module must not throw — that breaks
 * `next build` while it collects page data. Instead every use of `sql`
 * throws the same clear error the first time something actually queries.
 */
function missingDatabase(): Sql {
  const fail = (): never => {
    throw new Error(
      'DATABASE_URL is not set. Configure .env.local and restart the dev server.'
    );
  };
  return new Proxy(function () {} as unknown as Sql, { apply: fail, get: fail });
}

// Survive Next.js hot reload in development: store the singleton on globalThis
// so repeated module evaluation re-uses the same connection pool.
const globalForDb = globalThis as unknown as { _sql: Sql | undefined };

export const sql: Sql = DATABASE_URL
  ? globalForDb._sql ??
    postgres(DATABASE_URL, {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
    })
  : missingDatabase();

if (DATABASE_URL && process.env.NODE_ENV !== 'production') {
  globalForDb._sql = sql;
}

/**
 * Internal nba_team_id for the LA Clippers as stored in the teams table.
 * The DB uses sequential IDs (1-30), not real NBA API IDs. LAC = 13.
 */
export const LAC_NBA_TEAM_ID = 13;
