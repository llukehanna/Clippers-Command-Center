// src/lib/insights/compose.ts
// Per-placement feeds from active insights (spec §2.7): diversity caps, one
// team item when it earns it, and same-player-same-game merges. Computed at
// request time (a few dozen rows per surface), never stored. Pure.
import type { Frame, SalienceClass, Surface } from './types';

export type Placement = 'home_hero' | 'last_game' | 'up_next' | 'season_feed' | 'game_page' | 'player_page' | 'live';

export const FEED_SIZES: Record<Placement, number> = {
  home_hero: 1, last_game: 3, up_next: 3, season_feed: 12, game_page: 8, player_page: 6, live: Number.POSITIVE_INFINITY,
};

export const PLACEMENT_SURFACES: Record<Placement, readonly Surface[]> = {
  home_hero: ['postgame', 'pregame', 'season'],
  last_game: ['postgame'],
  up_next: ['pregame'],
  season_feed: ['season'],
  game_page: ['postgame'],
  player_page: ['player'],
  live: ['live'],
};

export const MAX_PER_PLAYER = 2;
export const MAX_PER_CATEGORY = 2;
export const TEAM_MIN_IMPORTANCE = 40;
export const TEAM_RULE_MIN_SIZE = 3;

export interface ComposableInsight {
  insight_id: string;
  surface: Surface;
  category: string;
  importance: number;
  headline: string;
  detail: string | null;
  game_id: string | null;
  player_id: string | null;
  frame: Pick<Frame, 'type' | 'strength' | 'text'> | null;
  score_parts: { salience_class?: SalienceClass } | null;
}

export interface ComposedInsight extends ComposableInsight {
  /** Insights folded into this one (their context lines are listed in `detail`). */
  merged_ids: string[];
}

const byImportance = (a: ComposableInsight, b: ComposableInsight) =>
  b.importance - a.importance || a.insight_id.localeCompare(b.insight_id);

/** The merge leader is the stronger frame (spec §2.7), with importance as the tiebreak. */
const byLeadership = (a: ComposableInsight, b: ComposableInsight) =>
  (b.frame?.strength ?? 0) - (a.frame?.strength ?? 0) || byImportance(a, b);

/**
 * Two postgame items about the same player in the same game become one. The
 * leader (stronger frame, then importance) keeps its fields; the follower's
 * context line is appended with " · " and its id goes in `merged_ids`.
 */
export function mergeSameGamePlayer(items: ComposableInsight[]): ComposedInsight[] {
  const out: ComposedInsight[] = [];
  const primaries = new Map<string, ComposedInsight>();
  for (const it of [...items].sort(byLeadership)) {
    const key = it.surface === 'postgame' && it.player_id && it.game_id ? `${it.game_id}:${it.player_id}` : null;
    const primary = key ? primaries.get(key) : undefined;
    if (primary && primary.merged_ids.length === 0) {
      primary.detail = [primary.detail, it.detail].filter(Boolean).join(' · ') || null;
      primary.merged_ids.push(it.insight_id);
      continue;
    }
    const copy: ComposedInsight = { ...it, merged_ids: [] };
    if (key && !primary) primaries.set(key, copy);
    out.push(copy);
  }
  return out.sort(byImportance);
}

export function composeFeed(items: ComposableInsight[], placement: Placement): ComposedInsight[] {
  const surfaces = PLACEMENT_SURFACES[placement];
  const eligible = items.filter((i) =>
    surfaces.includes(i.surface) && (placement === 'game_page' || i.score_parts?.salience_class !== 'former'));
  const ranked = placement === 'last_game' || placement === 'game_page'
    ? mergeSameGamePlayer(eligible)
    : eligible.map((i) => ({ ...i, merged_ids: [] })).sort(byImportance);
  if (placement === 'live') return ranked;

  const size = FEED_SIZES[placement];
  const count = (list: ComposedInsight[], pred: (c: ComposedInsight) => boolean) => list.filter(pred).length;
  const picked: ComposedInsight[] = [];
  for (const it of ranked) {
    if (picked.length >= size) break;
    if (it.player_id && count(picked, (p) => p.player_id === it.player_id) >= MAX_PER_PLAYER) continue;
    if (count(picked, (p) => p.category === it.category) >= MAX_PER_CATEGORY) continue;
    picked.push(it);
  }

  if (size >= TEAM_RULE_MIN_SIZE && picked.length > 0 && !picked.some((p) => !p.player_id)) {
    const keep = picked.length >= size ? picked.slice(0, -1) : picked;
    const team = ranked.find((i) => !i.player_id && i.importance > TEAM_MIN_IMPORTANCE && !picked.includes(i)
      && count(keep, (p) => p.category === i.category) < MAX_PER_CATEGORY);
    if (team) return [...keep, team].sort(byImportance);
  }
  return picked;
}
