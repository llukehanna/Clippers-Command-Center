// src/lib/data/season-highs.ts
// Box score tags for the game page. Pure and DB-free. Every tag is true as stated:
// grey "Season high" compares a Clippers player's box value with his final games earlier in the
// same season; blue tags come from kept postgame cards whose frame.stat and frame.value match the
// box value exactly. Blue wins when both apply.
import type { InsightCardData } from '@/src/lib/insights/card';
import { SEASON_HIGH_FLOORS } from '@/src/lib/insights/season-highs';
import { boxTagLabel } from '@/src/lib/insights/why';
import type { PlayerDetailPayload } from '@/src/lib/ui/types';

export type BoxCol = 'PTS' | 'REB' | 'AST' | 'STL' | 'BLK' | '3PT';
export interface BoxTag { tone: 'rare' | 'season_high'; label: string }
export type BoxTags = Record<string, Partial<Record<BoxCol, BoxTag>>>;

type StatKey = 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'fg3m';
const STAT_COL: Record<StatKey, BoxCol> = { pts: 'PTS', reb: 'REB', ast: 'AST', stl: 'STL', blk: 'BLK', fg3m: '3PT' };
const STAT_KEYS = Object.keys(STAT_COL) as StatKey[];

/** A season high needs this many earlier games to mean anything. */
const MIN_PRIOR_GAMES = 3;

/** Season highs below these floors are noise (1 block over a prior max of 0), so they get no grey tag. */
export { SEASON_HIGH_FLOORS };

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
      if (v == null || max == null || v <= max || v < SEASON_HIGH_FLOORS[k]) continue;
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

/** Which tag tones appear among these players: the legend shows a key only when a tag of that tone is on screen. */
export function tagTonesPresent(tags: BoxTags | undefined, playerIds: string[]): { rare: boolean; season_high: boolean } {
  const out = { rare: false, season_high: false };
  for (const id of playerIds) {
    for (const t of Object.values(tags?.[id] ?? {})) if (t) out[t.tone] = true;
  }
  return out;
}

export interface PlayerSeasonHighRow {
  game_id: string; game_date: string; opp_abbreviation: string; home: boolean;
  points: number | null; rebounds: number | null; assists: number | null; fg3_made: number | null;
}

const PLAYER_HIGH_STATS = [
  { stat: 'pts', label: 'Points', col: 'points' },
  { stat: 'reb', label: 'Rebounds', col: 'rebounds' },
  { stat: 'ast', label: 'Assists', col: 'assists' },
  { stat: 'fg3m', label: 'Threes', col: 'fg3_made' },
] as const;

/** A player's best game per stat; on a tie the earliest game wins; a stat with no values is left out. */
export function playerSeasonHighs(rows: PlayerSeasonHighRow[]): PlayerDetailPayload['season_highs'] {
  const out: PlayerDetailPayload['season_highs'] = [];
  for (const { stat, label, col } of PLAYER_HIGH_STATS) {
    let best: PlayerSeasonHighRow | null = null;
    for (const r of rows) {
      const v = r[col];
      if (v == null) continue;
      const b = best === null ? null : (best[col] as number);
      if (best === null || b === null || v > b
          || (v === b && (r.game_date < best.game_date || (r.game_date === best.game_date && r.game_id < best.game_id)))) best = r;
    }
    if (best) out.push({ stat, label, value: best[col] as number, game_id: best.game_id, game_date: best.game_date, opp: best.opp_abbreviation, home: best.home });
  }
  return out;
}
