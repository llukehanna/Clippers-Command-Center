import { describe, it, expect, afterEach, vi } from 'vitest';
import { blueskyToItems, fetchBlueskyTop } from './bluesky';

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

describe('fetchBlueskyTop', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a session with the credentials, then searches with the bearer token', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://bsky.social/xrpc/com.atproto.server.createSession') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(init?.body as string)).toEqual({ identifier: 'clippers.bsky.social', password: 'app-pass-123' });
        return new Response(JSON.stringify({ accessJwt: 'jwt-abc' }), { status: 200 });
      }
      if (url.startsWith('https://bsky.social/xrpc/app.bsky.feed.searchPosts')) {
        expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer jwt-abc');
        expect(url).toContain('q=clippers');
        return new Response(JSON.stringify({ posts: [] }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchBlueskyTop({ handle: 'clippers.bsky.social', appPassword: 'app-pass-123' }, new Date('2026-10-21T00:00:00.000Z'));

    expect(result).toEqual({ posts: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws when the session request is not OK', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const err = await fetchBlueskyTop({ handle: 'clippers.bsky.social', appPassword: 'bad-secret' }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('bluesky session HTTP 401 — check BSKY_HANDLE / BSKY_APP_PASSWORD');
    expect((err as Error).message).not.toContain('clippers.bsky.social');
    expect((err as Error).message).not.toContain('bad-secret');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
