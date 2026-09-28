// src/lib/data/media.ts
// GET /api/media — news articles and social posts from media_items (last 7 days).
//   ?kind=article|social  (default: both)   ?limit=N (default 30, max 60)
import { json, type ApiResult } from './result';
import { sql } from '@/src/lib/db';
import { buildMeta, buildError } from '@/src/lib/api-utils';
import { shapeMedia } from '@/src/lib/media/shape';
import type { MediaItem } from '@/src/lib/ui/types';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 60;

export async function loadMedia(url: URL): Promise<ApiResult> {
  try {
    const kind = url.searchParams.get('kind');
    if (kind !== null && kind !== 'article' && kind !== 'social') {
      return json(buildError('BAD_REQUEST', 'kind must be article or social'), { status: 400 });
    }
    const raw = parseInt(url.searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10);
    const limit = Math.min(Math.max(Number.isNaN(raw) ? DEFAULT_LIMIT : raw, 1), MAX_LIMIT);

    type Row = Omit<MediaItem, 'published_at'> & { published_at: Date };

    // Articles: recency-only, so a LIMIT before shapeMedia is safe (it re-sorts
    // by published_at DESC anyway). Social: no row cap — a hot older post must
    // survive to be ranked by shapeMedia's engagement-decay score; the 7-day
    // retention window (Docs/migrations/2026-10-media.sql) already bounds it.
    const [articleRows, socialRows] = await Promise.all([
      kind === 'social'
        ? Promise.resolve<Row[]>([])
        : sql<Row[]>`
            SELECT media_id::text AS media_id, kind, source, url, title, author, published_at,
                   engagement, comments, thumbnail_url, embed_url, feed_rank
            FROM media_items
            WHERE published_at > now() - interval '7 days'
              AND kind = 'article'
            ORDER BY published_at DESC
            LIMIT ${limit}
          `,
      kind === 'article'
        ? Promise.resolve<Row[]>([])
        : sql<Row[]>`
            SELECT media_id::text AS media_id, kind, source, url, title, author, published_at,
                   engagement, comments, thumbnail_url, embed_url, feed_rank
            FROM media_items
            WHERE published_at > now() - interval '7 days'
              AND kind <> 'article'
            ORDER BY published_at DESC
          `,
    ]);

    const items: MediaItem[] = [...articleRows, ...socialRows].map((r) => ({ ...r, published_at: r.published_at.toISOString() }));
    const { articles, social } = shapeMedia(items, new Date(), limit);
    return json({ meta: buildMeta('db', 60), articles, social }, { headers: { 'Cache-Control': 'public, max-age=60' } });
  } catch (err) {
    console.error('[GET /api/media] Unexpected error:', err);
    return json(buildError('INTERNAL_ERROR', 'Failed to fetch media'), { status: 500 });
  }
}
