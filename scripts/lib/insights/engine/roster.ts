// scripts/lib/insights/engine/roster.ts
// The synced Clippers roster (app_kv 'roster:LAC') as a guard for the box-score
// roster when league-wide box scores are incomplete. DB-free.
import { addDays } from './dates.js';
import type { RosterPlayer } from './types.js';

export interface RosterSnapshot { syncedDate: string; playerIds: Set<string> }

/** Usable when synced (LA date) within asOf − 3 days … asOf + 1 day; otherwise stale or from after the as-of date. */
export function snapshotUsable(snapshot: RosterSnapshot | null, asOf: string): boolean {
  if (!snapshot) return false;
  return snapshot.syncedDate >= addDays(asOf, -3) && snapshot.syncedDate <= addDays(asOf, 1);
}

/** Intersects the box-score roster with the snapshot when the league is incomplete; never adds players. */
export function applyRosterSnapshot(
  roster: Map<string, RosterPlayer>, snapshot: RosterSnapshot | null, asOf: string, leagueComplete: boolean,
): Map<string, RosterPlayer> {
  if (leagueComplete || !snapshot || !snapshotUsable(snapshot, asOf)) return roster;
  return new Map([...roster].filter(([id]) => snapshot.playerIds.has(id)));
}
