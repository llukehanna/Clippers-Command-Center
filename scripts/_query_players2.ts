import { sql } from './lib/db.js';

async function main() {
  // Search for other players
  const rows = await sql<{ nba_player_id: number; display_name: string; player_id: string }[]>`
    SELECT nba_player_id::int, display_name, player_id::text
    FROM players
    WHERE display_name ILIKE '%hyland%'
       OR display_name ILIKE '%jaquez%'
       OR display_name ILIKE '%bones%'
       OR display_name ILIKE '%coffey%'
    ORDER BY display_name
  `;
  console.log(JSON.stringify(rows, null, 2));
  await sql.end();
}

main().catch(err => { console.error(err); process.exit(1); });
