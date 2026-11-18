// Seeds game_flow for the fixture league (tests only): every 2025-26 regular
// season Clippers game gets a quiet flow; one win becomes a 15-point comeback.
import type { Sql } from 'postgres';

export async function seedGameFlows(sql: Sql): Promise<string> {
  await sql`
    INSERT INTO game_flow (game_id, lac_largest_lead, lac_largest_deficit, lead_changes, times_tied, lac_best_run, opp_best_run, comeback_margin, margin_series, source)
    SELECT g.game_id, 8, 4, 5, 3, 7, 6, NULL, '[[0,0],[1440,3],[2880,5]]'::jsonb, 'espn'
    FROM games g
    WHERE g.season_id = 2025 AND 1 IN (g.home_team_id, g.away_team_id) AND NOT g.is_playoffs AND g.nba_game_id < 50000000
    ON CONFLICT (game_id) DO NOTHING`;
  const [win] = await sql<{ game_id: string }[]>`
    SELECT g.game_id::text FROM games g
    WHERE g.season_id = 2025 AND NOT g.is_playoffs AND g.nba_game_id < 50000000
      AND ((g.home_team_id = 1 AND g.home_score > g.away_score) OR (g.away_team_id = 1 AND g.away_score > g.home_score))
    ORDER BY g.game_date OFFSET 30 LIMIT 1`;
  await sql`
    UPDATE game_flow SET comeback_margin = 15, lac_largest_deficit = 15, margin_series = '[[0,0],[1440,-15],[2880,3]]'::jsonb
    WHERE game_id = ${win.game_id}::bigint`;
  return win.game_id;
}
