// src/lib/media/shape.ts
// Ranking for /api/media. Pure.
import type { MediaItem } from '../ui/types';

/** Hacker-News-style heat: engagement decayed by age in hours. */
export function socialScore(item: Pick<MediaItem, 'engagement' | 'published_at'>, now: Date): number {
  const hours = Math.max(0, (now.getTime() - new Date(item.published_at).getTime()) / 3_600_000);
  return (item.engagement ?? 0) / (hours + 2) ** 1.5;
}

export function shapeMedia(rows: MediaItem[], now: Date, limit: number): { articles: MediaItem[]; social: MediaItem[] } {
  const articles = rows
    .filter((r) => r.kind === 'article')
    .sort((a, b) => b.published_at.localeCompare(a.published_at))
    .slice(0, limit);
  const social = rows
    .filter((r) => r.kind !== 'article')
    .map((r) => ({ r, s: socialScore(r, now) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ r }) => r);
  return { articles, social };
}
