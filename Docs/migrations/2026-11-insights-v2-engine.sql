-- Insights v2 engine (Plan 2): surface, frame, evidence, entities, score parts,
-- first emission. Additive and idempotent; safe to re-run.
-- Apply: DB Migrate workflow, file=2026-11-insights-v2-engine.sql, confirm=migrate.
BEGIN;

ALTER TABLE insights ADD COLUMN IF NOT EXISTS surface          TEXT;
ALTER TABLE insights ADD COLUMN IF NOT EXISTS frame            JSONB;
ALTER TABLE insights ADD COLUMN IF NOT EXISTS evidence         JSONB;
ALTER TABLE insights ADD COLUMN IF NOT EXISTS entities         JSONB;
ALTER TABLE insights ADD COLUMN IF NOT EXISTS score_parts      JSONB;
ALTER TABLE insights ADD COLUMN IF NOT EXISTS first_emitted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_insights_active_surface ON insights (is_active, surface, importance DESC);

COMMIT;
