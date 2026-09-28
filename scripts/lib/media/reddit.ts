// scripts/lib/media/reddit.ts
// r/LAClippers "hot" — public RSS by default (no credentials needed; Reddit
// now gates the OAuth API behind its Responsible Builder Policy approval),
// or the OAuth JSON API when REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET are set
// (adds real score/comment counts). Posts that link to an X status become
// kind 'tweet' so the UI can embed the real post; the rest stay 'reddit'.
import { parser, list, text, stripHtml, attr, type Node } from './rss.js';
import type { MediaItemInput } from './types.js';

export interface RedditCredentials { clientId: string; clientSecret: string; userAgent: string }

const SUBREDDIT = 'LAClippers';
const THREAD = /\b(game thread|post[- ]?game thread|pre[- ]?game thread|weekly discussion|daily discussion)\b/i;
// x.com / twitter.com and the fxtwitter / vxtwitter / fixupx embed-fixer
// mirrors; either /<user>/status/<id> or /i/web/status/<id>.
const TWEET = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter|fxtwitter|vxtwitter|fixupx)\.com\/(?:i\/web|([A-Za-z0-9_]+))\/status\/(\d+)/i;

export function tweetUrl(url: string): { id: string; embedUrl: string } | null {
  const m = TWEET.exec(url);
  if (!m) return null;
  const [, user, id] = m;
  return { id, embedUrl: user ? `https://twitter.com/${user}/status/${id}` : `https://twitter.com/i/web/status/${id}` };
}

// r/LAClippers insider screenshot posts are titled "[Insider Name] tweet
// text" (a screenshot of the tweet, no link to X itself). Bracket content
// must look like a person/outlet name, not a generic post-flair tag.
const INSIDER_BRACKET = /^\s*\[([^\]]{2,40})\]\s*(.+)$/;
const INSIDER_CHARS = /^[A-Za-z .'’\-/&]+$/;
const GENERIC_TAGS = new Set([
  'highlight', 'highlights', 'game thread', 'post game thread', 'pre game thread', 'postgame', 'pregame',
  'discussion', 'serious', 'meme', 'oc', 'stats', 'video', 'news', 'rumor', 'request', 'question', 'poll',
  'official', 'final', 'pic', 'image', 'gif', 'discussion thread',
]);
// Curly and straight double quotes; the whole text must be quoted, both ends.
const QUOTE_PAIRS: [string, string][] = [['"', '"'], ['“', '”']];

function stripQuotes(s: string): string {
  for (const [open, close] of QUOTE_PAIRS) {
    if (s.length >= open.length + close.length && s.startsWith(open) && s.endsWith(close)) {
      return s.slice(open.length, s.length - close.length).trim();
    }
  }
  return s;
}

export function insiderPost(title: string): { insider: string; text: string } | null {
  const m = INSIDER_BRACKET.exec(title);
  if (!m) return null;
  const bracket = m[1].trim();
  if (!INSIDER_CHARS.test(bracket) || GENERIC_TAGS.has(bracket.toLowerCase())) return null;
  const text = stripQuotes(m[2].trim());
  if (!text) return null;
  return { insider: bracket, text };
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
  let rank = 0;
  for (const { data: p } of children) {
    if (!p || p.stickied || p.over_18) continue;
    if (THREAD.test(p.title) || THREAD.test(p.link_flair_text ?? '')) continue;
    const tweet = tweetUrl(p.url ?? '');
    const insider = insiderPost(p.title);
    const preview = p.preview?.images?.[0]?.source?.url ?? null;
    const thumb = preview ?? (p.thumbnail?.startsWith('http') ? p.thumbnail : null);
    rank += 1;
    items.push({
      kind: tweet || insider ? 'tweet' : 'reddit',
      source: `r/${SUBREDDIT}`,
      url: `https://www.reddit.com${p.permalink}`,
      dedupKey: tweet ? `tweet:${tweet.id}` : `reddit:${p.id}`,
      title: insider ? insider.text : p.title,
      author: insider ? insider.insider : (p.author ?? null),
      publishedAt: new Date(p.created_utc * 1000).toISOString(),
      engagement: p.score ?? null,
      comments: p.num_comments ?? null,
      thumbnailUrl: thumb,
      embedUrl: tweet?.embedUrl ?? null,
      priority: 1,
      feedRank: rank,
    });
  }
  return items;
}

// The RSS `content` field is the same escaped-HTML "submitted by ... [link]
// [comments]" block reddit.com renders on old.reddit.com; the anchor right
// before "[link]" is the post's external target (or itself, for a self-post).
const CONTENT_LINK = /<a\s+href="([^"]*)">\s*\[link\]\s*<\/a>/i;

export function redditRssToItems(xml: string): MediaItemInput[] {
  let doc: Node;
  try {
    doc = parser.parse(xml) as Node;
  } catch {
    throw new Error('reddit rss: response is not an Atom feed');
  }
  const feed = doc.feed as Node | undefined;
  // A block/consent/error page (or any non-Atom body) parses fine but has no
  // <feed> root — that must not look like "zero posts right now" upstream:
  // sync-media would otherwise treat it as a successful empty fetch and
  // clear every stored feed_rank.
  if (!feed) throw new Error('reddit rss: response is not an Atom feed');
  const entries = list(feed.entry as Node | Node[] | undefined);
  const items: MediaItemInput[] = [];
  let rank = 0;
  for (const e of entries) {
    const idMatch = /^t3_(\w+)$/.exec(text(e.id));
    if (!idMatch) continue;
    const title = stripHtml(text(e.title));
    if (!title || THREAD.test(title)) continue;
    const href = attr(e.link, 'href');
    if (!href || !/^https?:\/\//.test(href)) continue;
    const publishedRaw = text(e.published) || text(e.updated);
    const published = new Date(publishedRaw);
    if (Number.isNaN(published.getTime())) continue;

    const authorName = text((e.author as Node | undefined)?.name);
    const author = authorName ? authorName.replace(/^\/u\//, '') : null;
    const thumb = attr(e['media:thumbnail'], 'url');
    const thumbnailUrl = thumb && /^https?:\/\//.test(thumb) ? thumb : null;
    const contentLink = CONTENT_LINK.exec(text(e.content))?.[1] ?? '';
    const tweet = tweetUrl(contentLink);
    const insider = insiderPost(title);

    rank += 1;
    items.push({
      kind: tweet || insider ? 'tweet' : 'reddit',
      source: `r/${SUBREDDIT}`,
      url: href,
      dedupKey: tweet ? `tweet:${tweet.id}` : `reddit:${idMatch[1]}`,
      title: insider ? insider.text : title,
      author: insider ? insider.insider : author,
      publishedAt: published.toISOString(),
      engagement: null,
      comments: null,
      thumbnailUrl,
      embedUrl: tweet?.embedUrl ?? null,
      priority: 1,
      feedRank: rank,
    });
  }
  return items;
}

export async function fetchRedditRss(userAgent: string): Promise<string> {
  const res = await fetch(`https://www.reddit.com/r/${SUBREDDIT}/hot/.rss?limit=25`, {
    headers: { 'User-Agent': userAgent },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`reddit rss HTTP ${res.status}`);
  return res.text();
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
