-- Docs/migrations/2026-09-audit-backup.sql
-- Snapshot of every table 2026-09-audit.sql modifies, copied into schema
-- backup_2026_09 inside the same database (no data leaves Neon). Run before
-- the migration. Only the FIRST run copies data: if the schema exists it is
-- left untouched, so a re-run never overwrites the pre-migration snapshot.
--
-- Restore a table (example):
--   BEGIN; TRUNCATE games CASCADE; INSERT INTO games SELECT * FROM backup_2026_09.games; ... COMMIT;
-- Drop when no longer needed:  DROP SCHEMA backup_2026_09 CASCADE;

DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'backup_2026_09') THEN
    RAISE NOTICE 'backup_2026_09 already exists — keeping the existing snapshot';
    RETURN;
  END IF;
  CREATE SCHEMA backup_2026_09;
  FOREACH t IN ARRAY ARRAY[
    'games', 'players', 'game_team_box_scores', 'game_player_box_scores',
    'advanced_team_game_stats', 'advanced_player_game_stats',
    'odds_snapshots', 'live_snapshots', 'insights'
  ] LOOP
    EXECUTE format('CREATE TABLE backup_2026_09.%I AS TABLE public.%I', t, t);
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'backed up % (% rows)', t, n;
  END LOOP;
END $$;
