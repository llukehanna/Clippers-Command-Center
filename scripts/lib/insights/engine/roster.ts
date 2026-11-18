// scripts/lib/insights/engine/roster.ts
// The synced Clippers roster (app_kv 'roster:LAC') as a guard for the box-score
// roster when league-wide box scores are incomplete. DB-free.
import { addDays, laToday } from './dates.js';
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

/** Parses app_kv 'roster:LAC' (scripts/sync-roster.ts); a JSON-string value is decoded first. Null when unusable. */
export function parseRosterSnapshot(value: unknown): RosterSnapshot | null {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!v || typeof v !== 'object') return null;
  const { synced_at: syncedAt, players } = v as { synced_at?: unknown; players?: unknown };
  if (typeof syncedAt !== 'string' || !Array.isArray(players)) return null;
  const synced = new Date(syncedAt);
  if (Number.isNaN(synced.getTime())) return null;
  const ids = players.map((p) => (p as { player_id?: unknown } | null)?.player_id);
  if (ids.length === 0 || !ids.every((id): id is string => typeof id === 'string')) return null;
  return { syncedDate: laToday(synced), playerIds: new Set(ids) };
}

/** Why a snapshot can't guard the roster, for the post-game log; null when usable. */
export function snapshotProblem(snapshot: RosterSnapshot | null, asOf: string): string | null {
  if (!snapshot) return 'missing or unreadable';
  if (snapshotUsable(snapshot, asOf)) return null;
  return snapshot.syncedDate < asOf ? `stale (synced ${snapshot.syncedDate})` : `from the future (synced ${snapshot.syncedDate})`;
}
