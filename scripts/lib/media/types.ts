// scripts/lib/media/types.ts
// One shape for every news/social source, as written to media_items.

export type MediaKind = 'article' | 'reddit' | 'tweet' | 'bluesky';

export interface MediaItemInput {
  kind: MediaKind;
  source: string;
  url: string;
  dedupKey: string;
  title: string;
  author: string | null;
  publishedAt: string;          // ISO 8601
  engagement: number | null;
  comments: number | null;
  thumbnailUrl: string | null;
  embedUrl: string | null;
  priority: number;             // lower wins de-duplication
  feedRank: number | null;      // 1-based position in the source's hot list (Reddit only)
}
