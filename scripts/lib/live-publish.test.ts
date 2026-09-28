import { afterEach, describe, expect, it, vi } from 'vitest';
import * as protocol from '../../src/lib/live/protocol';
import type { LiveMessage } from '../../src/lib/live/protocol';
import { createPublisher, hubPublisherFromEnv, saveThenPublish, type Publisher } from './live-publish';
import { liveDoc } from './live-fixtures';

/** A post() that resolves/rejects only when the test tells it to. */
function deferredPost() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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

  it('is single-flight and latest-wins: a doc queued behind an in-flight post is superseded by a newer one', async () => {
    const sent: LiveMessage[] = [];
    const first = deferredPost();
    const post = vi.fn((m: LiveMessage) => {
      sent.push(m);
      return sent.length === 1 ? first.promise : Promise.resolve();
    });
    const p = createPublisher({ post, now: () => 0 });

    const p1 = p.publish(liveDoc(1));           // dispatched immediately; in flight
    const p2 = p.publish(liveDoc(2, { home_score: 4 })); // queued
    const p3 = p.publish(liveDoc(3, { home_score: 6 })); // supersedes doc2 in the queue

    expect(await p2).toBe(false); // superseded before it was ever sent
    expect(post).toHaveBeenCalledTimes(1); // doc2 was never posted at all

    first.resolve();
    expect(await p1).toBe(true);
    expect(await p3).toBe(true);

    expect(post).toHaveBeenCalledTimes(2); // exactly one more post, for doc3
    expect(sent[1]).toMatchObject({ kind: 'delta', seq: 3, base_seq: 1, patch: { home_score: 6 } });
  });

  it('sends the queued doc as a keyframe after a failed in-flight post', async () => {
    const sent: LiveMessage[] = [];
    const first = deferredPost();
    const post = vi.fn((m: LiveMessage) => {
      sent.push(m);
      return sent.length === 1 ? first.promise : Promise.resolve();
    });
    const p = createPublisher({ post, now: () => 0 });

    const p1 = p.publish(liveDoc(1));
    const p2 = p.publish(liveDoc(2, { home_score: 4 }));

    first.reject(new Error('hub 503'));
    expect(await p1).toBe(false);
    expect(await p2).toBe(true);

    expect(sent.map((m) => m.kind)).toEqual(['keyframe', 'keyframe']);
  });

  it('flush() resolves only once nothing is in flight or queued', async () => {
    const first = deferredPost();
    const second = deferredPost();
    let call = 0;
    const post = vi.fn(() => (call++ === 0 ? first.promise : second.promise));
    const p = createPublisher({ post, now: () => 0 });

    void p.publish(liveDoc(1));
    void p.publish(liveDoc(2)); // queued; will be dispatched once doc1 settles

    let flushed = false;
    const flushPromise = p.flush().then(() => { flushed = true; });

    await Promise.resolve();
    expect(flushed).toBe(false);

    first.resolve();
    await first.promise.then(() => {}); // let the success handler run and advance() redispatch
    await Promise.resolve();
    await Promise.resolve();
    expect(flushed).toBe(false); // second post is now in flight

    second.resolve();
    await flushPromise;
    expect(flushed).toBe(true);
  });

  it('treats a throw while building the message like a failed post — never wedges', async () => {
    const sent: LiveMessage[] = [];
    const post = vi.fn(async (m: LiveMessage) => { sent.push(m); });
    const p = createPublisher({ post, now: () => 0 });

    await p.publish(liveDoc(1)); // establishes `last`, so the next publish would be a delta

    const diffSpy = vi.spyOn(protocol, 'diffDocs').mockImplementationOnce(() => {
      throw new Error('boom building the delta');
    });
    expect(await p.publish(liveDoc(2))).toBe(false); // construction threw → treated as a failed post
    diffSpy.mockRestore();
    expect(post).toHaveBeenCalledTimes(1); // doc2 never reached o.post at all

    // The failure reset `last`, so the next publish resynchronizes with a keyframe.
    expect(await p.publish(liveDoc(3))).toBe(true);
    expect(sent.map((m) => m.kind)).toEqual(['keyframe', 'keyframe']);

    // Nothing left in flight or queued after a construction-time throw.
    await expect(p.flush()).resolves.toBeUndefined();
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
    const pub: Publisher = { publish: vi.fn(async () => false), flush: vi.fn(async () => {}) };
    await expect(saveThenPublish(liveDoc(1), async () => true, pub)).resolves.toBeUndefined();
    await expect(saveThenPublish(liveDoc(1), async () => { throw new Error('db down'); }, pub)).rejects.toThrow('db down');
    await expect(saveThenPublish(liveDoc(1), async () => true, null)).resolves.toBeUndefined();
    expect(pub.publish).toHaveBeenCalledTimes(2);
  });

  it('resolves while the hub publish is still pending — never waits on it', async () => {
    let publishSettled = false;
    let resolvePublish!: (ok: boolean) => void;
    const pub: Publisher = {
      publish: vi.fn(() => new Promise<boolean>((resolve) => {
        resolvePublish = (ok) => { publishSettled = true; resolve(ok); };
      })),
      flush: vi.fn(async () => {}),
    };

    await expect(saveThenPublish(liveDoc(1), async () => true, pub)).resolves.toBeUndefined();

    expect(pub.publish).toHaveBeenCalledTimes(1);
    expect(publishSettled).toBe(false); // the save resolved without waiting on the still-pending publish

    resolvePublish(true); // avoid leaving a dangling unresolved promise for the test runner
  });
});
