-- Docs/migrations/2026-11-pbp-shot-location.sql
-- cdn.nba.com refuses every client outside nba.com since late October 2026, so
-- post-game play-by-play now falls back to ESPN, which also reports where each
-- field goal was taken. game_flow.source gains 'espn' (TEXT, no constraint).
-- Idempotent; one transaction.
BEGIN;

ALTER TABLE pbp_events ADD COLUMN IF NOT EXISTS shot_x REAL;  -- feet across the half court (0–50); espn field goals only
ALTER TABLE pbp_events ADD COLUMN IF NOT EXISTS shot_y REAL;  -- feet from the baseline

COMMIT;
