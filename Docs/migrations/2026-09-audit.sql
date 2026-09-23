-- Docs/migrations/2026-09-audit.sql
-- Clippers Command Center — 2026-09 audit migration.
--
-- Brings an existing database in line with Docs/DB_SCHEMA.sql:
--   1. players.nba_person_id (official NBA personId) + UNIQUE; nba_player_id
--      becomes nullable (finalization inserts players first seen in NBA box
--      scores, which have no balldontlie id).
--   2. games.status lowercased everywhere ('Final' → 'final').
--   3. Duplicate games rows (same game_date + home + away, written once by
--      balldontlie sync and once by the NBA CDN backfill) are merged: the row
--      with an NBA-format nba_game_id is kept, child rows are repointed to it,
--      the other rows are deleted.
--   4. UNIQUE (game_date, home_team_id, away_team_id) on games.
--
-- Idempotent: safe to run more than once. Runs in one transaction.
-- NOT applied automatically — run manually (psql "$DATABASE_URL" -f ...) after
-- taking a Neon branch/backup.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. players.nba_person_id
-- ---------------------------------------------------------------------------

ALTER TABLE players ADD COLUMN IF NOT EXISTS nba_person_id INTEGER;
ALTER TABLE players ALTER COLUMN nba_player_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'players_nba_person_id_key' AND conrelid = 'players'::regclass
  ) THEN
    -- A plain UNIQUE constraint (NULLs distinct) so finalize can use
    -- ON CONFLICT (nba_person_id).
    ALTER TABLE players ADD CONSTRAINT players_nba_person_id_key UNIQUE (nba_person_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Lowercase game status
-- ---------------------------------------------------------------------------

UPDATE games
SET status = CASE
               WHEN lower(status) LIKE 'final%' THEN 'final'
               ELSE regexp_replace(lower(trim(status)), '\s+', '_', 'g')
             END,
    updated_at = now()
WHERE status IS DISTINCT FROM (
        CASE
          WHEN lower(status) LIKE 'final%' THEN 'final'
          ELSE regexp_replace(lower(trim(status)), '\s+', '_', 'g')
        END
      );

-- ---------------------------------------------------------------------------
-- 3. Merge duplicate games
-- ---------------------------------------------------------------------------
-- Keeper per (game_date, home_team_id, away_team_id):
--   NBA-format nba_game_id first (20,000,000–59,999,999 with YY = season
--   start year mod 100 — same rule as scripts/lib/schedule-utils.ts), then the
--   row with the most player box scores, then the lowest game_id.

CREATE TEMP TABLE _game_dupes ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    g.game_id,
    g.game_date, g.home_team_id, g.away_team_id,
    ROW_NUMBER() OVER (
      PARTITION BY g.game_date, g.home_team_id, g.away_team_id
      ORDER BY
        (g.nba_game_id BETWEEN 20000000 AND 59999999
          AND (g.season_id IS NULL OR (g.nba_game_id / 100000) % 100 = g.season_id % 100)) DESC,
        (SELECT COUNT(*) FROM game_player_box_scores pb WHERE pb.game_id = g.game_id) DESC,
        g.game_id ASC
    ) AS rn,
    COUNT(*) OVER (PARTITION BY g.game_date, g.home_team_id, g.away_team_id) AS n
  FROM games g
)
SELECT loser.game_id AS loser_id, keeper.game_id AS keeper_id
FROM ranked loser
JOIN ranked keeper
  ON keeper.game_date = loser.game_date
 AND keeper.home_team_id = loser.home_team_id
 AND keeper.away_team_id = loser.away_team_id
 AND keeper.rn = 1
WHERE loser.n > 1 AND loser.rn > 1;

-- Visible in psql output: how many rows will be merged.
SELECT COUNT(*) AS duplicate_game_rows_to_merge FROM _game_dupes;

