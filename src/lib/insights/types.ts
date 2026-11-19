// src/lib/insights/types.ts
// Insight shapes shared by the generator (scripts/lib/insights/engine/) and
// the app. No imports, no DB: both sides import it (spec §2).

export type Surface = 'live' | 'pregame' | 'postgame' | 'season' | 'player';
export const SURFACES: readonly Surface[] = ['live', 'pregame', 'postgame', 'season', 'player'];

/** Legacy `insights.scope`, kept populated so existing readers keep working (spec §2.8). */
export type InsightScope = 'live' | 'between_games' | 'historical';

export function scopeForSurface(surface: Surface): InsightScope {
  if (surface === 'live') return 'live';
  if (surface === 'postgame') return 'historical';
  return 'between_games';
}

export type FrameType =
  | 'career_high' | 'only_one' | 'records_best' | 'first_since' | 'longest_since'
  | 'league_rank' | 'milestone' | 'joins_company' | 'clippers_rank' | 'season_high'
  | 'nth_time' | 'none';

/** What a frame compares against: the subject's own history, every Clipper (or the team), or the league. */
export type FrameWho = 'subject' | 'group' | 'league';

export interface Frame {
  type: FrameType;
  strength: number;          // 0–1 (spec §2.3)
  who: FrameWho;
  /** The rendered context line (the renderer fills it in). */
  text: string;
  since_date?: string;       // YYYY-MM-DD of the previous occurrence (first_since / longest_since)
  since_label?: string;      // season label when the comparison is by season ("2021-22")
  years?: number;            // years since the previous occurrence
  rank?: number;
  total?: number;
  /** league_rank: how many others share the rank (a tie reads "tied for", never the rank alone). */
  tied?: number;
  count?: number;            // nth_time / joins_company
  names?: string[];          // joins_company
  records_label?: string;    // first season of the records searched ("2020-21")
  records_seasons?: number;  // seasons of records searched
  step?: number;             // milestone threshold index (0-based)
  prior_value?: number;      // career_high: the previous best
  /** The Q1 count: regular-season games strictly between the previous occurrence and this one. Set by the first_since and longest_since questions. */
  games_since?: number;
  /** The fact's stat key. Set on every new row. */
  stat?: string;
  /** The fact's value. Set on every new row. */
  value?: number;
  proof_rows: unknown[];
}

export interface EntityRef {
  type: 'player' | 'team' | 'game';
  id: string;
  name: string;
}

export type Evidence =
  | { type: 'streak_strip'; games: { date: string; value: number; hit: boolean }[]; threshold: number }
  | { type: 'rank_track'; rank: number; total: number; tied?: number; betterIsHigher: boolean; label: string }
  | { type: 'history_ladder'; current: { value: number; label: string };
      others: { value: number; label: string; date: string }[] }
  | { type: 'delta'; before: { value: number; label: string }; after: { value: number; label: string };
      betterIsHigher: boolean }
  | { type: 'milestone_progress'; current: number; target: number; label: string }
  | { type: 'margin_spark'; series: [number, number][]; highlight?: { from: number; to: number } };

export type SalienceClass = 'roster_core' | 'roster' | 'team' | 'former' | 'opponent';

/** Every scorer term, stored for debugging and tuning (spec §2.4). */
export interface ScoreParts {
  p: number | null;
  k: number | null;
  n: number | null;
  p_ref: number | null;
  power: number | null;
  rarity: number;
  frame_strength: number;
  base: number;
  salience: number;
  salience_class: SalienceClass;
  age_days: number;
  half_life_days: number | null;
  recency: number;
  polarity: number;
  novelty: number;
  /** As-of date since which the headline and frame type have been unchanged. */
  unchanged_since: string;
  importance: number;
}
