// scripts/generate-insights.ts
// Insight Engine orchestrator.
//
// Generates and stores provable insights from stored data in dependency order:
//   Step 1: Streak insights (player scoring and shooting streaks)
//   Step 2: Milestone insights (season points, games played)
//   Step 3: Rare event insights (top 5% percentile performances)
//   Step 4: Opponent context insights (def rating, H2H record)
//   Step 5: League comparison insights (Clippers off/net rating rank)
//
// All steps write to the insights table idempotently (ON CONFLICT on proof_hash).
// proof_hash is a stable identity key (category + entity ids + season + metric
// key — see makeInsightKey), so re-runs update rows instead of duplicating them.
// After a category is regenerated, its previously-active batch insights that
// were NOT re-emitted this run are deactivated (is_active = false): the claim
// no longer holds (streak ended, rank dropped out of the top 5, ...).
// Insights without valid proof are never stored (proof_result must be non-empty).
//
// Run via: npm run generate-insights

import { sql } from './lib/db.js';
import { generateStreakInsights } from './lib/insights/streaks.js';
import { generateMilestoneInsights } from './lib/insights/milestones.js';
import { generateRareEventInsights } from './lib/insights/rare-events.js';
import { generateOpponentContextInsights } from './lib/insights/opponent-context.js';
import { generateLeagueComparisonInsights } from './lib/insights/league-comparisons.js';
import { loadInsightContext, type InsightContext } from './lib/insights/context.js';
import type { InsightRow } from './lib/insights/proof-utils.js';

type Json = Parameters<typeof sql.json>[0];

// ---- Upsert ----

async function upsertInsight(row: InsightRow): Promise<void> {
  await sql`
    INSERT INTO insights (
      scope, team_id, game_id, player_id, season_id,
      category, headline, detail, importance,
      proof_sql, proof_params, proof_result, proof_hash
    ) VALUES (
      ${row.scope},
      ${row.team_id !== null ? sql`${row.team_id}::bigint` : null},
      ${row.game_id !== null ? sql`${row.game_id}::bigint` : null},
      ${row.player_id !== null ? sql`${row.player_id}::bigint` : null},
      ${row.season_id},
      ${row.category}, ${row.headline}, ${row.detail}, ${row.importance},
      ${row.proof_sql}, ${sql.json(row.proof_params as unknown as Json)},
      ${sql.json(row.proof_result as unknown as Json)}, ${row.proof_hash}
    )
    ON CONFLICT (proof_hash) WHERE proof_hash IS NOT NULL DO UPDATE SET
      scope        = EXCLUDED.scope,
      headline     = EXCLUDED.headline,
      detail       = EXCLUDED.detail,
      importance   = EXCLUDED.importance,
      proof_sql    = EXCLUDED.proof_sql,
      proof_params = EXCLUDED.proof_params,
      proof_result = EXCLUDED.proof_result,
      is_active    = TRUE,          -- re-emitted → eligible again
      updated_at   = now()
  `;
}

/**
 * Deactivate batch insights of `category` that this run did not re-emit.
 * Scoped to batch scopes so live insights (scope 'live') are never touched.
 * Returns the number of rows deactivated.
 */
async function deactivateStale(category: InsightRow['category'], keptHashes: string[]): Promise<number> {
  const result = await sql`
    UPDATE insights SET is_active = FALSE, updated_at = now()
    WHERE category = ${category}
      AND scope IN ('between_games', 'historical')
      AND is_active = TRUE
      AND (proof_hash IS NULL OR proof_hash <> ALL(${keptHashes}::text[]))
  `;
  return result.count;
}

// ---- Main ----

async function main() {
  console.log('\n=== Insight Engine ===\n');
  const totals: Record<string, number> = {};
  const verbose = process.argv.slice(2).includes('--verbose');

  // INSIGHTS_NOW (ISO date) pins "now" for tests: it decides whether the stats
  // season is the current one ("this season") or a completed one ("in 2025-26").
  const now = process.env.INSIGHTS_NOW ? new Date(process.env.INSIGHTS_NOW) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error(`Invalid INSIGHTS_NOW "${process.env.INSIGHTS_NOW}"`);
  const ctx: InsightContext | null = await loadInsightContext(now);
  if (!ctx) {
    // Nothing to talk about yet (no teams / no Clippers box scores). Leave the
    // existing insights alone rather than deactivating everything.
    console.log('No Clippers box scores found — skipping.');
    await sql.end();
    return;
  }
  console.log(
    `Stats season: ${ctx.season.label} (${ctx.season.isCurrent ? 'current' : 'completed'}, ` +
      `last Clippers game ${ctx.season.lastGameDate}); qualified players: ${ctx.minPlayerGames}+ games\n`
  );

  const steps = [
    { name: 'Streak insights',           fn: generateStreakInsights,          category: 'streak' },
    { name: 'Milestone insights',         fn: generateMilestoneInsights,       category: 'milestone' },
    { name: 'Rare event insights',        fn: generateRareEventInsights,       category: 'rare_event' },
    { name: 'Opponent context insights',  fn: generateOpponentContextInsights,  category: 'opponent_context' },
    { name: 'League comparison insights', fn: generateLeagueComparisonInsights, category: 'league_comparison' },
  ];

  for (const step of steps) {
    process.stdout.write(`  ${step.name}... `);
    // If a generator throws, main() fails before deactivation runs, so a
    // partial run never wipes out a category.
    const rows = await step.fn(ctx);
    for (const row of rows) {
      await upsertInsight(row);
    }
    const deactivated = await deactivateStale(
      step.category as InsightRow['category'],
      rows.map((r) => r.proof_hash)
    );
    console.log(`${rows.length} insights upserted, ${deactivated} stale deactivated`);
    if (verbose) {
      for (const r of [...rows].sort((a, b) => b.importance - a.importance)) {
        console.log(`      [${r.importance}] ${r.headline} — ${r.detail ?? ''}`);
      }
    }
    totals[step.category] = rows.length;
  }

  console.log('\n--- Summary ---');
  for (const [cat, count] of Object.entries(totals)) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log(`  Total: ${Object.values(totals).reduce((a, b) => a + b, 0)}`);
  console.log('\nDone.\n');

  await sql.end();
}

main().catch(async (err) => {
  console.error('generate-insights failed:', err);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
