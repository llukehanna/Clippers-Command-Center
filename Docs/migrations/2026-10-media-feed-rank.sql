-- Docs/migrations/2026-10-media-feed-rank.sql
-- Reddit switched from the OAuth JSON API to the public RSS feed, which has
-- no score/comment counts; posts carry their hot-list position instead.
-- Idempotent; one transaction.
BEGIN;

ALTER TABLE media_items ADD COLUMN IF NOT EXISTS feed_rank SMALLINT;

COMMIT;
