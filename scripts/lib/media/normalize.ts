// scripts/lib/media/normalize.ts
// De-duplication helpers. Pure.
import type { MediaItemInput } from './types.js';

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
