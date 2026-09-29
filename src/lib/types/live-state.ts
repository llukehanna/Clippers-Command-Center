// src/lib/types/live-state.ts
// The live runner's derived state for one game (Live v2 spec §4). Written by
// scripts/lib/live-poller.ts into live_state.state, read by /api/live.
// Zero runtime imports — importable by scripts/ and src/.

import type { BoxscoreTeam } from './live';

/** Where the game is, as far as polling cadence is concerned (spec §3). */
export type LivePhase = 'PREGAME' | 'TIP_WATCH' | 'LIVE' | 'CLUTCH' | 'STOPPAGE' | 'HALFTIME' | 'FINAL';

/** One play-by-play action, trimmed for clients. */
export interface LivePlay {
  action_number: number;
  period: number;
  clock: string;               // "4:32"
  team_tricode: string | null;
  person_id: number | null;
  action_type: string;
  sub_type: string;
  description: string;
  score_home: number;
  score_away: number;
  time_actual: string | null;  // wall clock of the real play
}

/** Same shape as scripts/lib/poll-live-logic.ts RecentScoringEvent (read by live insights). */
export interface LiveRecentScoring {
  team_id: string;
  team_tricode?: string;
  points: number;
  event_time_seconds: number;
}

/** One point of the game-flow series: the tip, a score change, or a period end (spec §7.1). */
export interface FlowPoint {
  t: number;                   // game seconds elapsed (regulation 0–2880, overtime beyond)
  m: number;                   // LAC margin after this action
  wp: number;                  // LAC win probability 0–1 at this moment (model estimate)
  a: number;                   // action_number (0 for the tip)
  d: string;                   // play description ('' for the tip and period ends)
}

export type FlowMarker =
  | { kind: 'run'; t: number; t_start: number; side: 'lac' | 'opp'; pts: number }
  | { kind: 'timeout'; t: number; side: 'lac' | 'opp' }
  | { kind: 'lead_change'; t: number; side: 'lac' | 'opp' }   // side = the new leader
  | { kind: 'period_end'; t: number; period: number }
  | { kind: 'max_lead'; t: number; side: 'lac' | 'opp'; margin: number };

export interface LiveFlow {
  points: FlowPoint[];         // ascending t; append-only while the feed only appends
  markers: FlowMarker[];       // ascending t
}

export interface ReliabilityBin {
  lo: number;                  // predicted-probability bin [lo, hi)
  hi: number;
  n: number;                   // samples in the bin
  mean_p: number;              // mean predicted probability
  observed: number;            // share of those samples where LAC won
}

/** The fitted model, stored in app_kv 'wp:model' by scripts/calibrate-wp.ts. */
/** σ fitted over the games whose pregame expectation came from one source. */
export interface SourceFit {
  sigma: number;
  brier: number;
  n_games: number;
}

export interface WpCalibration {
  sigma: number;
  brier: number;
  n_games: number;
  n_samples: number;
  fitted_at: string;
  reliability: ReliabilityBin[];
  /**
   * σ per source of E, for each source with enough games. A home-court E
   * (±2.5) is a poorer guess than a closing spread, which inflates σ; a game
   * with a spread uses the spread-only fit. Absent in fits stored before it.
   */
  sigma_by_source?: Partial<Record<'spread' | 'home_court', SourceFit>>;
}

export interface LiveWinProb {
  lac: number;                 // 0–1, rounded to 3 decimals
  model: 'stern-v1';
  sigma: number;
  expected_margin: number;     // pregame expected LAC margin (E)
  expected_source: 'spread' | 'home_court';
  calibration: WpCalibration | null;
}

/** One player on the floor (spec §7.2). */
export interface StintPlayer {
  player_id: number;           // NBA personId
  name: string;                // "K. Leonard"
  stint_start: { period: number; clock: string };
  stint_secs: number;
  stint_plus_minus: number;    // from this player's team's side
  pf: number;
  foul_trouble: boolean;
  min: number;                 // minutes tonight, 1 decimal
  usual_min: number | null;    // last-10-game average
  pace: 'over' | 'under' | null;
}

export interface LineupUnit {
  player_ids: number[];        // ascending
  names: string[];             // same order as player_ids
  secs: number;
  plus_minus: number;          // LAC side
}

export interface LineupState {
  on_court: { lac: StintPlayer[]; opp: StintPlayer[] };
  current_unit: { lac_plus_minus: number; secs_together: number };
  units_tonight: LineupUnit[]; // LAC five-man units, top 5 by seconds
  timeouts: { lac: number | null; opp: number | null };
  bonus: { lac: boolean; opp: boolean };
}

/**
 * The runner's latest state for one game. A superset of the pre-Live-v2
 * snapshot payload, so /api/live's existing builders read it unchanged.
 */
export interface LiveStateDoc {
  v: 1;
  seq: number;                 // +1 per saved change, per game
  source: 'nba';
  nba_game_id: string;         // 10-char CDN id
  status: 'scheduled' | 'in_progress' | 'final';
  status_text: string;
  period: number;
  clock: string;               // "4:32"
  home_score: number;
  away_score: number;
  periods: { period: number; home: number; away: number }[];
  home_box: BoxscoreTeam | null;
  away_box: BoxscoreTeam | null;
  recent_scoring: LiveRecentScoring[];
  last_plays: LivePlay[];      // newest first, at most 15
  other_games: unknown[];      // poll-live-logic OtherGame[]
  observed_at: string | null;  // time_actual of the newest play
  fetched_at: string;          // when the runner built this state
  cadence: { phase: LivePhase; next_ms: number };
  is_stale: boolean;           // always false from the runner; kept for the /api/live contract
  stale_reason: string | null;
  // Plan 3 (spec §7). Optional: rows written before Plan 3 lack them.
  flow?: LiveFlow | null;      // null before tip
  wp?: LiveWinProb | null;
  lineups?: LineupState | null; // null until both box scores exist
}
