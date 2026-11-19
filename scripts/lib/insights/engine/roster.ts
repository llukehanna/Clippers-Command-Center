// scripts/lib/insights/engine/roster.ts
// The synced Clippers roster (app_kv 'roster:LAC') as a guard for the box-score
// roster when league-wide box scores are incomplete or the stats season lags the current one. DB-free.
import { currentSeasonId, seasonLabel } from '../../schedule-utils.js';
import { addDays, laToday } from './dates.js';
import type { RosterPlayer } from './types.js';

export interface RosterSnapshot { syncedDate: string; playerIds: Set<string> }

/** Usable when synced (LA date) within asOf − 3 days … asOf + 1 day; otherwise stale or from after the as-of date. */
export function snapshotUsable(snapshot: RosterSnapshot | null, asOf: string): boolean {
  if (!snapshot) return false;
  return snapshot.syncedDate >= addDays(asOf, -3) && snapshot.syncedDate <= addDays(asOf, 1);
}

/**
 * Why the box-score roster needs the synced-roster guard; null when it doesn't. Two reasons: league box scores are
 * incomplete (a traded player still looks like a Clipper), or the stats season lags the current one (a new season's
 * first games, before MIN_SEASON_GAMES: the roster comes from last season's box scores, so offseason departures remain).
 */
export function rosterGuardReason(leagueComplete: boolean, statsSeasonId: number, asOf: string): string | null {
  const reasons: string[] = [];
  if (!leagueComplete) reasons.push('league data is incomplete');
  const current = currentSeasonId(new Date(`${asOf}T12:00:00Z`));
  if (statsSeasonId < current) reasons.push(`the stats season ${seasonLabel(statsSeasonId)} lags the current season ${seasonLabel(current)}`);
  return reasons.length ? reasons.join(' and ') : null;
}

export const MIN_SNAPSHOT_KEPT = 8;

/** Intersects the box-score roster with a usable snapshot; never adds players. Unchanged when `snapshotProblem` finds one. */
export function applyRosterSnapshot(
  roster: Map<string, RosterPlayer>, snapshot: RosterSnapshot | null, asOf: string,
): Map<string, RosterPlayer> {
  if (!snapshot || snapshotProblem(snapshot, asOf, roster)) return roster;
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

/**
 * Why a snapshot can't guard the roster, for the post-game log; null when usable. With the box-score `roster`, a
 * snapshot that would keep fewer than 8 players, or under half of them, is a truncated sync: too small to trust.
 */
export function snapshotProblem(snapshot: RosterSnapshot | null, asOf: string, roster?: Map<string, RosterPlayer>): string | null {
  if (!snapshot) return 'missing or unreadable';
  if (!snapshotUsable(snapshot, asOf)) {
    return snapshot.syncedDate < asOf ? `stale (synced ${snapshot.syncedDate})` : `from the future (synced ${snapshot.syncedDate})`;
  }
  if (roster) {
    const kept = [...roster.keys()].filter((id) => snapshot.playerIds.has(id)).length;
    if (kept < MIN_SNAPSHOT_KEPT || kept * 2 < roster.size) return `too small (kept ${kept} of ${roster.size})`;
  }
  return null;
}
