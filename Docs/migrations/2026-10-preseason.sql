-- Preseason games, for the live page only.
--
-- Preseason games are stored so the game-night runner can poll them and
-- /live can show them, but they must never count anywhere else (records,
-- history, player stats, insights, the record book, win-prob calibration).
-- Rather than add a filter to every query, the table becomes all_games and
-- `games` becomes a view of everything that isn't preseason. Existing queries
-- keep reading `games` unchanged; only the live path reads all_games.
--
-- The view is automatically updatable: INSERT (column defaults included),
-- ON CONFLICT, UPDATE … FROM and DELETE through `games` all reach all_games.
-- Foreign keys follow the table through the rename.
--
-- Backward compatible: code that predates this migration still works, so
-- apply it before deploying the code that reads all_games.
--
-- Idempotent; safe to re-run.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.all_games') IS NULL THEN
    ALTER TABLE public.games RENAME TO all_games;
  END IF;
END $$;

ALTER TABLE all_games ADD COLUMN IF NOT EXISTS is_preseason BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE VIEW games AS
  SELECT game_id, nba_game_id, season_id, game_date, start_time_utc, status,
         home_team_id, away_team_id, home_score, away_score, period, clock,
         is_playoffs, arena, created_at, updated_at
  FROM all_games
  WHERE NOT is_preseason;

COMMIT;
