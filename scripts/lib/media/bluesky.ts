// scripts/lib/media/bluesky.ts
// Top Bluesky posts mentioning the Clippers in the last 24 hours (public AppView, no auth).
import type { MediaItemInput } from './types.js';

export const BSKY_MIN_LIKES = 10;
const MENTION = /\bclippers\b/i;

interface BskyPost {
  uri: string;
  author: { handle: string; displayName?: string };
  record: { text?: string; createdAt?: string };
  likeCount?: number; repostCount?: number; replyCount?: number;
}

export function blueskyToItems(resp: unknown): MediaItemInput[] {
  const posts = (resp as { posts?: BskyPost[] })?.posts;
  if (!Array.isArray(posts)) return [];
  const items: MediaItemInput[] = [];
  for (const p of posts) {
    const text = (p.record?.text ?? '').trim();
    const created = new Date(p.record?.createdAt ?? '');
    if (!text || !MENTION.test(text) || Number.isNaN(created.getTime())) continue;
    if ((p.likeCount ?? 0) < BSKY_MIN_LIKES) continue;
    const rkey = p.uri.split('/').pop();
    items.push({
      kind: 'bluesky', source: 'Bluesky',
      url: `https://bsky.app/profile/${p.author.handle}/post/${rkey}`,
      dedupKey: `bsky:${p.uri}`,
      title: text.length > 300 ? `${text.slice(0, 297)}…` : text,
      author: p.author.displayName || p.author.handle,
      publishedAt: created.toISOString(),
      engagement: (p.likeCount ?? 0) + (p.repostCount ?? 0),
      comments: p.replyCount ?? null,
      thumbnailUrl: null, embedUrl: null, priority: 1,
    });
  }
  return items;
}

export async function fetchBlueskyTop(now: Date = new Date()): Promise<unknown> {
  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const q = new URLSearchParams({ q: 'clippers', sort: 'top', since, limit: '50' });
  const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?${q}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`bluesky search HTTP ${res.status}`);
  return res.json();
}
