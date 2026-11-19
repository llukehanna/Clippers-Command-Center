// src/lib/data/season-highs.ts
// Box score tags for the game page. Pure and DB-free. Every tag is true as stated:
// grey "Season high" compares a Clippers player's box value with his final games earlier in the
// same season; blue tags come from kept postgame cards whose frame.stat and frame.value match the
// box value exactly. Blue wins when both apply.
import type { InsightCardData } from '@/src/lib/insights/card';
import { boxTagLabel } from '@/src/lib/insights/why';

export type BoxCol = 'PTS' | 'REB' | 'AST' | 'STL' | 'BLK' | '3PT';
export interface BoxTag { tone: 'rare' | 'season_high'; label: string }
export type BoxTags = Record<string, Partial<Record<BoxCol, BoxTag>>>;

type StatKey = 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'fg3m';
const STAT_COL: Record<StatKey, BoxCol> = { pts: 'PTS', reb: 'REB', ast: 'AST', stl: 'STL', blk: 'BLK', fg3m: '3PT' };
const STAT_KEYS = Object.keys(STAT_COL) as StatKey[];

/** A season high needs this many earlier games to mean anything. */
const MIN_PRIOR_GAMES = 3;

type StatLine = Record<StatKey, number | null>;
export interface SeasonHighPlayer extends StatLine { player_id: string; team_is_lac: boolean }
export interface PriorMax extends StatLine { player_id: string; games: number }

export function seasonHighTags(players: SeasonHighPlayer[], prior: PriorMax[]): BoxTags {
  const priorBy = new Map(prior.map((p) => [p.player_id, p]));
  const out: BoxTags = {};
  for (const p of players) {
    if (!p.team_is_lac) continue;
    const pr = priorBy.get(p.player_id);
    if (!pr || pr.games < MIN_PRIOR_GAMES) continue;
    for (const k of STAT_KEYS) {
      const v = p[k];
      const max = pr[k];
      if (v == null || max == null || v <= max) continue;
      (out[p.player_id] ??= {})[STAT_COL[k]] = { tone: 'season_high', label: 'Season high' };
    }
  }
  return out;
}

export function rareTags(cards: InsightCardData[], box: Map<string, Partial<Record<BoxCol, number | null>>>): BoxTags {
  const out: BoxTags = {};
  for (const c of cards) {
    const f = c.frame;
    if (!f || !c.player_id || typeof f.stat !== 'string' || typeof f.value !== 'number') continue;
    const col = STAT_COL[f.stat as StatKey];
    if (!col || !Object.prototype.hasOwnProperty.call(STAT_COL, f.stat)) continue;
    const boxVal = box.get(c.player_id)?.[col];
    if (boxVal == null || boxVal !== f.value) continue;
    const label = boxTagLabel(c);
    if (!label) continue;
    (out[c.player_id] ??= {})[col] ??= { tone: 'rare', label };
  }
  return out;
}

/** Blue replaces grey in the same cell. */
export function mergeTags(grey: BoxTags, blue: BoxTags): BoxTags {
  const out: BoxTags = {};
  for (const [id, cols] of Object.entries(grey)) out[id] = { ...cols };
  for (const [id, cols] of Object.entries(blue)) out[id] = { ...(out[id] ?? {}), ...cols };
  return out;
}
