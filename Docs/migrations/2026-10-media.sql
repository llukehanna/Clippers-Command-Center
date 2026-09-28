-- Docs/migrations/2026-10-media.sql
-- Insights v2, plan 5: news and social items. Idempotent; one transaction.
BEGIN;

-- =============================================================================
-- News and social (scripts/sync-media.ts) — external content, not insights
-- =============================================================================

CREATE TABLE IF NOT EXISTS media_items (
  media_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          TEXT NOT NULL,             -- 'article' | 'reddit' | 'tweet' | 'bluesky'
  source        TEXT NOT NULL,             -- 'ESPN', 'LA Times', 'r/LAClippers', 'Bluesky', ...
  url           TEXT NOT NULL,
  dedup_key     TEXT NOT NULL UNIQUE,      -- 'article:<title key>' | 'reddit:<id>' | 'tweet:<id>' | 'bsky:<uri>'
  title         TEXT NOT NULL,
  author        TEXT,
  published_at  TIMESTAMPTZ NOT NULL,
  engagement    INTEGER,                   -- reddit score / bluesky likes + reposts
  comments      INTEGER,
  thumbnail_url TEXT,
  embed_url     TEXT,                      -- tweet URL for kind 'tweet'
  priority      SMALLINT NOT NULL DEFAULT 1, -- lower wins de-duplication (1 direct, 2 aggregator)
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_media_kind_published ON media_items (kind, published_at DESC);

COMMIT;