-- Carry final status / scores / tipoff over to the keeper when only a loser has them.
UPDATE games k
SET status         = CASE WHEN k.status <> 'final' AND l.status = 'final' THEN 'final' ELSE k.status END,
    home_score     = CASE WHEN k.status <> 'final' AND l.status = 'final' THEN l.home_score
                          ELSE COALESCE(k.home_score, l.home_score) END,
    away_score     = CASE WHEN k.status <> 'final' AND l.status = 'final' THEN l.away_score
                          ELSE COALESCE(k.away_score, l.away_score) END,
    start_time_utc = COALESCE(k.start_time_utc, l.start_time_utc),
    season_id      = COALESCE(k.season_id, l.season_id),
    is_playoffs    = k.is_playoffs OR l.is_playoffs,
    updated_at     = now()
FROM _game_dupes d
JOIN games l ON l.game_id = d.loser_id
WHERE k.game_id = d.keeper_id;

-- Repoint children. Tables with a unique key on game_id: drop the loser's row
-- when the keeper already has one, then move the rest.

DELETE FROM game_team_box_scores c USING _game_dupes d
WHERE c.game_id = d.loser_id
  AND EXISTS (SELECT 1 FROM game_team_box_scores k WHERE k.game_id = d.keeper_id AND k.team_id = c.team_id);
UPDATE game_team_box_scores c SET game_id = d.keeper_id FROM _game_dupes d WHERE c.game_id = d.loser_id;

DELETE FROM game_player_box_scores c USING _game_dupes d
WHERE c.game_id = d.loser_id
  AND EXISTS (SELECT 1 FROM game_player_box_scores k WHERE k.game_id = d.keeper_id AND k.player_id = c.player_id);
UPDATE game_player_box_scores c SET game_id = d.keeper_id FROM _game_dupes d WHERE c.game_id = d.loser_id;

DELETE FROM advanced_team_game_stats c USING _game_dupes d
WHERE c.game_id = d.loser_id
  AND EXISTS (SELECT 1 FROM advanced_team_game_stats k WHERE k.game_id = d.keeper_id AND k.team_id = c.team_id);
UPDATE advanced_team_game_stats c SET game_id = d.keeper_id FROM _game_dupes d WHERE c.game_id = d.loser_id;

DELETE FROM advanced_player_game_stats c USING _game_dupes d
WHERE c.game_id = d.loser_id
  AND EXISTS (SELECT 1 FROM advanced_player_game_stats k WHERE k.game_id = d.keeper_id AND k.player_id = c.player_id);
UPDATE advanced_player_game_stats c SET game_id = d.keeper_id FROM _game_dupes d WHERE c.game_id = d.loser_id;

DELETE FROM odds_snapshots c USING _game_dupes d
WHERE c.game_id = d.loser_id
  AND EXISTS (
    SELECT 1 FROM odds_snapshots k
    WHERE k.game_id = d.keeper_id AND k.provider = c.provider AND k.captured_at = c.captured_at
  );
UPDATE odds_snapshots c SET game_id = d.keeper_id FROM _game_dupes d WHERE c.game_id = d.loser_id;

UPDATE live_snapshots c SET game_id = d.keeper_id FROM _game_dupes d WHERE c.game_id = d.loser_id;
UPDATE insights       c SET game_id = d.keeper_id FROM _game_dupes d WHERE c.game_id = d.loser_id;

-- Safety net: fail (and roll back everything) if any other table still
-- references a loser row, instead of cascading deletes into unknown data.
DO $$
DECLARE
  r record;
  n bigint;
BEGIN
  FOR r IN
    SELECT cl.relname AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f' AND c.confrelid = 'games'::regclass
  LOOP
    EXECUTE format(
      'SELECT COUNT(*) FROM %I t JOIN _game_dupes d ON t.%I = d.loser_id', r.tbl, r.col
    ) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'Table %.% still has % row(s) pointing at duplicate games', r.tbl, r.col, n;
    END IF;
  END LOOP;
END $$;

DELETE FROM games g USING _game_dupes d WHERE g.game_id = d.loser_id;

-- ---------------------------------------------------------------------------
-- 4. Natural-key constraint
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_games_date_home_away' AND conrelid = 'games'::regclass
  ) THEN
    ALTER TABLE games
      ADD CONSTRAINT uq_games_date_home_away UNIQUE (game_date, home_team_id, away_team_id);
  END IF;
END $$;

COMMIT;
