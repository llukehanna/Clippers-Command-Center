// scripts/lib/insights/engine/keys.ts
// Stable identity of a claim (stored in insights.proof_hash; ON CONFLICT key).
// Includes the surface (spec §2.8) and never a value that changes nightly.
import crypto from 'crypto';
import type { Fact } from './types.js';

export function factKey(f: Fact): string {
  const raw = [
    'insight-v3', f.surface, f.kind, f.subject.type, f.subject.id, f.stat, f.window.type,
    f.window.game_id ?? '', f.window.period ?? '', f.window.season_id ?? '', f.window.n ?? '', f.keyExtra ?? '',
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** hash(dedup_key) mod n (spec §2.5): a claim keeps its wording across runs. */
export function phrasingIndex(key: string, n: number): number {
  return n <= 1 ? 0 : parseInt(key.slice(0, 8), 16) % n;
}
