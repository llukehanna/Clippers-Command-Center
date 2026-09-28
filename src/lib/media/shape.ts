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
  const reddit = socialRows.filter((r) => r.source === REDDIT_SOURCE);
  const other = socialRows.filter((r) => r.source !== REDDIT_SOURCE);

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
  const social: MediaItem[] = [];
  let i = 0;
  let j = 0;
  while (social.length < limit && (i < redditOrdered.length || j < otherOrdered.length)) {
    if (i < redditOrdered.length) {
      social.push(redditOrdered[i++]);
      if (social.length >= limit) break;
    }
    if (j < otherOrdered.length) social.push(otherOrdered[j++]);
  }
  return { articles, social };
}
