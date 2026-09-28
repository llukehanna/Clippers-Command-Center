// src/lib/media/shape.ts
// Ranking for /api/media. Pure.
import type { MediaItem } from '../ui/types';

/** Hacker-News-style heat: engagement decayed by age in hours. */
export function socialScore(item: Pick<MediaItem, 'engagement' | 'published_at'>, now: Date): number {
  const hours = Math.max(0, (now.getTime() - new Date(item.published_at).getTime()) / 3_600_000);
  return (item.engagement ?? 0) / (hours + 2) ** 1.5;
}

const REDDIT_SOURCE = 'r/LAClippers';

export function shapeMedia(rows: MediaItem[], now: Date, limit: number): { articles: MediaItem[]; social: MediaItem[] } {
  const articles = rows
    .filter((r) => r.kind === 'article')
    .sort((a, b) => b.published_at.localeCompare(a.published_at))
    .slice(0, limit);

  const socialRows = rows.filter((r) => r.kind !== 'article');

  // From X (kind 'tweet' — a real embedded tweet, or an insider screenshot
  // post from r/LAClippers) lead the social feed: ranked by this fetch's
  // hot-list position first (null last), then most recent.
  const tweets = socialRows
    .filter((r) => r.kind === 'tweet')
    .sort((a, b) => {
      const ar = a.feed_rank ?? Infinity;
      const br = b.feed_rank ?? Infinity;
      if (ar !== br) return ar - br;
      return b.published_at.localeCompare(a.published_at);
    });

  const rest = socialRows.filter((r) => r.kind !== 'tweet');
  const reddit = rest.filter((r) => r.source === REDDIT_SOURCE);
  const other = rest.filter((r) => r.source !== REDDIT_SOURCE);

  // Reddit's RSS feed carries no engagement counts, so ranked posts (this
  // fetch's hot-list position) sort ahead of unranked leftovers from a prior
  // fetch that fell out of the list, which sort by recency.
  const ranked = reddit.filter((r) => r.feed_rank != null).sort((a, b) => a.feed_rank! - b.feed_rank!);
  const unranked = reddit.filter((r) => r.feed_rank == null).sort((a, b) => b.published_at.localeCompare(a.published_at));
  const redditOrdered = [...ranked, ...unranked];

  const otherOrdered = other
    .map((r) => ({ r, s: socialScore(r, now) }))
    .sort((a, b) => b.s - a.s)
    .map(({ r }) => r);

  // Round-robin starting with Reddit so one source can't drown out the
  // other; a source with nothing left just stops contributing.
  const restOrdered: MediaItem[] = [];
  let i = 0;
  let j = 0;
  while (i < redditOrdered.length || j < otherOrdered.length) {
    if (i < redditOrdered.length) restOrdered.push(redditOrdered[i++]);
    if (j < otherOrdered.length) restOrdered.push(otherOrdered[j++]);
  }

  const social = [...tweets, ...restOrdered].slice(0, limit);
  return { articles, social };
}
