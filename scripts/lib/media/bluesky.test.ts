import { describe, it, expect } from 'vitest';
import { blueskyToItems } from './bluesky';

const p = (over: Record<string, unknown>) => ({
  uri: 'at://did:plc:abc/app.bsky.feed.post/3kxyz',
  author: { handle: 'lawmurray.bsky.social', displayName: 'Law Murray' },
  record: { text: 'Clippers starting five tonight: ...', createdAt: '2026-10-20T01:00:00.000Z' },
  likeCount: 40, repostCount: 5, replyCount: 3, ...over,
});

describe('blueskyToItems', () => {
  it('maps posts with a web URL and engagement', () => {
    const [item] = blueskyToItems({ posts: [p({})] });
    expect(item).toMatchObject({
      kind: 'bluesky', source: 'Bluesky', author: 'Law Murray', title: 'Clippers starting five tonight: ...',
      url: 'https://bsky.app/profile/lawmurray.bsky.social/post/3kxyz', engagement: 45, comments: 3,
      dedupKey: 'bsky:at://did:plc:abc/app.bsky.feed.post/3kxyz', publishedAt: '2026-10-20T01:00:00.000Z',
    });
  });
  it('drops low-engagement posts and posts that do not mention the Clippers', () => {
    expect(blueskyToItems({ posts: [p({ likeCount: 3 }), p({ record: { text: 'Lakers news', createdAt: '2026-10-20T01:00:00.000Z' } })] })).toEqual([]);
  });
  it('returns nothing for an unexpected payload', () => {
    expect(blueskyToItems({})).toEqual([]);
  });
});
