// scripts/lib/pbp/types.ts
// Play-by-play shapes. Raw* mirror the fields cdn.nba.com liveData and
// stats.nba.com playbyplayv3 share (both wrap actions in { game: { actions } });
// PbpEvent is the one normalized shape everything downstream uses.

export type PbpSource = 'cdn' | 'stats_pbp';
export type PbpKind = 'fg' | 'ft' | 'rebound' | 'turnover' | 'steal' | 'block' | 'other';

export interface RawAction {
  actionNumber: number;                // cdn: unique per game; v3: NOT unique (repeats across related actions)
  actionId?: number | null;            // v3 only: unique, increasing id within the game
  clock: string;                       // "PT04M32.00S" — time left in the period
  period: number;
  teamTricode?: string | null;
  personId?: number | null;
  actionType?: string | null;          // cdn: "2pt","3pt","freethrow","rebound",... v3: "Made Shot","Free Throw",...
  subType?: string | null;
  shotResult?: string | null;          // "Made" | "Missed"
  shotValue?: number | null;           // v3 only
  assistPersonId?: number | null;      // cdn only
  scoreHome?: string | number | null;  // v3 leaves it "" when unchanged
  scoreAway?: string | number | null;
  description?: string | null;
}

export interface RawPlayByPlay {
  game: { gameId: string; actions: RawAction[] };
}

export interface PbpEvent {
  seq: number;                         // 1-based order within the game
  actionNumber: number;                // stable provider id (cdn: actionNumber; v3: actionId ?? actionNumber)
  actionType: string;                  // raw provider actionType ('' if missing)
  subType: string;                     // raw provider subType ('' if missing)
  period: number;
  clockSec: number;
  elapsedSec: number;
  teamTricode: string | null;
  personId: number | null;
  kind: PbpKind;
  made: boolean | null;                // fg / ft only
  shotValue: 1 | 2 | 3 | null;
  assistPersonId: number | null;
  points: number;                      // total score change on this event (negative after a correction)
  scoringSide: 'home' | 'away' | null;
  scoreHome: number;
  scoreAway: number;
  description: string;
}

export interface NormalizedPbp {
  source: PbpSource;
  /** Assists, steals and blocks carry player ids (cdn only). */
  hasDefensiveCredits: boolean;
  events: PbpEvent[];
}
