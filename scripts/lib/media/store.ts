// scripts/lib/media/store.ts
// media_items writes. A lower priority number replaces an existing story's
// source/url/title; engagement and comment counts always refresh.
import { sql as rootSql } from '../db.js';
import type { Db } from '../upserts.js';
import { isHttpUrl, MEDIA_RETENTION_DAYS } from './normalize.js';
import type { MediaItemInput } from './types.js';

export { MEDIA_RETENTION_DAYS };

/**
 * Items whose url isn't http(s) are dropped; a non-http(s) thumbnailUrl or
 * embedUrl is written as null (the UI puts these straight into href/src).
 */
export async function upsertMediaItems(items: MediaItemInput[], db: Db = rootSql): Promise<number> {
  const safe = items
    .filter((i) => isHttpUrl(i.url))
    .map((i) => ({
      ...i,
      thumbnailUrl: isHttpUrl(i.thumbnailUrl) ? i.thumbnailUrl : null,
      embedUrl: isHttpUrl(i.embedUrl) ? i.embedUrl : null,
    }));
  if (safe.length === 0) return 0;
  const rows = safe.map((i) => ({
    kind: i.kind, source: i.source, url: i.url, dedup_key: i.dedupKey, title: i.title, author: i.author,
    published_at: i.publishedAt, engagement: i.engagement, comments: i.comments,
    thumbnail_url: i.thumbnailUrl, embed_url: i.embedUrl, priority: i.priority,
  }));
  const result = await db`
    INSERT INTO media_items ${db(rows)}
    ON CONFLICT (dedup_key) DO UPDATE SET
      engagement    = EXCLUDED.engagement,
      comments      = EXCLUDED.comments,
      thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, media_items.thumbnail_url),
      source        = CASE WHEN EXCLUDED.priority < media_items.priority THEN EXCLUDED.source ELSE media_items.source END,
      url           = CASE WHEN EXCLUDED.priority < media_items.priority THEN EXCLUDED.url ELSE media_items.url END,
      title         = CASE WHEN EXCLUDED.priority < media_items.priority THEN EXCLUDED.title ELSE media_items.title END,
      author        = CASE WHEN EXCLUDED.priority < media_items.priority THEN EXCLUDED.author ELSE media_items.author END,
      priority      = LEAST(EXCLUDED.priority, media_items.priority),
      fetched_at    = now()
  `;
  return result.count;
}

export async function pruneMedia(db: Db = rootSql, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - MEDIA_RETENTION_DAYS * 86_400_000).toISOString();
  const result = await db`DELETE FROM media_items WHERE published_at < ${cutoff}::timestamptz`;
  return result.count;
}
