// scripts/lib/franchise/types.ts
// Shared types for the franchise transaction history pipeline.

export type FranchiseId = number;
export type MoveKind =
  | 'trade' | 'draft' | 'signing' | 're_signing' | 'extension' | 'two_way' | 'ten_day' | 'conversion'
  | 'waiver' | 'claim' | 'release' | 'expansion_draft' | 'sale' | 'retirement' | 'hire' | 'fire' | 'other';
export type AssetKind = 'player' | 'draft_rights' | 'pick' | 'swap' | 'cash' | 'exception' | 'other';
export type GapReason =
  | 'pick_unidentified'
  | 'protections_unknown'
  | 'source_conflict'
  | 'person_unmatched'
  /** A trade part whose sending or receiving team isn't stated (e.g. a multi-team entry with no "(from X)"). */
  | 'party_unknown';

export interface PersonRef {
  bbrefId?: string;
  nbaPersonId?: number;
  name: string;
}
export interface PickRef {
  year: number;
  round: number;
  originalFranchiseId?: FranchiseId;
  selected?: PersonRef;
  protectionsText?: string;
  vague?: boolean;
}
export interface SwapRef {
  year: number;
  round: number;
  franchiseA: FranchiseId;
  franchiseB: FranchiseId;
  protectionsText?: string;
}
export interface MovePart {
  from: FranchiseId | null;
  to: FranchiseId | null;
  kind: AssetKind;
  person?: PersonRef;
  pick?: PickRef;
  swap?: SwapRef;
  text?: string;
  gap?: GapReason;
  /** Set by buildPicks (picks.ts) once the part is linked to its draft_picks / pick_swaps row. */
  pickKey?: string;
  swapKey?: string;
}
export interface ParsedMove {
  sourceKey: string;
  date: string; // YYYY-MM-DD
  kind: MoveKind;
  parts: MovePart[];
  involvesClippers: boolean;
  complete: boolean;
  /** Raw source note text that followed the sentence (e.g. "swap, not exercised"). In-memory only, never written to the database. */
  notes?: string[];
}
export interface UnparsedLine {
  source: string;
  index: number;
  date: string | null;
  text: string;
}
