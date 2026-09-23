// scripts/verify-insights.ts
// Checks that every active batch insight is still proven by its stored proof
// query (see lib/insights/verify.ts). Exits 1 on any failure.
//
// Run via: npm run verify-insights
import { sql } from './lib/db.js';
import { verifyActiveInsights } from './lib/insights/verify.js';

async function main(): Promise<void> {
  const { checked, legacy, failures } = await verifyActiveInsights();
  console.log(`[verify-insights] ${checked} checked, ${legacy} legacy skipped, ${failures.length} failed`);
  for (const f of failures) console.error(`  ✗ ${f.headline} — ${f.reason} (${f.insight_id})`);
  await sql.end();
  if (failures.length > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error('[verify-insights] Failed:', err);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
