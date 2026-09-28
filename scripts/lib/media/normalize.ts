// scripts/lib/media/normalize.ts
// De-duplication, retention and URL helpers. Pure.
import type { MediaItemInput } from './types.js';

/** How long media_items keeps a story (by published_at). Re-exported by store.ts. */
export const MEDIA_RETENTION_DAYS = 7;

/** Comparable form of a headline: lowercase ASCII words. */
export function titleKey(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** One item per dedupKey; the lowest priority number wins, then the first seen. Keeps input order. */
export function dedupeItems(items: MediaItemInput[]): MediaItemInput[] {
  const best = new Map<string, MediaItemInput>();
  for (const it of items) {
    const cur = best.get(it.dedupKey);
    if (!cur || it.priority < cur.priority) best.set(it.dedupKey, it);
  }
  const order: string[] = [];
  for (const it of items) if (!order.includes(it.dedupKey)) order.push(it.dedupKey);
  return order.map((k) => best.get(k)!);
}

/**
 * Items inside the retention window: anything published before
 * now - MEDIA_RETENTION_DAYS is dropped (pruneMedia would delete it on the
 * same run), and a publishedAt in the future is clamped to now.
 */
export function inRetention(items: MediaItemInput[], now: Date = new Date()): MediaItemInput[] {
  const nowMs = now.getTime();
  const cutoff = nowMs - MEDIA_RETENTION_DAYS * 86_400_000;
  const out: MediaItemInput[] = [];
  for (const it of items) {
    const t = new Date(it.publishedAt).getTime();
    if (Number.isNaN(t) || t < cutoff) continue;
    out.push(t > nowMs ? { ...it, publishedAt: now.toISOString() } : it);
  }
  return out;
}

/** True for an absolute http: or https: URL. */
export function isHttpUrl(s: string | null): boolean {
  if (!s) return false;
  try {
    const { protocol } = new URL(s);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
