// scripts/record-sync.ts
// Stamps app_kv 'pipeline:last_sync_at' (read by /api/home as meta.last_sync_at).
// Run as the last step of the nightly post-game workflow.
import { sql } from './lib/db.js';

async function main(): Promise<void> {
  await sql`
    INSERT INTO app_kv (key, value, updated_at)
    VALUES ('pipeline:last_sync_at', ${sql.json(new Date().toISOString())}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
  console.log('[record-sync] pipeline:last_sync_at updated');
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error('[record-sync] Failed:', err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
