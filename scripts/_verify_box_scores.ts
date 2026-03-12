import { sql } from './lib/db.js';

async function main() {
  const rows = await sql<{ game_id: string; team_id: string; fg_made: number; fg_attempted: number; fg3_made: number; points: number }[]>`
    SELECT game_id::text, team_id::text, fg_made::int, fg_attempted::int, fg3_made::int, points::int
    FROM game_team_box_scores
    ORDER BY game_id, team_id
  `;
  console.log('=== game_team_box_scores ===');
  console.log(JSON.stringify(rows, null, 2));
  await sql.end();
}

main().catch(err => { console.error(err); process.exit(1); });
