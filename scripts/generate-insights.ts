// scripts/generate-insights.ts
// Insight Engine v2: detects facts, frames them against the record book (only
// inside complete records), scores and renders them, and stores each with one
// proof statement that verify-insights re-runs. Stale claims are deactivated
// per detector (and per game for postgame); v1 rows (no surface) are
// deactivated on the first run; live rows are never touched.
//
// Run via: npm run generate-insights [-- --surface=season,pregame,postgame]
//          [--game=<id> (postgame only)] [--as-of=YYYY-MM-DD] [--dry] [--verbose]
import { sql } from './lib/db.js';
import { parseEngineArgs } from './lib/insights/engine/cli.js';
import { laToday } from './lib/insights/engine/dates.js';
import { runEngine } from './lib/insights/engine/run.js';

function countBy<T>(items: T[], key: (t: T) => string): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
}

async function main(): Promise<void> {
  const args = parseEngineArgs(process.argv.slice(2), laToday());
  console.log(`\n=== Insight Engine v2 — as of ${args.asOf}; ${args.surfaces.join(', ')}` +
    `${args.gameId ? `; game ${args.gameId}` : ''}${args.write ? '' : ' (dry run)'} ===\n`);
  const result = await runEngine({
    surfaces: args.surfaces, gameId: args.gameId, asOf: args.asOf, write: args.write, log: (m) => console.log(m),
  });
  const ctx = result.context;
  if (!ctx) {
    console.log('No Clippers box scores found — skipping.');
    return;
  }
  console.log(`Stats season ${ctx.season.label} (${ctx.season.isCurrent ? 'current' : 'completed'}, last Clippers game ` +
    `${ctx.season.lastGameDate}); records start ${ctx.recordsStart?.label ?? 'unknown'}; roster ${ctx.roster.size}; ` +
    `league data ${ctx.league.complete ? 'complete' : 'incomplete'}`);
  console.log(`Insights: ${countBy(result.drafts, (d) => `${d.surface}/${d.category}`)}`);
  console.log(`Dropped: ${countBy(result.dropped, (d) => d.reason)}`);
  console.log(`${result.upserted} upserted, ${result.deactivated} stale deactivated, ${result.legacyDeactivated} legacy deactivated`);
  if (args.verbose) {
    for (const d of [...result.drafts].sort((a, b) => b.importance - a.importance)) {
      console.log(`  [${d.importance}] ${d.surface} ${d.headline} — ${d.detail}`);
    }
  }
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .catch(async (err) => {
    console.error('generate-insights failed:', err instanceof Error ? err.message : err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
