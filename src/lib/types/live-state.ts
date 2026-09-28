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
}
