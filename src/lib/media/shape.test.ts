import { describe, it, expect } from 'vitest';
import { shapeMedia, socialScore } from './shape';
import type { MediaItem } from '../ui/types';

const now = new Date('2026-10-20T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const item = (p: Partial<MediaItem>): MediaItem => ({
  media_id: Math.random().toString(36), kind: 'article', source: 'ESPN', url: 'https://x', title: 't', author: null,
  published_at: hoursAgo(1), engagement: null, comments: null, thumbnail_url: null, embed_url: null, ...p,
});

describe('socialScore', () => {
  it('decays engagement with age', () => {
    expect(socialScore({ engagement: 100, published_at: hoursAgo(0) }, now)).toBeCloseTo(100 / 2 ** 1.5);
    expect(socialScore({ engagement: 100, published_at: hoursAgo(10) }, now)).toBeLessThan(socialScore({ engagement: 100, published_at: hoursAgo(1) }, now));
    expect(socialScore({ engagement: null, published_at: hoursAgo(1) }, now)).toBe(0);
  });
});

describe('shapeMedia', () => {
  it('splits articles (newest first) from social (hottest first) and applies the limit', () => {
    const rows = [
      item({ media_id: 'a-old', published_at: hoursAgo(5) }),
      item({ media_id: 'a-new', published_at: hoursAgo(1) }),
      item({ media_id: 's-fresh', kind: 'tweet', engagement: 300, published_at: hoursAgo(1) }),
      item({ media_id: 's-big-old', kind: 'reddit', engagement: 900, published_at: hoursAgo(30) }),
      item({ media_id: 's-small', kind: 'bluesky', engagement: 20, published_at: hoursAgo(1) }),
    ];
    const out = shapeMedia(rows, now, 2);
    expect(out.articles.map((i) => i.media_id)).toEqual(['a-new', 'a-old']);
    expect(out.social.map((i) => i.media_id)).toEqual(['s-fresh', 's-big-old']);
  });
});
