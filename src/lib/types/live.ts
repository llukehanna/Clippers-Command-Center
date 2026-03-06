// src/lib/types/live.ts
// Shared type definitions for NBA live JSON API responses and application state.
// Zero runtime imports — pure type declarations only.
// Importable by both scripts/ and src/ (Phase 9 API routes).

// ── NBA Live JSON API response types (cdn.nba.com/static/json/liveData/) ─────

export interface NBAScoreboardResponse {
  meta: { version: number; code: number; request: string; time: string };
  scoreboard: {
    gameDate: string;
    leagueId: string;
    leagueName: string;
    games: ScoreboardGame[];
  };
}

export interface ScoreboardGame {
  gameId: string;          // e.g. "0022400001"
  gameCode: string;        // e.g. "20260306/DALBOS"
  gameStatus: number;      // 1=scheduled, 2=in_progress, 3=final
  gameStatusText: string;
  period: number;          // 0=not started, 1-4=regulation, 5+=OT
  gameClock: string;       // "PT04M32.00S" or "" when not in progress
  gameTimeUTC: string;     // ISO 8601 tipoff time
  homeTeam: ScoreboardTeam;
  awayTeam: ScoreboardTeam;
}

export interface ScoreboardTeam {
  teamId: number;          // LAC = 1610612746
  teamName: string;
  teamCity: string;
  teamTricode: string;
  wins: number;
  losses: number;
  score: number;
  periods: Array<{ period: number; periodType: string; score: number }>;
  timeoutsRemaining: number;
  inBonus: string;
}

export interface NBABoxscoreResponse {
  meta: { version: number; code: number; request: string; time: string };
  game: BoxscoreGame;
}

export interface BoxscoreGame {
  gameId: string;
  gameStatus: number;
  gameStatusText: string;
  period: number;
  gameClock: string;
  gameTimeUTC: string;
  regulationPeriods: number;
  homeTeam: BoxscoreTeam;
  awayTeam: BoxscoreTeam;
}

export interface BoxscoreTeam {
  teamId: number;
  teamName: string;
  teamCity: string;
  teamTricode: string;
  score: number;
  periods: Array<{ period: number; periodType: string; score: number }>;
  statistics: TeamStatistics;
  players: BoxscorePlayer[];
}

export interface BoxscorePlayer {
  status: string;        // "ACTIVE" | "INACTIVE"
  order: number;
  personId: number;      // maps to players.nba_player_id
  jerseyNum: string;
  name: string;
  nameI: string;
  position: string;
  starter: string;       // "1" | "0" — string, not boolean
  oncourt: string;       // "1" | "0"
  played: string;        // "1" | "0" — "0" means DNP, skip those rows
  statistics: PlayerStatistics;
}

export interface PlayerStatistics {
  assists: number;
  blocks: number;
  fieldGoalsAttempted: number;
  fieldGoalsMade: number;
  fieldGoalsPercentage: number;
  foulsPersonal: number;
  freeThrowsAttempted: number;
  freeThrowsMade: number;
  freeThrowsPercentage: number;
  minutes: string;           // ISO 8601 "PT25M01.00S" — keep as-is for DB
  minutesCalculated: string; // "PT25M"
  plus: number;
  minus: number;
  plusMinusPoints: number;
  points: number;
  reboundsDefensive: number;
  reboundsOffensive: number;
  reboundsTotal: number;
  steals: number;
  threePointersAttempted: number;
  threePointersMade: number;
  threePointersPercentage: number;
  turnovers: number;
}

export interface TeamStatistics {
  assists: number;
  blocks: number;
  fieldGoalsAttempted: number;
  fieldGoalsMade: number;
  fieldGoalsPercentage: number;
  foulsPersonal: number;
  freeThrowsAttempted: number;
  freeThrowsMade: number;
  freeThrowsPercentage: number;
  points: number;
  reboundsDefensive: number;
  reboundsOffensive: number;
  reboundsTotal: number;
  steals: number;
  threePointersAttempted: number;
  threePointersMade: number;
  threePointersPercentage: number;
  turnovers: number;
}

// ── Play-by-play response ─────────────────────────────────────────────────────

export interface NBAPlayByPlayResponse {
  meta: { version: number; code: number; request: string; time: string };
  game: {
    gameId: string;
    actions: PlayByPlayAction[];
  };
}

export interface PlayByPlayAction {
  actionNumber: number;
  clock: string;           // ISO 8601 "PT04M32.00S"
  period: number;
  teamId: number;
  teamTricode: string;
  actionType: string;      // "2pt", "3pt", "freethrow", etc.
  subType: string;
  qualifiers: string[];
  personId: number;
  description: string;
  scoreHome: string;       // e.g. "87"
  scoreAway: string;       // e.g. "82"
  pointsTotal: number;     // points scored on this action (0 for misses/fouls)
}

// ── Application-level type ────────────────────────────────────────────────────

/**
 * Represents a live game snapshot used by Phase 9 /api/live route.
 * Combines NBA API data with internal DB identifiers.
 */
export interface LiveGameState {
  game_id: string;         // internal DB bigint as string
  nba_game_id: string;     // NBA's gameId string e.g. "0022400001"
  status: 'pre_game' | 'in_progress' | 'final';
  period: number;
  clock: string;           // "MM:SS" parsed from ISO 8601
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  snapshot_count: number;  // how many snapshots stored so far this game
  last_polled_at: string;  // ISO 8601
  is_stale: boolean;       // true when last poll failed (LIVE-12)
  stale_reason: string | null;
}
