// scripts/lib/insights/engine/types.ts
// Shapes of the v2 insight engine (spec §2.1–§2.4). DB-free.
import type {
  EntityRef, Evidence, Frame, FrameType, InsightScope, ScoreParts, Surface,
} from '../../../../src/lib/insights/types';

export type { Surface };

export type Param = string | number | boolean | null;
export interface ProofQuery { sql: string; params: Param[] }
export type Row = Record<string, unknown>;
/** Runs one query and returns plain rows (query.ts in production, a fake in unit tests). */
export type Runner = (q: ProofQuery) => Promise<Row[]>;

/** First season of complete records (app_kv insights.records_start / insights.pbp_records_start). */
export interface RecordsStart { season_id: number; label: string }

/** Every fact kind. The template and question registries must cover each one (tests enforce it). */
export const FACT_KINDS = [
  'streak', 'milestone', 'league_rank', 'standings', 'recent_form', 'yoy_change',
  'opp_rank', 'h2h', 'last_meeting', 'player_game_stat', 'player_combo',
  'team_game_stat', 'game_flow',
] as const;
export type FactKind = (typeof FACT_KINDS)[number];

/**
 * How rare a fact is (spec §2.4):
 *   rate    — k/n of the subject's prior opportunities, shrunk toward pRef, raised to `power`
 *             (a streak of L games has power L)
 *   share   — a probability read off a ranking (rank / total, share of teams with a move this big)
 *   context — scene-setting (head-to-head, last meeting): rarity 0, never trivial
 */
export type Sample =
  | { kind: 'rate'; k: number; n: number; pRef: number; power: number }
  | { kind: 'share'; p: number }
  | { kind: 'context' };

export interface StreakGame { date: string; value: number; hit: boolean }

/** Kind-specific values detectors set and the framer, templates and evidence read. */
export interface FactData {
  // Wording
  thing?: string;            // singular claim noun: "55-point game", "streak of 30+ points", "1,500-point season"
  best?: string;             // lower-case superlative: "most points in a game", "longest streak of 30+ points"
  by?: string;               // "by a Clipper" | "by the Clippers"
  unit?: string;             // "points", "PPG"
  label?: string;            // metric label ("offensive rating") or milestone noun ("1,500 points")
  formatted?: string;        // the fact's value formatted ("118.4", "27.1 PPG", "1,612 points")
  higherIsBetter?: boolean;
  // Ranks
  rank?: number;
  total?: number;
  bottom?: boolean;          // ranked from the bottom (bottom-5 facts)
  min_games?: number;
  // Streaks
  length?: number;
  start_date?: string;
  end_date?: string;
  streak_games?: StreakGame[];
  hit_threshold?: number;
  // Milestones / season totals
  threshold?: number;
  step?: number;
  total_value?: number;
  games?: number;
  expr?: string;             // SQL aggregate over game_player_box_scores pb (frames re-run it)
  // Comparisons
  yoy?: 'team_rank' | 'record' | 'player';
  prev_rank?: number;
  prev_value?: number;
  cur_value?: number;
  prev_formatted?: string;
  prev_games?: number;
  wins?: number;
  losses?: number;
  prev_wins?: number;
  prev_losses?: number;
  conference?: string | null;
  league_rank?: number;
  league_teams?: number;
  // Matchups
  side?: 'offense' | 'defense';
  opp_wins?: number;
  meetings?: number;
  lac_score?: number;
  opp_score?: number;
  meeting_date?: string;
  line?: string;             // the line's big categories: "12 pts, 11 reb, 10 blk"
  meeting_home?: boolean;
  // Game flow
  margin_series?: [number, number][];
  lead?: number;
  deficit?: number;
}

export interface Fact {
  kind: FactKind;
  surface: Surface;
  subject: { type: 'player' | 'team'; id: string; name: string };
  /** stat key: 'pts', 'scoring_30', 'season_points', 'team_off_rating', ... */
  stat: string;
  value: number;
  window: {
    type: 'game' | 'period' | 'half' | 'streak' | 'season' | 'last_n' | 'career';
    game_id?: string; period?: number; season_id?: number; n?: number;
  };
  context: { date: string; opponent_id?: string; opponent_name?: string; home?: boolean; result?: 'W' | 'L' };
  polarity: 'positive' | 'negative' | 'neutral';
  /** The fact's own proof; `match` picks this claim's rows out of a multi-row result. */
  proof: ProofQuery & { match: Record<string, string | number | boolean> };
  asOf: string;
  sample: Sample;
  data: FactData;
  /** Extra identity for facts that differ only by the value that defines them (milestone threshold). */
  keyExtra?: string;
  /** insights.game_id (game pages read by it) and insights.season_id. */
  gameId: string | null;
  seasonId: number | null;
}

export interface TeamInfo {
  teamId: string;
  abbreviation: string;
  name: string;              // "Warriors"
  fullName: string;          // "Golden State Warriors"
  conference: string | null;
}

export interface InsightSeason {
  id: number;
  label: string;             // "2025-26"
  isCurrent: boolean;
  phrase: string;            // "this season" | "in 2025-26"
  lastGameDate: string;      // last Clippers box-score game in the season, as of the cutoff
}

export interface RosterPlayer { playerId: string; name: string; games: number; mpg: number }
export interface LeagueCoverage { complete: boolean; reason: string | null }
export interface PriorState {
  firstEmittedAt: string;    // YYYY-MM-DD (Los Angeles)
  headline: string;
  frameType: FrameType | null;
  unchangedSince: string | null;
}

export interface EngineContext {
  /** Every query applies game_date <= asOf (spec §2.1). */
  asOf: string;
  lac: TeamInfo;
  teams: Map<string, TeamInfo>;
  season: InsightSeason;
  /** Minimum games for a player to be ranked league-wide (half the season so far). */
  minPlayerGames: number;
  recordsStart: RecordsStart | null;
  pbpRecordsStart: RecordsStart | null;
  /** Current Clippers as of asOf (last game of the season and of the latest season was for LAC). */
  roster: Map<string, RosterPlayer>;
  league: LeagueCoverage;
  /** --game: postgame detectors cover only this game. */
  gameId: string | null;
  /** --days: postgame covers regular-season finals dated (asOf − postgameDays, asOf]. */
  postgameDays: number;
  /** Stored state by key (novelty); empty for dry runs. */
  prior: Map<string, PriorState>;
}

export interface DetectorOutput {
  facts: Fact[];
  /** Games this run covered: stale-row deactivation touches only their rows. null = the whole surface. */
  gameIds: string[] | null;
}

export interface Detector {
  name: string;              // 'season.streaks'
  surface: Surface;
  /** Fact kinds it emits — its deactivation scope. Unique per surface across the registry. */
  categories: readonly FactKind[];
  run(ctx: EngineContext): Promise<DetectorOutput>;
}

/** One insight row ready to upsert. */
export interface InsightDraft {
  key: string;               // proof_hash
  detector: string;
  surface: Surface;
  scope: InsightScope;
  category: FactKind;
  team_id: string;
  game_id: string | null;
  player_id: string | null;
  season_id: number | null;
  headline: string;
  detail: string;
  importance: number;
  proof_sql: string;
  proof_params: Record<string, unknown>;
  proof_result: unknown[];
  frame: Frame;
  evidence: Evidence | null;
  entities: EntityRef[];
  score_parts: ScoreParts;
}
