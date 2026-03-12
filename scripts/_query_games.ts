// Temporary query script to find real Clippers games for seeding
import { sql } from './lib/db.js';

async function main() {
  const rows = await sql<{
    nba_game_id: number;
    game_date: string;
    home_abbr: string;
    away_abbr: string;
    home_score: number;
    away_score: number;
    status: string;
    game_id: string;
    home_nba_team_id: number;
    away_nba_team_id: number;
  }[]>`
    SELECT g.nba_game_id, g.game_date::text,
           ht.abbreviation as home_abbr, ht.nba_team_id::int as home_nba_team_id,
           at.abbreviation as away_abbr, at.nba_team_id::int as away_nba_team_id,
           g.home_score, g.away_score, g.status, g.game_id::text as game_id
    FROM games g
    JOIN teams ht ON ht.team_id = g.home_team_id
    JOIN teams at ON at.team_id = g.away_team_id
    WHERE (ht.abbreviation = 'LAC' OR at.abbreviation = 'LAC')
      AND g.status = 'Final'
      AND g.game_date BETWEEN '2024-01-01' AND '2024-03-31'
    ORDER BY g.game_date
    LIMIT 10
  `;
  console.log('=== Clippers Games (Jan-Mar 2024) ===');
  console.log(JSON.stringify(rows, null, 2));

  // Also get all teams with their nba_team_ids
  const teams = await sql<{ nba_team_id: number; abbreviation: string; team_id: string }[]>`
    SELECT nba_team_id::int, abbreviation, team_id::text FROM teams ORDER BY abbreviation
  `;
  console.log('\n=== All Teams ===');
  console.log(JSON.stringify(teams, null, 2));

  await sql.end();
}

main().catch(err => { console.error(err); process.exit(1); });
