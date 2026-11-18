// scripts/lib/franchise/types.ts
// Shared types for the franchise transaction history pipeline.
// The dataset and override types reference other modules' row types with `import type` only (type-only cycles are
// erased at compile time).
import type { ContractOption, CoachSeasonRow, RosterRow } from './bbref-tables.js';
import type { SkippedLine } from './bbref-moves.js';
import type { LotteryOut } from './lottery.js';
import type { PersonRow } from './people.js';
import type { ChainBreak, ChainDispute, PickRow, PicksResult, SwapRow } from './picks.js';
import type { Protection } from './protections.js';
import type { MergedMove } from './reconcile-moves.js';
import type { Honor } from './wiki-team.js';

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
  /**
   * The person_xref key for `person`, when an override (kind 'person') settled it. The writer uses it before
   * resolving `person` itself.
   */
  personKey?: string;
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

// ---- the assembled dataset (Task 13; written by Task 14, built by Task 15) ----------------------------------------

/** salaries: one row per player per Clippers season. */
export interface SalarySeasonRow {
  /** Season start year (2004 = 2004-05). */
  seasonId: number;
  /** person_xref key (a BBRef id for BBRef salary rows). */
  personKey: string;
  amountUsd: number;
  /** Source key of the page the amount came from, e.g. `bbref:LAC-2005` or the weekly contracts job's key. */
  source: string;
}

/** payroll_seasons: how complete a season's listed salaries are. */
export interface PayrollSeasonRow {
  seasonId: number;
  /** Players with a salary row that season. */
  listedPlayers: number;
  /** Players who appeared for the Clippers that season (from player_seasons), or null when not known. */
  rosterPlayers: number | null;
  /** Sum of the listed salaries. */
  listedTotalUsd: number;
  /** The listed salaries miss players (rule set by the import, spec §1 payroll_seasons). */
  isPartial: boolean;
}

/** contracts: one row per player per future season of the current contract snapshot. */
export interface ContractSnapshotRow {
  personKey: string;
  seasonId: number;
  amountUsd: number;
  /** Guaranteed money for the whole contract, or null when the source doesn't say. */
  guaranteedUsd: number | null;
  /** The option on this season, or null for none / not recorded. */
  option: ContractOption | null;
  /** ISO timestamp of the cached contracts page the snapshot was read from. */
  fetchedAt: string;
}

/** executive_terms. */
export interface ExecTermRow {
  /** BBRef executive id, or null when the source row has no link (reported as unmatched). */
  personKey: string | null;
  name: string;
  title: string | null;
  /** YYYY-MM-DD, or null when unknown. */
  startDate: string | null;
  endDate: string | null;
}

/** honors: Honor plus the person it resolves to (null: unresolved, reported as unmatched). */
export interface HonorRow extends Honor {
  personKey: string | null;
}

/** An unparsed line an `ignore` override settled. Kept for the report's count, never written. */
export interface IgnoredLine extends UnparsedLine {
  reason: string;
}

/**
 * Every table's rows for one import, plus the side lists the review report reads. Built by Task 15's buildDataset,
 * adjusted by applyOverrides, read by buildReport and written by Task 14's writeFranchise.
 */
export interface FranchiseDataset {
  /** The next draft not yet held (picks of this year or later are `future`). */
  currentDraftYear: number;
  // ---- table rows ----
  people: PersonRow[];
  /** Reconciled moves after applyMoveOverrides, then buildPicks linked their pick parts (PicksResult.moves). */
  moves: MergedMove[];
  picks: PickRow[];
  swaps: SwapRow[];
  lottery: LotteryOut[];
  salaries: SalarySeasonRow[];
  payrollSeasons: PayrollSeasonRow[];
  contracts: ContractSnapshotRow[];
  /** `bbrefId` is the coach's person key. */
  coachSeasons: CoachSeasonRow[];
  execTerms: ExecTermRow[];
  honors: HonorRow[];
  // ---- side lists for the report (never written) ----
  /** Every parser's unparsed lines that no override settled. */
  unparsed: UnparsedLine[];
  /** Unparsed lines an `ignore` override settled (filled by applyOverrides). */
  ignored: IgnoredLine[];
  /** Moves a `drop` override removed (from applyMoveOverrides). */
  dropped: DroppedMove[];
  /** Lines deliberately not turned into moves (BBRef G League moves, duplicates). */
  skipped: SkippedLine[];
  /** BBRef roster people with no `players` match, and with several (matchPeople). */
  peopleUnmatched: RosterRow[];
  peopleAmbiguous: RosterRow[];
  breaks: ChainBreak[];
  disputes: ChainDispute[];
  unkeyed: PicksResult['unkeyed'];
  /** Team-article award headings with no honor code (TeamArticle.skippedCategories). */
  skippedCategories: string[];
}

