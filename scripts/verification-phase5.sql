-- Phase 5 Advanced Stats Engine — Verification Queries
-- Run after: npm run compute-stats

-- 1. Row counts across all four derived tables
SELECT
  (SELECT count(*) FROM advanced_team_game_stats)   AS adv_team_rows,
  (SELECT count(*) FROM advanced_player_game_stats)  AS adv_player_rows,
  (SELECT count(*) FROM rolling_team_stats)           AS rolling_team_rows,
  (SELECT count(*) FROM rolling_player_stats)         AS rolling_player_rows;

-- 2. Spot-check advanced team stats (eFG% validation — compare against Basketball-Reference)
SELECT
  t.abbreviation AS team,
  g.game_date,
  a.efg_pct,
  a.ts_pct,
  a.pace,
  a.off_rating,
  a.def_rating,
  a.net_rating
FROM advanced_team_game_stats a
JOIN games g ON g.game_id = a.game_id
JOIN teams t ON t.team_id = a.team_id
WHERE t.abbreviation = 'LAC'
ORDER BY g.game_date;

-- 3. Verify both window sizes exist for teams
SELECT DISTINCT window_games FROM rolling_team_stats ORDER BY 1;
-- Expected: 5, 10 (only if >= 5 or >= 10 games exist in the seeded dataset)

-- 4. Verify both window sizes exist for players
SELECT DISTINCT window_games FROM rolling_player_stats ORDER BY 1;
-- Expected: 5, 10 (only if >= 5 or >= 10 games exist per player)

-- 5. Sample rolling team stats for Clippers
SELECT
  t.abbreviation,
  r.season_id,
  r.window_games,
  r.as_of_game_date,
  r.off_rating,
  r.def_rating,
  r.net_rating,
  r.record_wins,
  r.record_losses
FROM rolling_team_stats r
JOIN teams t ON t.team_id = r.team_id
WHERE t.abbreviation = 'LAC'
ORDER BY r.season_id, r.window_games, r.as_of_game_date;

-- 6. Sample rolling player stats (top 5 by eFG%)
SELECT
  p.display_name,
  r.window_games,
  r.as_of_game_date,
  r.points,
  r.rebounds,
  r.assists,
  r.efg_pct
FROM rolling_player_stats r
JOIN players p ON p.player_id = r.player_id
WHERE r.window_games = 5
ORDER BY r.efg_pct DESC NULLS LAST
LIMIT 5;
