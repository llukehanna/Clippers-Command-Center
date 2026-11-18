// scripts/lib/franchise/keys.ts
// Stable keys for moves, picks, swaps and people.
import { createHash } from 'node:crypto';
import { TRICODE_BY_NBA_ID } from '../nba-teams.js';
import { normalizePersonName } from '../player-match.js';
import type { FranchiseId, MoveKind, PersonRef } from './types.js';

function tricode(id: FranchiseId): string {
  const t = TRICODE_BY_NBA_ID[id];
  if (!t) throw new Error(`unknown franchise id ${id}`);
  return t;
}

export function bbrefMoveKey(date: string, kind: MoveKind, tokens: string[]): string {
  return `bbref:${date}:${kind}:${[...tokens].sort().join('|')}`;
}

/** Uses the CURRENT franchise tricode so keys survive relocations. */
export function pickKey(year: number, round: number, original: FranchiseId): string {
  return `${year}-${round}-${tricode(original)}`;
}

export function swapKey(year: number, round: number, a: FranchiseId, b: FranchiseId): string {
  const [x, y] = [tricode(a), tricode(b)].sort();
  return `${year}-${round}-${x}-${y}`;
}

const KEY_PRIORITY = ['nba:', 'bbref:', 'wiki:', 'espn:'];

export function chooseTransactionKey(sourceKeys: string[]): string {
  for (const prefix of KEY_PRIORITY) {
    const hit = sourceKeys.find((k) => k.startsWith(prefix));
    if (hit) return hit;
  }
  if (sourceKeys.length > 0) return sourceKeys[0];
  throw new Error('chooseTransactionKey: no source keys');
}

export function tradeSlug(transactionKey: string, date: string): string {
  return `${date}-${createHash('sha1').update(transactionKey).digest('hex').slice(0, 6)}`;
}

export function personKey(p: PersonRef, draftYear?: number): string {
  if (p.bbrefId) return p.bbrefId;
  if (p.nbaPersonId != null) return `nba:${p.nbaPersonId}`;
  if (draftYear != null) {
    const n = normalizePersonName(p.name).replace(/ /g, '-');
    if (n) return `name:${n}-${draftYear}`;
  }
  throw new Error(`personKey: cannot form a key for "${p.name}" (no bbrefId, nbaPersonId or draftYear)`);
}
