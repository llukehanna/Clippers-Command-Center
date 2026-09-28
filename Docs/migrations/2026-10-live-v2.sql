-- Live v2 (Docs/superpowers/specs/2026-09-27-live-v2-realtime-design.md §5).
-- Idempotent; safe to re-run.
BEGIN;

CREATE TABLE IF NOT EXISTS live_state (
  game_id          BIGINT PRIMARY KEY REFERENCES games(game_id) ON DELETE CASCADE,
  seq              INTEGER NOT NULL,
  state            JSONB NOT NULL,
  fetched_at       TIMESTAMPTZ NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_live_state_fetched ON live_state (fetched_at DESC);

COMMIT;
