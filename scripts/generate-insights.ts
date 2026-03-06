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
// Insights without valid proof are never stored (proof_result must be non-empty).
//
// Run via: npm run generate-insights

import { sql } from './lib/db.js';
import { generateStreakInsights } from './lib/insights/streaks.js';
import { generateMilestoneInsights } from './lib/insights/milestones.js';
import { generateRareEventInsights } from './lib/insights/rare-events.js';
import { generateOpponentContextInsights } from './lib/insights/opponent-context.js';
import { generateLeagueComparisonInsights } from './lib/insights/league-comparisons.js';
import type { InsightRow } from './lib/insights/proof-utils.js';

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
      ${row.proof_sql}, ${sql.json(row.proof_params)},
      ${sql.json(row.proof_result)}, ${row.proof_hash}
    )
    ON CONFLICT (proof_hash) WHERE proof_hash IS NOT NULL DO UPDATE SET
      headline     = EXCLUDED.headline,
      detail       = EXCLUDED.detail,
      importance   = EXCLUDED.importance,
      proof_result = EXCLUDED.proof_result,
      updated_at   = now()
  `;
}

// ---- Main ----

async function main() {
  console.log('\n=== Insight Engine ===\n');
  const totals: Record<string, number> = {};

  const steps = [
    { name: 'Streak insights',           fn: generateStreakInsights,          category: 'streak' },
    { name: 'Milestone insights',         fn: generateMilestoneInsights,       category: 'milestone' },
    { name: 'Rare event insights',        fn: generateRareEventInsights,       category: 'rare_event' },
    { name: 'Opponent context insights',  fn: generateOpponentContextInsights,  category: 'opponent_context' },
    { name: 'League comparison insights', fn: generateLeagueComparisonInsights, category: 'league_comparison' },
  ];

  for (const step of steps) {
    process.stdout.write(`  ${step.name}... `);
    const rows = await step.fn();
    for (const row of rows) {
      await upsertInsight(row);
    }
    console.log(`${rows.length} insights upserted`);
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

main().catch((err) => {
  console.error('generate-insights failed:', err);
  process.exit(1);
});
