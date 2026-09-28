import { describe, it, expect } from 'vitest';
import { redditToItems, tweetUrl } from './reddit';

const post = (data: Record<string, unknown>) => ({ kind: 't3', data: {
  id: 'abc', title: 'Kawhi drops 41', permalink: '/r/LAClippers/comments/abc/kawhi_drops_41/', url: 'https://www.reddit.com/r/LAClippers/comments/abc/',
  author: 'fan1', score: 812, num_comments: 140, created_utc: 1792468800, stickied: false, over_18: false, link_flair_text: null,
  thumbnail: 'self', ...data } });

describe('tweetUrl', () => {
  it('recognizes x.com and twitter.com status links', () => {
    expect(tweetUrl('https://x.com/ShamsCharania/status/1847000000000000000?s=46')).toEqual({ id: '1847000000000000000', embedUrl: 'https://twitter.com/ShamsCharania/status/1847000000000000000' });
    expect(tweetUrl('https://mobile.twitter.com/LAClippers/status/123')).toEqual({ id: '123', embedUrl: 'https://twitter.com/LAClippers/status/123' });
    expect(tweetUrl('https://www.espn.com/nba/story')).toBeNull();
  });
});

describe('redditToItems', () => {
  it('maps hot posts and turns tweet links into tweet items', () => {
    const items = redditToItems({ data: { children: [
      post({}),
      post({ id: 'def', title: '[Shams] Clippers sign ...', url: 'https://x.com/ShamsCharania/status/999', score: 2400,
             preview: { images: [{ source: { url: 'https://preview.redd.it/p.jpg' } }] } }),
    ] } });
    expect(items[0]).toMatchObject({
      kind: 'reddit', source: 'r/LAClippers', dedupKey: 'reddit:abc', title: 'Kawhi drops 41', author: 'fan1',
      url: 'https://www.reddit.com/r/LAClippers/comments/abc/kawhi_drops_41/', engagement: 812, comments: 140,
      publishedAt: new Date(1792468800 * 1000).toISOString(), embedUrl: null, thumbnailUrl: null,
    });
    expect(items[1]).toMatchObject({ kind: 'tweet', dedupKey: 'tweet:999', embedUrl: 'https://twitter.com/ShamsCharania/status/999', thumbnailUrl: 'https://preview.redd.it/p.jpg' });
  });
  it('drops stickied, NSFW and game-thread posts', () => {
    const items = redditToItems({ data: { children: [
      post({ id: '1', stickied: true }),
      post({ id: '2', over_18: true }),
      post({ id: '3', title: 'GAME THREAD: Clippers vs Nuggets' }),
      post({ id: '4', link_flair_text: 'Post Game Thread' }),
      post({ id: '5' }),
    ] } });
    expect(items.map((i) => i.dedupKey)).toEqual(['reddit:5']);
  });
  it('returns nothing for an unexpected payload', () => {
    expect(redditToItems({ error: 403 })).toEqual([]);
  });
});
