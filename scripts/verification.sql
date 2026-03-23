-- scripts/verification.sql
-- Run: psql $DATABASE_URL -f scripts/verification.sql
-- Purpose: Verify backfill success after running npm run backfill

-- 1. Table existence check (all must return rows)
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- 2. Record counts by table
SELECT 'seasons' AS tbl, count(*) FROM seasons
UNION ALL SELECT 'teams', count(*) FROM teams
UNION ALL SELECT 'players', count(*) FROM players
UNION ALL SELECT 'games', count(*) FROM games
UNION ALL SELECT 'game_team_box_scores', count(*) FROM game_team_box_scores
UNION ALL SELECT 'game_player_box_scores', count(*) FROM game_player_box_scores
UNION ALL SELECT 'player_team_stints', count(*) FROM player_team_stints
ORDER BY tbl;

-- 3. Games by season (must have 3 seasons: 2022, 2023, 2024)
SELECT season_id, count(*) AS game_count, count(*) FILTER (WHERE status = 'final') AS final_count
FROM games
GROUP BY season_id
ORDER BY season_id;

-- 4. Idempotency check: no duplicate games (nba_game_id should be unique)
SELECT nba_game_id, count(*) AS n FROM games GROUP BY nba_game_id HAVING count(*) > 1;

-- 5. Box score completeness: games with team box scores but missing player box scores
SELECT g.nba_game_id, g.game_date
FROM games g
JOIN game_team_box_scores t ON t.game_id = g.game_id
LEFT JOIN game_player_box_scores p ON p.game_id = g.game_id
WHERE p.game_id IS NULL AND g.status = 'final'
LIMIT 10;

-- 6. DATA-05: Verify no box scores exist for non-Final games
SELECT g.nba_game_id, g.status
FROM games g
JOIN game_team_box_scores b ON b.game_id = g.game_id
WHERE g.status != 'final'
LIMIT 10;

-- 7. Spot-check: sample player box scores for a known game
SELECT p.first_name, p.last_name, pb.points, pb.rebounds, pb.assists, pb.minutes
FROM game_player_box_scores pb
JOIN players p ON p.player_id = pb.player_id
JOIN games g ON g.game_id = pb.game_id
WHERE g.season_id = 2022
ORDER BY pb.points DESC
LIMIT 10;

-- 8. app_kv checkpoint state
SELECT key, value, updated_at FROM app_kv ORDER BY updated_at DESC;
