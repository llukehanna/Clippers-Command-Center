// Temporary DB check script
import { sql } from './lib/db.js';

async function main() {
  const [counts] = await sql<[{ teams: bigint; players: bigint; games: bigint }]>`
    SELECT
      (SELECT count(*) FROM teams)   AS teams,
      (SELECT count(*) FROM players) AS players,
      (SELECT count(*) FROM games)   AS games
  `;
  console.log('Current DB state:', JSON.stringify({ teams: counts.teams.toString(), players: counts.players.toString(), games: counts.games.toString() }));
  const kv = await sql`SELECT key, value FROM app_kv ORDER BY updated_at DESC`;
  console.log('Checkpoints:', JSON.stringify(kv));
  await sql.end();
}

main().catch(err => { console.error(err); sql.end(); process.exit(1); });
