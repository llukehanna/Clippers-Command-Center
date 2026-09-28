import { describe, it, expect } from 'vitest';
import { dedupeItems, inRetention, isHttpUrl, MEDIA_RETENTION_DAYS, titleKey } from './normalize';
import type { MediaItemInput } from './types';

const item = (p: Partial<MediaItemInput>): MediaItemInput => ({
  kind: 'article', source: 'ESPN', url: 'https://x', dedupKey: 'k', title: 't', author: null,
  publishedAt: '2026-10-20T12:00:00Z', engagement: null, comments: null, thumbnailUrl: null, embedUrl: null, priority: 1, feedRank: null, ...p,
});

describe('titleKey', () => {
  it('ignores case, punctuation and accents', () => {
    expect(titleKey("Clippers' Harden: 'We'll be fine' — after loss")).toBe('clippers harden we ll be fine after loss');
    expect(titleKey('Jokić scores 40')).toBe(titleKey('Jokic Scores 40!'));
  });
});

describe('dedupeItems', () => {
  it('keeps one item per key, preferring the lower priority number', () => {
    const out = dedupeItems([
      item({ dedupKey: 'a', source: 'Google News', priority: 2 }),
      item({ dedupKey: 'a', source: 'LA Times', priority: 1 }),
      item({ dedupKey: 'b', source: 'ESPN' }),
    ]);
    expect(out.map((i) => [i.dedupKey, i.source])).toEqual([['a', 'LA Times'], ['b', 'ESPN']]);
  });
  it('keeps the first seen on equal priority', () => {
    const out = dedupeItems([item({ dedupKey: 'a', source: 'ESPN' }), item({ dedupKey: 'a', source: 'LA Times' })]);
    expect(out[0].source).toBe('ESPN');
  });
});

describe('inRetention', () => {
  const now = new Date('2026-10-20T12:00:00.000Z');
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  it('drops items published before the retention window', () => {
    const out = inRetention([
      item({ dedupKey: 'fresh', publishedAt: daysAgo(1) }),
      item({ dedupKey: 'edge', publishedAt: daysAgo(MEDIA_RETENTION_DAYS) }),
      item({ dedupKey: 'stale', publishedAt: daysAgo(MEDIA_RETENTION_DAYS + 0.01) }),
    ], now);
    expect(out.map((i) => i.dedupKey)).toEqual(['fresh', 'edge']);
  });
  it('clamps future timestamps to now and leaves others untouched', () => {
    const out = inRetention([
      item({ dedupKey: 'future', publishedAt: '2026-10-21T00:00:00.000Z' }),
      item({ dedupKey: 'past', publishedAt: daysAgo(2) }),
    ], now);
    expect(out.map((i) => [i.dedupKey, i.publishedAt])).toEqual([
      ['future', '2026-10-20T12:00:00.000Z'],
      ['past', daysAgo(2)],
    ]);
  });
  it('is a 7-day window', () => {
    expect(MEDIA_RETENTION_DAYS).toBe(7);
  });
});

describe('isHttpUrl', () => {
  it('accepts http(s) URLs only', () => {
    expect(isHttpUrl('https://www.espn.com/nba/story/_/id/1')).toBe(true);
    expect(isHttpUrl('http://example.com')).toBe(true);
    expect(isHttpUrl('HTTPS://EXAMPLE.COM/x')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('data:text/html,<b>x</b>')).toBe(false);
    expect(isHttpUrl('ftp://example.com/file')).toBe(false);
    expect(isHttpUrl('/relative/path')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
    expect(isHttpUrl(null)).toBe(false);
  });
});
