// src/lib/live/protocol.ts
// Live v2 wire protocol (spec §4): the runner publishes a full keyframe every
// 30 s and deltas in between; the hub relays them; clients rebuild state with
// applyMessage. A delta applies only on top of the exact state it was diffed
// from (base_seq), so a lost message costs one keyframe resync, never a wrong
// score. Pure — shared by scripts/ (publisher) and the browser (hook).

import type { BoxscorePlayer, BoxscoreTeam } from '../types/live';
import type { LiveStateDoc } from '../types/live-state';

/** A changed box score team: header/statistics whole, player rows only if changed. */
export interface TeamPatch {
  team: Omit<BoxscoreTeam, 'players'>;
  players: BoxscorePlayer[];
  /** true → `players` is the complete list (a player disappeared). */
  replace?: true;
}

export interface KeyframeMessage {
  kind: 'keyframe';
  seq: number;
  doc: LiveStateDoc;
  hub_at?: number;              // ms epoch, stamped by the hub on relay
}

export interface DeltaMessage {
  kind: 'delta';
  seq: number;
  base_seq: number;
  patch: Partial<Omit<LiveStateDoc, 'seq' | 'home_box' | 'away_box'>>;
  /** Key present → that box changed; null → it became null. */
  box?: { home?: TeamPatch | null; away?: TeamPatch | null };
  hub_at?: number;
}

export type LiveMessage = KeyframeMessage | DeltaMessage;

export interface ApplyResult {
  state: LiveStateDoc | null;
  applied: boolean;
  needKeyframe: boolean;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function diffTeam(prev: BoxscoreTeam | null, next: BoxscoreTeam | null): TeamPatch | null | undefined {
  if (next === null) return prev === null ? undefined : null;
  const { players, ...team } = next;
  if (!prev) return { team, players };
  const { players: prevPlayers, ...prevTeam } = prev;
  const nextIds = new Set(players.map((p) => p.personId));
  if (prevPlayers.some((p) => !nextIds.has(p.personId))) return { team, players, replace: true };
  const prevRows = new Map(prevPlayers.map((p) => [p.personId, JSON.stringify(p)]));
  const changed = players.filter((p) => prevRows.get(p.personId) !== JSON.stringify(p));
  if (changed.length === 0 && same(prevTeam, team)) return undefined;
  return { team, players: changed };
}

export function diffDocs(prev: LiveStateDoc, next: LiveStateDoc): DeltaMessage {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof LiveStateDoc)[]) {
    if (key === 'seq' || key === 'home_box' || key === 'away_box') continue;
    if (!same(prev[key], next[key])) patch[key] = next[key];
  }
  const box: NonNullable<DeltaMessage['box']> = {};
  const home = diffTeam(prev.home_box, next.home_box);
  if (home !== undefined) box.home = home;
  const away = diffTeam(prev.away_box, next.away_box);
  if (away !== undefined) box.away = away;
  return {
    kind: 'delta',
    seq: next.seq,
    base_seq: prev.seq,
    patch: patch as DeltaMessage['patch'],
    ...(Object.keys(box).length > 0 ? { box } : {}),
  };
}

function applyTeam(prev: BoxscoreTeam | null, patch: TeamPatch | null): BoxscoreTeam | null {
  if (patch === null) return null;
  if (patch.replace || !prev) return { ...patch.team, players: patch.players };
  const byId = new Map(patch.players.map((p) => [p.personId, p]));
  const players = prev.players.map((p) => byId.get(p.personId) ?? p);
  const known = new Set(prev.players.map((p) => p.personId));
  for (const p of patch.players) if (!known.has(p.personId)) players.push(p);
  return { ...patch.team, players };
}

export function applyMessage(state: LiveStateDoc | null, msg: LiveMessage): ApplyResult {
  if (msg.kind === 'keyframe') {
    const fresher = !state || msg.seq > state.seq || Date.parse(msg.doc.fetched_at) > Date.parse(state.fetched_at);
    return fresher
      ? { state: msg.doc, applied: true, needKeyframe: false }
      : { state, applied: false, needKeyframe: false };
  }
  if (!state) return { state, applied: false, needKeyframe: true };
  if (msg.seq <= state.seq) return { state, applied: false, needKeyframe: false };
  if (msg.base_seq !== state.seq) return { state, applied: false, needKeyframe: true };
  const next = { ...state, ...msg.patch, seq: msg.seq } as LiveStateDoc;
  if (msg.box && 'home' in msg.box) next.home_box = applyTeam(state.home_box, msg.box.home ?? null);
  if (msg.box && 'away' in msg.box) next.away_box = applyTeam(state.away_box, msg.box.away ?? null);
  return { state: next, applied: true, needKeyframe: false };
}
