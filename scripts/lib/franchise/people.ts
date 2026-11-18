// scripts/lib/franchise/people.ts
// People crosswalk: Basketball-Reference roster rows <-> the balldontlie-keyed `players` table,
// plus resolution of source person refs (ids or bare names) to a stable person key.
import { normalizePersonName } from '../player-match.js';
import type { RosterRow } from './bbref-tables.js';
import type { PersonRef } from './types.js';

export interface DbPlayer { player_id: string; nba_person_id: number | null; display_name: string; birthdate: string | Date | null }
export interface PersonRow {
  personKey: string;
  kind: 'player' | 'coach' | 'executive';
  displayName: string;
  birthdate: string | null;
  nbaPersonId: number | null;
  playerId: string | null;
}
export interface PeopleIndex {
  byBbref: Map<string, PersonRow>;
  byNbaId: Map<number, PersonRow>;
  /** nbaPersonIds held by more than one person: unresolvable rather than last-wins. */
  ambiguousNbaIds: Set<number>;
  /** Keyed by the season's START year (2017 = 2017-18). */
  rosterBySeason: Map<number, RosterRow[]>;
  /** Normalized name -> people. */
  allByName: Map<string, PersonRow[]>;
}

/** Postgres may hand back a Date; compare on the YYYY-MM-DD prefix. */
function ymd(b: string | Date | null | undefined): string | null {
  if (b == null) return null;
  if (b instanceof Date) return Number.isNaN(b.getTime()) ? null : b.toISOString().slice(0, 10);
  return b.slice(0, 10) || null;
}

type Verdict = { kind: 'match'; player: DbPlayer } | { kind: 'ambiguous' } | { kind: 'none' };

function judge(r: RosterRow, byName: Map<string, DbPlayer[]>): Verdict {
  const cands = byName.get(normalizePersonName(r.name)) ?? [];
  if (cands.length === 0) return { kind: 'none' };
  if (r.birthdate) {
    const exact = cands.filter((c) => ymd(c.birthdate) === r.birthdate);
    if (exact.length === 1) return { kind: 'match', player: exact[0] };
    if (exact.length > 1) return { kind: 'ambiguous' };
  }
  // No exact birthdate hit: only candidates lacking a birthdate (or a roster row lacking one) can still match,
  // and then only when the name is unique among players.
  const undated = cands.filter((c) => ymd(c.birthdate) == null || r.birthdate == null);
  if (undated.length === 0) return { kind: 'none' };
  if (cands.length === 1) return { kind: 'match', player: cands[0] };
  return { kind: 'ambiguous' };
}

/** One PersonRow per distinct bbrefId; unmatched and ambiguous rows are reported AND still returned as people (ids null). */
export function matchPeople(roster: RosterRow[], db: DbPlayer[]): { people: PersonRow[]; unmatched: RosterRow[]; ambiguous: RosterRow[] } {
  const byName = new Map<string, DbPlayer[]>();
  for (const p of db) {
    const k = normalizePersonName(p.display_name);
    if (!k) continue;
    (byName.get(k) ?? byName.set(k, []).get(k)!).push(p);
  }
  const merged = new Map<string, RosterRow>();
  for (const r of roster) {
    const prev = merged.get(r.bbrefId);
    merged.set(r.bbrefId, prev ? { ...prev, birthdate: prev.birthdate ?? r.birthdate } : r);
  }
  const verdicts = [...merged.values()].map((r) => ({ r, v: judge(r, byName) }));
  // A db player claimed by more than one bbrefId can't be told apart: demote every claimant to ambiguous.
  const claims = new Map<string, number>();
  for (const { v } of verdicts) if (v.kind === 'match') claims.set(v.player.player_id, (claims.get(v.player.player_id) ?? 0) + 1);
  const people: PersonRow[] = [];
  const unmatched: RosterRow[] = [];
  const ambiguous: RosterRow[] = [];
  for (const { r, v } of verdicts) {
    let m: DbPlayer | null = null;
    if (v.kind === 'match' && (claims.get(v.player.player_id) ?? 0) > 1) ambiguous.push(r);
    else if (v.kind === 'match') m = v.player;
    else if (v.kind === 'ambiguous') ambiguous.push(r);
    else unmatched.push(r);
    people.push({
      personKey: r.bbrefId,
      kind: 'player',
      displayName: r.name,
      birthdate: r.birthdate ?? ymd(m?.birthdate),
      nbaPersonId: m?.nba_person_id ?? null,
      playerId: m?.player_id ?? null,
    });
  }
  return { people, unmatched, ambiguous };
}

export function buildIndex(people: PersonRow[], rosterBySeason: Map<number, RosterRow[]>): PeopleIndex {
  const byBbref = new Map<string, PersonRow>();
  const byNbaId = new Map<number, PersonRow>();
  const ambiguousNbaIds = new Set<number>();
  const allByName = new Map<string, PersonRow[]>();
  for (const p of people) {
    byBbref.set(p.personKey, p);
    if (p.nbaPersonId != null) {
      if (byNbaId.has(p.nbaPersonId)) ambiguousNbaIds.add(p.nbaPersonId);
      byNbaId.set(p.nbaPersonId, p);
    }
    const k = normalizePersonName(p.displayName);
    if (k) (allByName.get(k) ?? allByName.set(k, []).get(k)!).push(p);
  }
  return { byBbref, byNbaId, ambiguousNbaIds, rosterBySeason, allByName };
}

function uniqueKey(keys: Set<string>): string | null | undefined {
  if (keys.size === 0) return undefined; // nothing here, try the next tier
  return keys.size === 1 ? [...keys][0] : null; // several -> ambiguous, stop
}

function rosterKeys(index: PeopleIndex, seasons: number[], name: string): Set<string> {
  const out = new Set<string>();
  for (const s of seasons) {
    for (const r of index.rosterBySeason.get(s) ?? []) if (normalizePersonName(r.name) === name) out.add(r.bbrefId);
  }
  return out;
}

/** Person key for a source ref, or null when it can't be resolved uniquely. Never guesses. */
export function resolveRef(ref: PersonRef, index: PeopleIndex, seasonId: number): string | null {
  // personKey() uses the bbrefId / `nba:<id>` itself as the key, so an id absent from the index still resolves.
  if (ref.bbrefId) return index.byBbref.get(ref.bbrefId)?.personKey ?? ref.bbrefId;
  if (ref.nbaPersonId != null) {
    if (index.ambiguousNbaIds.has(ref.nbaPersonId)) return null;
    return index.byNbaId.get(ref.nbaPersonId)?.personKey ?? `nba:${ref.nbaPersonId}`;
  }
  const name = normalizePersonName(ref.name);
  if (!name) return null;
  const tiers = [
    rosterKeys(index, [seasonId], name),
    rosterKeys(index, [seasonId - 1, seasonId + 1], name),
    new Set((index.allByName.get(name) ?? []).map((p) => p.personKey)),
  ];
  for (const t of tiers) {
    const u = uniqueKey(t);
    if (u !== undefined) return u;
  }
  return null;
}
