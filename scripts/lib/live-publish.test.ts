import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveMessage } from '../../src/lib/live/protocol';
import { createPublisher, hubPublisherFromEnv, saveThenPublish } from './live-publish';
import { liveDoc } from './live-fixtures';

describe('createPublisher', () => {
  it('sends a keyframe first, deltas within 30 s, and a keyframe again after 30 s', async () => {
    let t = 0;
    const sent: LiveMessage[] = [];
    const p = createPublisher({ post: async (m) => { sent.push(m); }, now: () => t });
    await p.publish(liveDoc(1));
    t += 3_000;
    await p.publish(liveDoc(2, { home_score: 4 }));
    t += 30_000;
    await p.publish(liveDoc(3, { home_score: 6 }));
    expect(sent.map((m) => m.kind)).toEqual(['keyframe', 'delta', 'keyframe']);
    expect(sent[1]).toMatchObject({ seq: 2, base_seq: 1, patch: { home_score: 4 } });
  });

  it('never throws; after a failed post the next message is a keyframe', async () => {
    const sent: LiveMessage[] = [];
    const post = vi.fn(async (m: LiveMessage) => { sent.push(m); })
      .mockImplementationOnce(async () => {})               // keyframe ok
      .mockImplementationOnce(async () => { throw new Error('hub 503'); });
    const p = createPublisher({ post, now: () => 0 });
    expect(await p.publish(liveDoc(1))).toBe(true);
    expect(await p.publish(liveDoc(2))).toBe(false);
    expect(await p.publish(liveDoc(3))).toBe(true);
    expect(sent.at(-1)?.kind).toBe('keyframe');
  });
});

describe('hubPublisherFromEnv', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is null without both env vars', () => {
    expect(hubPublisherFromEnv('0022600093', {})).toBeNull();
    expect(hubPublisherFromEnv('0022600093', { LIVE_HUB_URL: 'https://hub' })).toBeNull();
  });

  it('POSTs messages to /publish/:gameId with the bearer secret', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const p = hubPublisherFromEnv('0022600093', { LIVE_HUB_URL: 'https://hub/', LIVE_HUB_SECRET: 's3cret' })!;
    expect(await p.publish(liveDoc(1))).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://hub/publish/0022600093');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer s3cret');
    expect(JSON.parse(init.body as string)).toMatchObject({ kind: 'keyframe', seq: 1 });
  });

  it('treats a non-2xx hub response as a failed publish', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 401 })));
    const p = hubPublisherFromEnv('1', { LIVE_HUB_URL: 'https://hub', LIVE_HUB_SECRET: 'x' })!;
    expect(await p.publish(liveDoc(1))).toBe(false);
  });
});

describe('saveThenPublish', () => {
  it('fails only when the database save fails', async () => {
    const pub = { publish: vi.fn(async () => false) };
    await expect(saveThenPublish(liveDoc(1), async () => true, pub)).resolves.toBeUndefined();
    await expect(saveThenPublish(liveDoc(1), async () => { throw new Error('db down'); }, pub)).rejects.toThrow('db down');
    await expect(saveThenPublish(liveDoc(1), async () => true, null)).resolves.toBeUndefined();
    expect(pub.publish).toHaveBeenCalledTimes(2);
  });
});
