// scripts/lib/db.ts
// DB client singleton for CLI scripts.
// Loaded with DATABASE_URL from .env.local via node --env-file flag.
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set.');
  console.error('Add DATABASE_URL to .env.local and run: npm run backfill');
  process.exit(1);
}

export const sql = postgres(DATABASE_URL, {
  max: 3,          // small pool for a one-time CLI script
  idle_timeout: 30,
  connect_timeout: 10,
});
