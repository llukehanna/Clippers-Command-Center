import { describe, it, expect } from 'vitest';
import { dedupeItems, titleKey } from './normalize';
import type { MediaItemInput } from './types';

const item = (p: Partial<MediaItemInput>): MediaItemInput => ({
  kind: 'article', source: 'ESPN', url: 'https://x', dedupKey: 'k', title: 't', author: null,
  publishedAt: '2026-10-20T12:00:00Z', engagement: null, comments: null, thumbnailUrl: null, embedUrl: null, priority: 1, ...p,
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
