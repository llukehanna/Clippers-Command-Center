// scripts/lib/live-publish.ts
// Publishes the runner's live state to the Cloudflare live hub (spec §6.1):
// a keyframe every 30 s (and after any failed post), deltas in between.
// Publishing is best-effort — the database write is the source of truth and
// /api/live keeps working without the hub.
//
// The publisher is single-flight and latest-wins: at most one post is ever in
// flight. A publish() that arrives mid-flight replaces any earlier queued doc
// rather than piling up requests — a hub outage must never make the poller's
// own tick cadence wait on PUBLISH_TIMEOUT_MS (saveThenPublish doesn't await
// publish() either, for the same reason).

import type { LiveStateDoc } from '../../src/lib/types/live-state';
import { diffDocs, type LiveMessage } from '../../src/lib/live/protocol';

export const KEYFRAME_EVERY_MS = 30_000;
const PUBLISH_TIMEOUT_MS = 3_000;

export interface Publisher {
  publish(doc: LiveStateDoc): Promise<boolean>;
  /** Resolves once nothing is in flight or queued. For callers about to exit. */
  flush(): Promise<void>;
}

export function createPublisher(o: {
  post(msg: LiveMessage): Promise<void>;
  now(): number;
  keyframeEveryMs?: number;
  log?(msg: string): void;
}): Publisher {
  let last: LiveStateDoc | null = null;
  let lastKeyframeAt = Number.NEGATIVE_INFINITY;
  const every = o.keyframeEveryMs ?? KEYFRAME_EVERY_MS;

  let inFlight = false;
  let pending: { doc: LiveStateDoc; resolve: (ok: boolean) => void } | null = null;
  let idleWaiters: Array<() => void> = [];

  function notifyIdle(): void {
    if (inFlight || pending) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const w of waiters) w();
  }

  function dispatch(doc: LiveStateDoc, resolve: (ok: boolean) => void): void {
    inFlight = true;
    let now: number;
    let keyframe: boolean;
    let msg: LiveMessage;
    try {
      now = o.now();
      keyframe = last === null || now - lastKeyframeAt >= every;
      msg = keyframe ? { kind: 'keyframe', seq: doc.seq, doc } : diffDocs(last!, doc);
    } catch (err) {
      // A throw building the message (e.g. an unserializable doc reaching
      // diffDocs) must not wedge the publisher forever — treat it exactly
      // like a failed post so the next publish resynchronizes with a keyframe.
      o.log?.(`hub publish failed (seq ${doc.seq}): ${(err as Error).message}`);
      last = null;
      inFlight = false;
      resolve(false);
      advance();
      return;
    }
    o.post(msg).then(
      () => {
        last = doc;
        if (keyframe) lastKeyframeAt = now;
        inFlight = false;
        resolve(true);
        advance();
      },
      (err: unknown) => {
        o.log?.(`hub publish failed (seq ${doc.seq}): ${(err as Error).message}`);
        last = null; // the next publish resynchronizes everyone with a keyframe
        inFlight = false;
        resolve(false);
        advance();
      }
    );
  }

  function advance(): void {
    if (pending) {
      const next = pending;
      pending = null;
      dispatch(next.doc, next.resolve);
    } else {
      notifyIdle();
    }
  }

  return {
    publish(doc) {
      return new Promise<boolean>((resolve) => {
        if (!inFlight) {
          dispatch(doc, resolve);
        } else {
          // A doc already queued behind the in-flight post is superseded —
          // its own state is stale the moment a newer one shows up.
          pending?.resolve(false);
          pending = { doc, resolve };
        }
      });
    },
    flush() {
      if (!inFlight && !pending) return Promise.resolve();
      return new Promise<void>((resolve) => {
        idleWaiters.push(resolve);
      });
    },
  };
}

export function httpPost(hubUrl: string, secret: string, nbaGameId: string, timeoutMs = PUBLISH_TIMEOUT_MS) {
  const url = `${hubUrl.replace(/\/+$/, '')}/publish/${nbaGameId}`;
  return async (msg: LiveMessage): Promise<void> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`hub ${res.status}`);
  };
}

/** A publisher for this game when LIVE_HUB_URL and LIVE_HUB_SECRET are set, else null. */
export function hubPublisherFromEnv(nbaGameId: string, env: Partial<NodeJS.ProcessEnv> = process.env): Publisher | null {
  const url = env.LIVE_HUB_URL;
  const secret = env.LIVE_HUB_SECRET;
  if (!url || !secret) return null;
  return createPublisher({
    post: httpPost(url, secret, nbaGameId),
    now: Date.now,
    log: (m) => console.log(`[live] ${m}`),
  });
}

/**
 * Save to the database; kick off (but don't wait on) the hub publish. Only a
 * failed save is an error — a slow or down hub must never add to tick latency.
 */
export async function saveThenPublish(
  doc: LiveStateDoc,
  save: (doc: LiveStateDoc) => Promise<unknown>,
  publisher: Publisher | null
): Promise<void> {
  publisher?.publish(doc).catch(() => {});
  await save(doc);
}
