// Temporary verification script
import { sql } from './lib/db.js';

async function main() {
  // Query 2: Record counts by table
  const counts = await sql`
    SELECT 'seasons' AS tbl, count(*)::text AS cnt FROM seasons
    UNION ALL SELECT 'teams', count(*)::text FROM teams
    UNION ALL SELECT 'players', count(*)::text FROM players
    UNION ALL SELECT 'games', count(*)::text FROM games
    UNION ALL SELECT 'game_team_box_scores', count(*)::text FROM game_team_box_scores
    UNION ALL SELECT 'game_player_box_scores', count(*)::text FROM game_player_box_scores
    UNION ALL SELECT 'player_team_stints', count(*)::text FROM player_team_stints
    ORDER BY tbl
  `;
  console.log('\n=== Record Counts ===');
  for (const row of counts) {
    console.log(`  ${String(row.tbl).padEnd(30)} ${row.cnt}`);
  }

  // Query 3: Games by season
  const bySeasons = await sql`
    SELECT season_id::text, count(*)::text AS game_count, count(*) FILTER (WHERE status = 'Final')::text AS final_count
    FROM games
    GROUP BY season_id
    ORDER BY season_id
  `;
  console.log('\n=== Games by Season ===');
  for (const row of bySeasons) {
    console.log(`  Season ${row.season_id}: ${row.game_count} games (${row.final_count} Final)`);
  }

  // Query 4: Idempotency check (duplicates)
  const dups = await sql`
    SELECT nba_game_id::text, count(*)::text AS n FROM games GROUP BY nba_game_id HAVING count(*) > 1
  `;
  console.log(`\n=== Duplicate Games === ${dups.length === 0 ? 'PASS (0 duplicates)' : `FAIL (${dups.length} duplicates)`}`);

  // Query: DATA-05 — no box scores for non-Final games
  const nonFinalBoxScores = await sql`
    SELECT count(*)::text AS cnt
    FROM games g
    JOIN game_team_box_scores b ON b.game_id = g.game_id
    WHERE g.status != 'Final'
  `;
  console.log(`\n=== Non-Final Box Scores (DATA-05) === ${nonFinalBoxScores[0].cnt === '0' ? 'PASS (0 rows)' : `FAIL (${nonFinalBoxScores[0].cnt} rows)`}`);

  // Query: Checkpoint state
  const kv = await sql`SELECT key, value::text, updated_at FROM app_kv ORDER BY updated_at DESC`;
  console.log('\n=== Checkpoints ===');
  for (const row of kv) {
    console.log(`  ${row.key} = ${row.value} (${row.updated_at})`);
  }

  await sql.end();
}

main().catch(err => { console.error(err); sql.end(); process.exit(1); });
