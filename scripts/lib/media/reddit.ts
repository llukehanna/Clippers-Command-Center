// scripts/lib/media/reddit.ts
// r/LAClippers "hot" via a free Reddit script app (OAuth client credentials).
// Posts that link to an X status become kind 'tweet' so the UI can embed the
// real post; the rest stay 'reddit'.
import type { MediaItemInput } from './types.js';

export interface RedditCredentials { clientId: string; clientSecret: string; userAgent: string }

const SUBREDDIT = 'LAClippers';
const THREAD = /\b(game thread|post[- ]?game thread|pre[- ]?game thread)\b/i;
// x.com / twitter.com and the fxtwitter / vxtwitter / fixupx embed-fixer
// mirrors; either /<user>/status/<id> or /i/web/status/<id>.
const TWEET = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter|fxtwitter|vxtwitter|fixupx)\.com\/(?:i\/web|([A-Za-z0-9_]+))\/status\/(\d+)/i;

export function tweetUrl(url: string): { id: string; embedUrl: string } | null {
  const m = TWEET.exec(url);
  if (!m) return null;
  const [, user, id] = m;
  return { id, embedUrl: user ? `https://twitter.com/${user}/status/${id}` : `https://twitter.com/i/web/status/${id}` };
}

interface RedditPost {
  id: string; title: string; permalink: string; url: string; author: string; score: number; num_comments: number;
  created_utc: number; stickied: boolean; over_18: boolean; link_flair_text: string | null; thumbnail?: string;
  preview?: { images?: { source?: { url?: string } }[] };
}

export function redditToItems(listing: unknown): MediaItemInput[] {
  const children = (listing as { data?: { children?: { data: RedditPost }[] } })?.data?.children;
  if (!Array.isArray(children)) return [];
  const items: MediaItemInput[] = [];
  for (const { data: p } of children) {
    if (!p || p.stickied || p.over_18) continue;
    if (THREAD.test(p.title) || THREAD.test(p.link_flair_text ?? '')) continue;
    const tweet = tweetUrl(p.url ?? '');
    const preview = p.preview?.images?.[0]?.source?.url ?? null;
    const thumb = preview ?? (p.thumbnail?.startsWith('http') ? p.thumbnail : null);
    items.push({
      kind: tweet ? 'tweet' : 'reddit',
      source: `r/${SUBREDDIT}`,
      url: `https://www.reddit.com${p.permalink}`,
      dedupKey: tweet ? `tweet:${tweet.id}` : `reddit:${p.id}`,
      title: p.title,
      author: p.author ?? null,
      publishedAt: new Date(p.created_utc * 1000).toISOString(),
      engagement: p.score ?? null,
      comments: p.num_comments ?? null,
      thumbnailUrl: thumb,
      embedUrl: tweet?.embedUrl ?? null,
      priority: 1,
    });
  }
  return items;
}

export async function fetchRedditHot(creds: RedditCredentials): Promise<unknown> {
  const auth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'User-Agent': creds.userAgent, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15_000),
  });
  if (!tokenRes.ok) throw new Error(`reddit token HTTP ${tokenRes.status}`);
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) throw new Error('reddit token missing');
  const res = await fetch(`https://oauth.reddit.com/r/${SUBREDDIT}/hot?limit=50&raw_json=1`, {
    headers: { Authorization: `Bearer ${access_token}`, 'User-Agent': creds.userAgent },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`reddit hot HTTP ${res.status}`);
  return res.json();
}
