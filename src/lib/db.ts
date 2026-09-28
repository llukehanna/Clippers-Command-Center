// src/lib/db.ts
// Next.js-safe postgres singleton with hot-reload protection.
// Unlike scripts/lib/db.ts, this throws instead of calling process.exit()
// so Next.js can surface the error in its error overlay rather than hard-crashing.
// A missing DATABASE_URL throws on first query, not at import (see below).

import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
const MISSING_URL_MESSAGE =
  'DATABASE_URL is not set. Configure .env.local and restart the dev server.';

type Sql = ReturnType<typeof postgres>;

/**
 * Without DATABASE_URL, fail on first use rather than at import: `next build`
 * imports every route to collect page config, so an import-time throw breaks
 * builds that have no database (Vercel preview builds, CI). Any query still
 * throws the same error at request time.
 */
function missingUrlClient(): Sql {
  const fail = (): never => {
    throw new Error(MISSING_URL_MESSAGE);
  };
  return new Proxy(fail as unknown as Sql, { apply: fail, get: fail });
}

// Survive Next.js hot reload in development: store the singleton on globalThis
// so repeated module evaluation re-uses the same connection pool.
const globalForDb = globalThis as unknown as { _sql: Sql | undefined };

export const sql: Sql =
  globalForDb._sql ??
  (DATABASE_URL
    ? postgres(DATABASE_URL, {
        max: 10,
        idle_timeout: 30,
        connect_timeout: 10,
      })
    : missingUrlClient());

if (process.env.NODE_ENV !== 'production' && DATABASE_URL) {
  globalForDb._sql = sql;
}

/**
 * Internal nba_team_id for the LA Clippers as stored in the teams table.
 * The DB uses sequential IDs (1-30), not real NBA API IDs. LAC = 13.
 */
export const LAC_NBA_TEAM_ID = 13;