// ---- overrides (spec §3.2 "Overrides") ----------------------------------------------------------------------------

/** A move an override dropped (never written; listed in the report). */
export interface DroppedMove {
  transactionKey: string;
  sources: string[];
  reason: string;
}

/** A draft row's original franchise, set by an override and read by buildPicks (DraftInput.originals). */
export interface DraftOriginal {
  year: number;
  overall: number;
  originalFranchiseId: FranchiseId;
}

/** Parts and completeness an override gives a move. */
interface MoveOverrideBody {
  /** The move's new parts (our own wording in any `text`). Settles the move's conflicts. */
  replaceParts: MovePart[];
  /** Force `complete` (e.g. false for "compensation not recorded"); default: no part has a gap. */
  complete?: boolean;
  source: string;
}

/**
 * A fact we've written ourselves. Every entry carries `source`: a one-line note of where the fact comes from.
 * apply-overrides.ts says which phase applies each kind and what it does.
 *
 * - pick: by `{ draftYear, overall }`, a draft row's original franchise (keys a row buildPicks can't settle); by
 *   `{ moveKey, partIndex }`, an unlinked pick part's identity (buildPicks then links it); by `pickKey`, protections.
 * - move: by `moveKey` (a transaction key or any of its source keys): replace the parts, merge the move into another
 *   (`mergeInto`) or drop it (`drop`, with a reason); or, by an unparsed line's `{ source, text }` plus `create`, turn
 *   that line into a new move.
 * - person: parts, honors and executive terms whose person matches `ref` (a BBRef id or `nba:<id>`; or a name, which
 *   only matches people carrying no id) get `personKey`. `scope` narrows it to one move or season.
 * - ignore: drop an unparsed line (by `{ source, text }`) from the gate, with a reason.
 * - teamName: a team name the parsers can't resolve in that season (read by team-names.ts at parse time).
 */
export type Override =
  | { kind: 'pick'; match: { draftYear: number; overall: number }; set: { originalFranchiseId: FranchiseId }; source: string }
  | { kind: 'pick'; match: { moveKey: string; partIndex: number }; set: Partial<Pick<PickRef, 'year' | 'round' | 'originalFranchiseId'>>; source: string }
  | {
      kind: 'pick';
      match: { pickKey: string };
      /** `protections` is required unless `protectionsText` parses (parseProtections); [] means unprotected. */
      set: { protectionsText?: string; protections?: Protection[] };
      source: string;
    }
  | ({ kind: 'move'; match: { moveKey: string } } & MoveOverrideBody)
  | ({
      kind: 'move';
      match: { source: string; text: string };
      /** The new move's kind, and its date when the line has none; involvesClippers defaults to true. */
      create: { kind: MoveKind; date?: string; involvesClippers?: boolean };
    } & MoveOverrideBody)
  | { kind: 'move'; match: { moveKey: string }; mergeInto: string; source: string }
  | { kind: 'move'; match: { moveKey: string }; drop: true; reason: string; source: string }
  | { kind: 'person'; match: { ref: string; scope?: { moveKey?: string; seasonId?: number } }; personKey: string; source: string }
  | { kind: 'ignore'; match: { source: string; text: string }; reason: string; source: string }
  | { kind: 'teamName'; match: { text: string; seasonId: number }; franchise: FranchiseId; source: string };
