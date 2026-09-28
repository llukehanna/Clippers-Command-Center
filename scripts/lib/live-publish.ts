// scripts/lib/live-publish.ts
// Publishes the runner's live state to the Cloudflare live hub (spec §6.1):
// a keyframe every 30 s (and after any failed post), deltas in between.
// Publishing is best-effort — the database write is the source of truth and
// /api/live keeps working without the hub.

import type { LiveStateDoc } from '../../src/lib/types/live-state';
import { diffDocs, type LiveMessage } from '../../src/lib/live/protocol';

export const KEYFRAME_EVERY_MS = 30_000;
const PUBLISH_TIMEOUT_MS = 3_000;

export interface Publisher {
  publish(doc: LiveStateDoc): Promise<boolean>;
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
  return {
    async publish(doc) {
      const now = o.now();
      const keyframe = last === null || now - lastKeyframeAt >= every;
      const msg: LiveMessage = keyframe ? { kind: 'keyframe', seq: doc.seq, doc } : diffDocs(last!, doc);
      try {
        await o.post(msg);
      } catch (err) {
        o.log?.(`hub publish failed (seq ${doc.seq}): ${(err as Error).message}`);
        last = null; // the next publish resynchronizes everyone with a keyframe
        return false;
      }
      last = doc;
      if (keyframe) lastKeyframeAt = now;
      return true;
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

/** Save to the database and publish concurrently; only a failed save is an error. */
export async function saveThenPublish(
  doc: LiveStateDoc,
  save: (doc: LiveStateDoc) => Promise<unknown>,
  publisher: Publisher | null
): Promise<void> {
  const [saved] = await Promise.allSettled([save(doc), publisher?.publish(doc)]);
  if (saved.status === 'rejected') throw saved.reason;
}
