// Temporary query script to find player IDs for Clippers players
import { sql } from './lib/db.js';

async function main() {
  // Key Clippers players from 2023-24 season
  const names = [
    'Kawhi Leonard', 'Paul George', 'James Harden', 'Russell Westbrook',
    'Ivica Zubac', 'Norman Powell', 'Terance Mann', 'Robert Covington',
    'Mason Plumlee', 'Bones Hyland', 'Marcus Morris', 'Amir Coffey',
    // MIA players
    'Jimmy Butler', 'Bam Adebayo', 'Tyler Herro', 'Kyle Lowry',
    'Caleb Martin', 'Duncan Robinson', 'Jaime Jaquez', 'Kevin Love',
    'Udonis Haslem', 'Josh Richardson', 'Thomas Bryant', 'Orlando Robinson',
    // PHX players
    'Kevin Durant', 'Devin Booker', 'Bradley Beal', 'Jusuf Nurkic',
    'Royce O\'Neale', 'Eric Gordon', 'Yuta Watanabe', 'Josh Okogie',
    'Drew Eubanks', 'Bol Bol', 'Keita Bates-Diop', 'Saben Lee',
  ];

  const rows = await sql<{ nba_player_id: number; display_name: string; player_id: string }[]>`
    SELECT nba_player_id::int, display_name, player_id::text
    FROM players
    WHERE display_name = ANY(${names})
    ORDER BY display_name
  `;
  console.log('=== Found Players ===');
  console.log(JSON.stringify(rows, null, 2));

  await sql.end();
}

main().catch(err => { console.error(err); process.exit(1); });
