// src/lib/db.ts
// Next.js-safe postgres singleton with hot-reload protection.
// Unlike scripts/lib/db.ts, this throws instead of calling process.exit()
// so Next.js can surface the error in its error overlay rather than hard-crashing.

import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Configure .env.local and restart the dev server.'
  );
}

// Survive Next.js hot reload in development: store the singleton on globalThis
// so repeated module evaluation re-uses the same connection pool.
const globalForDb = globalThis as unknown as { _sql: ReturnType<typeof postgres> | undefined };

export const sql =
  globalForDb._sql ??
  postgres(DATABASE_URL, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb._sql = sql;
}

/**
 * NBA canonical team ID for the LA Clippers.
 * Used by all API routes that need to identify the Clippers in NBA data.
 */
export const LAC_NBA_TEAM_ID = 1610612746;
