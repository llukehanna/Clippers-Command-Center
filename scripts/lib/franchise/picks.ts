// scripts/lib/franchise/picks.ts
// Pick parts in merged moves -> one record per draft pick and per swap, so trades and the draft point at the same
// asset (spec §1 draft_picks / pick_swaps, §3.2 "Picks" and "Protections"). Pure: no DB, no I/O.
//
// A pick's identity is (year, round, original franchise). A draft row's original is its chain's first team; with no
// chain, an original a stored part states, else the drafting team, unless a stored part shows the pick arriving from
// another team (a trade's sender is never taken as the original). Rows claiming one pick are ranked (chain > stated
// original > default); losers, ties and contradicted defaults stay unkeyed (`unkeyed`) for overrides, never guessed.
// A trade part is linked to a pick only by:
//   1. its selection ("X was later selected"): the draft row that selected X (BBRef id via the Clippers' BBRef draft
//      table, else the normalized name on that year's Wikipedia draft page), when that row is keyed;
//   2. a stated original franchise (the part's own, or a BBRef note "YYYY Nth-rd pick is TEAM own");
//   3. exactly one draft row of that year and round whose owners (chain, drafting team, draft-day destinations) have
//      the part's sending team before its receiving team.
// Anything else stays an unlinked part with gap `pick_unidentified`; a vague pick (year/round placeholders) is never
// keyed (Ruling R8). A part whose stated original disagrees with its selection's draft row is a `source_conflict`.
//
// A draft row's chain is Wikipedia's "from X via Y", cross-checked against ESPN's tradeNote from 2003 on, as team sets
// (ESPN's order varies): a one-team note fills an empty chain, an agreeing one may extend it, and a disagreeing one
// leaves Wikipedia's chain in place and is returned in `disputes`.
//
// BBRef notes (Ruling R7) are read, never copied: "did not convey" / "rescinded" marks the pick extinguished (unless a
// draft row shows it was used anyway: a pick that didn't convey in one deal stays with its owner), and a "swap" note
// turns the pick part into a swap (`exercised: false` when "not exercised" / "did not convey"). Unrecognized notes are
// left alone. Protections come only from parseProtections on the parts' protection wording: unknown is null and
// protectionsKnown=false, never "unprotected".
//
// Rows: every pick the Clippers owned, held or owed (their draft selections, every draft row they appear in, their
// forfeited picks, their own picks in the next seven drafts) plus every pick a stored move part links to. `status`
// is null when a past pick's outcome is unknown (the DB column is nullable). Clippers selections whose chain no
// stored parts complete are returned in `breaks`.
import { NBA_TEAM_IDS } from '../nba-teams.js';
import { normalizePersonName } from '../player-match.js';
import type { DraftRow } from './bbref-tables.js';
import { personKey, pickKey, swapKey } from './keys.js';
import { parseProtections, type Protection } from './protections.js';
import type { MergedMove } from './reconcile-moves.js';
import { franchiseFromName } from './team-names.js';
import type { FranchiseId, MovePart, PersonRef } from './types.js';
import type { DraftPickRow, ForfeitedPick } from './wiki-draft.js';

const LAC = NBA_TEAM_IDS.LAC;
/** ESPN's draft API has trade notes from this draft on. */
const ESPN_FIRST_YEAR = 2003;
/** Picks can be traded up to seven drafts ahead, so the Clippers hold (or owe) their own picks this far out. */
const FUTURE_DRAFTS = 7;

export type PickStatus = 'future' | 'used' | 'conveyed_as_other' | 'extinguished' | 'forfeited';

export interface PickRow {
  pickKey: string;
  year: number;
  round: number;
  originalFranchiseId: FranchiseId;
  protections: Protection[] | null;
  protectionsText: string | null;
  protectionsKnown: boolean;
  /** null: a past pick whose outcome no source records. */
  status: PickStatus | null;
  overall: number | null;
  selectedPersonKey: string | null;
  /** The team that made the selection, or the last draft-day destination; null when not used (or unknown). */
  finalOwnerFranchiseId: FranchiseId | null;
}

export interface SwapRow {
  swapKey: string;
  year: number;
  round: number;
  franchiseA: FranchiseId;
  franchiseB: FranchiseId;
  protections: Protection[] | null;
  protectionsText: string | null;
  protectionsKnown: boolean;
  /** null until a source says; false only when a note says it wasn't exercised. */
  exercised: boolean | null;
}

/** A hop of a Clippers selection's chain (original first, Clippers last) that no stored move part covers. */
export interface ChainBreak {
  pickKey: string;
  missingHop: [FranchiseId, FranchiseId];
}

/** Wikipedia and ESPN name different original teams for a draft row (Wikipedia's chain is kept). */
export interface ChainDispute {
  year: number;
  overall: number;
  wiki: FranchiseId[];
  espn: FranchiseId[];
}

export interface DraftInput {
  /** The Clippers' own selections (BBRef draft.html). */
  bbref: DraftRow[];
  /** Every Wikipedia draft page's selections. */
  wiki: DraftPickRow[];
  /** ESPN tradeNote by `${year}-${overall}`. */
  espn: Map<string, string | null>;
  /** Wikipedia's forfeited picks (DraftPage.forfeited). */
  forfeited?: ForfeitedPick[];
}

export interface PicksResult {
  picks: PickRow[];
  swaps: SwapRow[];
  /** Copies of the input moves; linked parts carry pickKey / swapKey, unlinked pick parts a gap. */
  moves: MergedMove[];
  breaks: ChainBreak[];
  disputes: ChainDispute[];
  /** Draft rows whose pick can't be settled (see settle): the Clippers' own, and any a stored part's selection names. */
  unkeyed: Array<{ year: number; round: number; overall: number; name: string; teamFranchise: FranchiseId }>;
}

// ---- teams in source text ------------------------------------------------------

/** BBRef and ESPN abbreviations that aren't current NBA tricodes. */
const CODE_ALIASES: Record<string, string> = {
  BRK: 'BKN', NJN: 'BKN', NJ: 'BKN', CHO: 'CHA', PHO: 'PHX', NOH: 'NOP', NOK: 'NOP', NO: 'NOP', SEA: 'OKC',
  VAN: 'MEM', GS: 'GSW', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', UTH: 'UTA', WSH: 'WAS', KCK: 'SAC',
};

function teamCode(code: string): FranchiseId | null {
  return NBA_TEAM_IDS[CODE_ALIASES[code] ?? code] ?? null;
}

/** "BOS", "Golden State", "L.A. Lakers", "Bobcats" -> franchise, for the draft's season. */
function espnTeam(text: string, year: number): FranchiseId | null {
  const t = text.trim().replace(/\.$/, '');
  if (/^[A-Z]{2,4}$/.test(t)) return teamCode(t);
  const name = t.replace(/^L\.?\s?A\.?\s+/i, 'Los Angeles ');
  for (const season of [year - 1, year]) {
    const id = franchiseFromName(name, season);
    if (id != null) return id;
  }
  return null;
}

/**
 * ESPN tradeNote -> the owners before the drafting team, original first. [] when the note names none (no note, or
 * only a draft-day trade: "Traded to POR"); null when it can't be read.
 */
export function espnChain(note: string | null | undefined, year: number): FranchiseId[] | null {
  const s = (note ?? '').trim();
  if (!s) return [];
  const m = /^(?:from|via)\s+(.+)$/i.exec(s) ?? /\bpick from\s+(.+)$/i.exec(s);
  if (!m) return /^(?:rights )?traded (?:to|in)\b/i.test(s) ? [] : null;
  // A draft-day clause may follow: "from Denver; Traded to Miami", "from Portland, traded to OKC for rights to …".
  const teams = m[1].split(/\s*;|,\s*(?:rights|traded)\b/i)[0];
  const ids = teams.split(/\s*,\s*(?:and\s+)?|\s+(?:via|through|though|and|then)\s+/i).map((n) => espnTeam(n, year));
  return ids.every((x): x is FranchiseId => x != null) ? ids : null;
}

// ---- draft rows ----------------------------------------------------------------

interface Slot {
  row: DraftPickRow;
  /** Cross-checked owners before the drafting team, original first. */
  chain: FranchiseId[];
  /** chain[0]; with no chain, an original a source states, else the drafting team (null: unsettled, see settle). */
  original: FranchiseId | null;
  /** null when another row has a better claim to the same pick, or it ties with one (see settle). */
  key: string | null;
}

/** A stored part that names this slot's selection: when it happened, its stated original, its sender. */
interface Evidence {
  date: string;
  orig: FranchiseId | null;
  from: FranchiseId | null;
}

/**
 * A chainless row's original from the parts naming its selection: one stated original settles it (rank 1). A sender
 * is never taken as the original (it may have had the pick from someone unrecorded), but when the earliest part came
 * from another team the drafting team's own-pick default is contradicted, so the row is unsettled (null).
 * undefined: no evidence either way, the own-pick default stands (rank 0).
 */
function origin(ev: Evidence[], drafting: FranchiseId): FranchiseId | null | undefined {
  const stated = new Set(ev.map((e) => e.orig).filter((x): x is FranchiseId => x != null));
  if (stated.size > 0) return stated.size === 1 ? [...stated][0] : null;
  const first = [...ev].filter((e) => e.from != null).sort((a, b) => a.date.localeCompare(b.date))[0];
  return first && first.from !== drafting ? null : undefined;
}

function isSubsequence(short: FranchiseId[], long: FranchiseId[]): boolean {
  let i = 0;
  for (const x of long) if (x === short[i]) i++;
  return i === short.length;
}

function crossChecked(r: DraftPickRow, espn: Map<string, string | null>, disputes: ChainDispute[]): FranchiseId[] {
  if (r.year < ESPN_FIRST_YEAR) return r.chain;
  // ESPN sometimes names the drafting team or a draft-day destination ("From LAL through NO"): not earlier owners.
  const later = [r.teamFranchise, ...r.tradedTo];
  const e = espnChain(espn.get(`${r.year}-${r.overall}`), r.year)?.filter((x) => !later.includes(x));
  if (!e || e.length === 0) return r.chain;
  // ESPN's order isn't reliable ("From BOS via BKN" for a BKN pick that went through BOS), so teams are compared
  // as sets, and ESPN's order is only used when it agrees with Wikipedia's or names a single team.
  if (r.chain.length === 0 && e.length === 1) return e;
  const inWiki = e.every((x) => r.chain.includes(x));
  const inEspn = r.chain.every((x) => e.includes(x));
  if (r.chain.length > 0 && (inWiki || inEspn)) {
    return !inWiki && e[0] === r.chain[0] && isSubsequence(r.chain, e) ? e : r.chain;
  }
  disputes.push({ year: r.year, overall: r.overall, wiki: r.chain, espn: e });
  return r.chain;
}

class DraftIndex {
  readonly slots: Slot[] = [];
  private byOverall = new Map<string, Slot>();
  private byYearRound = new Map<string, Slot[]>();
  private byName = new Map<string, Slot[]>();
  private byKey = new Map<string, Slot>();
  private bbByOverall = new Map<string, DraftRow>();
  private bbById = new Map<string, DraftRow[]>();

  constructor(draft: DraftInput, disputes: ChainDispute[]) {
    for (const row of draft.wiki) {
      if (!(row.year > 0) || !(row.round > 0)) continue;
      const chain = crossChecked(row, draft.espn, disputes);
      const slot: Slot = { row, chain, original: chain[0] ?? row.teamFranchise, key: null };
      this.slots.push(slot);
      this.byOverall.set(`${row.year}-${row.overall}`, slot);
      push(this.byYearRound, `${row.year}-${row.round}`, slot);
      push(this.byName, `${row.year}|${normalizePersonName(row.name)}`, slot);
    }
    for (const r of draft.bbref) {
      this.bbByOverall.set(`${r.year}-${r.overall}`, r);
      if (r.bbrefId) push(this.bbById, r.bbrefId, r);
    }
  }

  atOverall(year: number, overall: number): Slot | undefined {
    return this.byOverall.get(`${year}-${overall}`);
  }

  inRound(year: number, round: number): Slot[] {
    return this.byYearRound.get(`${year}-${round}`) ?? [];
  }

  withKey(key: string): Slot | null {
    return this.byKey.get(key) ?? null;
  }

  /**
   * Keys the slots. Wikipedia only writes "(from X)" on acquired picks, and not always (a team with three 1978
   * 3rd-rounders may show no origin on any), so a chainless row's own-pick default is checked against the stored
   * parts naming its selection (see origin). Rows that still claim the same pick are ranked: a stated chain, then a
   * stated original, then the default; a sole best claim keeps the key, every other claim (and a tie) is left
   * unkeyed for an override rather than guessed.
   */
  settle(evidence: Map<Slot, Evidence[]>): void {
    const rank = new Map<Slot, number>();
    const groups = new Map<string, Slot[]>();
    for (const s of this.slots) {
      const o = s.chain.length === 0 ? origin(evidence.get(s) ?? [], s.row.teamFranchise) : undefined;
      if (o !== undefined) s.original = o;
      rank.set(s, s.chain.length > 0 ? 2 : o != null ? 1 : 0);
      if (s.original != null) push(groups, pickKey(s.row.year, s.row.round, s.original), s);
    }
    for (const [key, group] of groups) {
      const top = Math.max(...group.map((s) => rank.get(s)!));
      const best = group.filter((s) => rank.get(s) === top);
      if (best.length !== 1) continue;
      best[0].key = key;
      this.byKey.set(key, best[0]);
    }
  }

  /** The Clippers' BBRef draft row at a slot (their selection), if any. */
  bbrefAt(slot: Slot): DraftRow | undefined {
    return this.bbByOverall.get(`${slot.row.year}-${slot.row.overall}`);
  }

  /** The draft row that selected this person in this year: undefined when none, null when several match. */
  selection(sel: PersonRef, year: number): Slot | null | undefined {
    const bb = sel.bbrefId ? this.bbById.get(sel.bbrefId)?.find((r) => r.year === year) : undefined;
    const viaBbref = bb && this.atOverall(bb.year, bb.overall);
    if (viaBbref) return viaBbref;
    const hits = this.byName.get(`${year}|${normalizePersonName(sel.name)}`) ?? [];
    return hits.length === 1 ? hits[0] : hits.length > 1 ? null : undefined;
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Every team that held the pick, in order: earlier owners, the drafting team, draft-day destinations. */
function owners(s: Slot): FranchiseId[] {
  return [...s.chain, s.row.teamFranchise, ...s.row.tradedTo];
}

// ---- BBRef notes -----------------------------------------------------------------

interface NoteFact {
  year: number | null;
  round: number | null;
  /** "is TEAM own" / "became TEAM YYYY Nth-rd pick": the pick's original franchise. */
  own: FranchiseId | null;
  swap: boolean;
  notExercised: boolean;
  /** Did not convey / rescinded. */
  dead: boolean;
}

const PICK_PHRASE = String.raw`(\d{4}) (\d)(?:st|nd|rd|th)-r?d (?:draft )?picks?`;
const NOTE_HEAD = new RegExp(String.raw`^\(?(?:(?:conditional|condition|right to swap) )?${PICK_PHRASE}`, 'i');
const NOTE_OWN = /^\s*(?:\(([A-Z]{2,3}) own\)\s*)?(?:(?:is|was)\s+([A-Z]{2,3})(?:'s)? own\b)?/;
const NOTE_BECAME = new RegExp(String.raw`\bbecame ([A-Z]{2,3}) ${PICK_PHRASE}`);

export function readNote(note: string): NoteFact | null {
  const s = note.trim();
  const head = NOTE_HEAD.exec(s);
  const year = head ? Number(head[1]) : null;
  const round = head ? Number(head[2]) : null;
  const rest = head ? s.slice(head[0].length) : s;
  let own: FranchiseId | null = null;
  if (head) {
    const o = NOTE_OWN.exec(rest);
    const code = o?.[1] ?? o?.[2];
    if (code) own = teamCode(code);
    const b = NOTE_BECAME.exec(rest);
    if (!own && b && Number(b[2]) === year && Number(b[3]) === round) own = teamCode(b[1]);
  }
  const swap = /\bswap\b/i.test(s) && (head != null || /^\(?swap\b/i.test(s));
  const notExercised = swap && /not exercised|did not convey/i.test(s);
  const dead = !swap && /did not convey|not conveyed|rescinded/i.test(s);
  if (!own && !swap && !dead) return null;
  return { year, round, own, swap, notExercised, dead };
}

const identified = (p: MovePart) => p.kind === 'pick' && !!p.pick && !p.pick.vague && p.pick.year > 0 && p.pick.round > 0;

function removePart(m: MergedMove, i: number): void {
  m.parts.splice(i, 1);
  m.conflicts = m.conflicts
    .filter((c) => c.partIndex !== i)
    .map((c) => (c.partIndex != null && c.partIndex > i ? { ...c, partIndex: c.partIndex - 1 } : c));
}

/**
 * Applies a move's notes in place: fills originals, turns swap-noted pick parts into swaps (dropping one the move
 * already lists as a swap), and records dead parts and the swap keys a note says weren't exercised.
 */
function applyNotes(m: MergedMove, dead: Set<MovePart>, notExercised: Set<string>): void {
  const facts = (m.notes ?? []).map(readNote).filter((f): f is NoteFact => f != null);
  if (facts.length === 0) return;
  const yr = (p: MovePart, f: NoteFact) => f.year == null || (p.pick!.year === f.year && p.pick!.round === f.round);

  // Originals: notes naming a team the part already carries are used up; one note left for one bare part fills it.
  const named = new Map<string, FranchiseId[]>();
  for (const f of facts) if (f.own && f.year != null) push(named, `${f.year}-${f.round}`, f.own);
  for (const [k, teams] of named) {
    const left = [...teams];
    const bare: MovePart[] = [];
    for (const p of m.parts.filter(identified)) {
      if (`${p.pick!.year}-${p.pick!.round}` !== k) continue;
      const i = p.pick!.originalFranchiseId == null ? -1 : left.indexOf(p.pick!.originalFranchiseId);
      if (i >= 0) left.splice(i, 1);
      else if (p.pick!.originalFranchiseId == null) bare.push(p);
    }
    if (left.length === 1 && bare.length === 1) bare[0].pick!.originalFranchiseId = left[0];
  }

  for (const f of facts) {
    if (!f.swap && !f.dead) continue;
    const others = f.year == null ? [] : (named.get(`${f.year}-${f.round}`) ?? []).filter((t) => t !== f.own);
    const targets = m.parts.filter((p) =>
      p.kind === 'pick' && p.pick && (f.year == null || identified(p)) && yr(p, f) &&
      (f.own ? p.pick.originalFranchiseId === f.own : !others.includes(p.pick.originalFranchiseId ?? -1)));
    if (f.dead) {
      if (targets.length === 1) dead.add(targets[0]);
      continue;
    }
    const target = targets.length === 1 ? targets[0] : undefined;
    let key: string | null = null;
    if (target && target.from != null && target.to != null && target.pick!.year > 0 && target.pick!.round > 0) {
      const { year, round } = target.pick!;
      key = swapKey(year, round, target.from, target.to);
      const existing = m.parts.find((p) => p.swap && p.swap.year === year && p.swap.round === round &&
        swapKey(year, round, p.swap.franchiseA, p.swap.franchiseB) === key);
      if (existing) removePart(m, m.parts.indexOf(target));
      else {
        target.kind = 'swap';
        target.swap = { year, round, franchiseA: target.from, franchiseB: target.to };
        delete target.pick;
      }
    } else if (!target) {
      const swaps = m.parts.filter((p) => p.swap && p.swap.year > 0 && (f.year == null || (p.swap.year === f.year && p.swap.round === f.round)));
      if (swaps.length === 1) key = swapKey(swaps[0].swap!.year, swaps[0].swap!.round, swaps[0].swap!.franchiseA, swaps[0].swap!.franchiseB);
    }
    if (key && f.notExercised) notExercised.add(key);
  }
}

// ---- accumulating rows -------------------------------------------------------------

interface PickAcc {
  year: number;
  round: number;
  original: FranchiseId;
  slot: Slot | null;
  protections: Array<{ protections: Protection[]; text: string } | 'unknown'>;
  dead: boolean;
  /** A BBRef id for the selected person, from the trade part that linked by selection. */
  selectedBbrefId: string | null;
}

function protectionOf(text: string | undefined): { protections: Protection[]; text: string } | 'unknown' {
  return (text && parseProtections(text)) || 'unknown';
}

/** Known only when some source states it and no two stated readings differ. */
function settleProtections(list: PickAcc['protections']): { protections: Protection[] | null; protectionsText: string | null; protectionsKnown: boolean } {
  const known = list.filter((x): x is { protections: Protection[]; text: string } => x !== 'unknown');
  const texts = new Set(known.map((k) => k.text));
  if (known.length === 0 || texts.size > 1) return { protections: null, protectionsText: null, protectionsKnown: false };
  return { protections: known[0].protections, protectionsText: known[0].text, protectionsKnown: true };
}

function personKeyOrNull(name: string, bbrefId: string | null, year: number): string | null {
  try {
    return personKey({ name, ...(bbrefId ? { bbrefId } : {}) }, year);
  } catch {
    return null; // a name that normalizes to nothing
  }
}

function clone(m: MergedMove): MergedMove {
  return {
    ...m,
    parts: m.parts.map((p) => ({
      ...p,
      ...(p.person ? { person: { ...p.person } } : {}),
      ...(p.pick ? { pick: { ...p.pick, ...(p.pick.selected ? { selected: { ...p.pick.selected } } : {}) } } : {}),
      ...(p.swap ? { swap: { ...p.swap } } : {}),
    })),
    conflicts: m.conflicts.map((c) => ({ ...c, readings: [...c.readings] })),
    ...(m.notes ? { notes: [...m.notes] } : {}),
  };
}

// ---- entry -------------------------------------------------------------------------

export function buildPicks(moves: MergedMove[], draft: DraftInput, currentDraftYear: number): PicksResult {
  const disputes: ChainDispute[] = [];
  const index = new DraftIndex(draft, disputes);
  const accs = new Map<string, PickAcc>();
  const acc = (year: number, round: number, original: FranchiseId): PickAcc => {
    const key = pickKey(year, round, original);
    let a = accs.get(key);
    if (!a) {
      a = { year, round, original, slot: index.withKey(key), protections: [], dead: false, selectedBbrefId: null };
      accs.set(key, a);
    }
    return a;
  };

  // Notes first (they fill originals), then the parts that name a selection settle which draft row is which pick.
  const out = moves.map(clone);
  const dead = new Set<MovePart>();
  const notExercised = new Set<string>();
  const evidence = new Map<Slot, Evidence[]>();
  for (const m of out) {
    applyNotes(m, dead, notExercised);
    for (const p of m.parts) {
      const sel = identified(p) && p.pick!.selected ? index.selection(p.pick!.selected, p.pick!.year) : undefined;
      if (sel && sel.row.round === p.pick!.round) push(evidence, sel, { date: m.date, orig: p.pick!.originalFranchiseId ?? null, from: p.from });
    }
  }
  index.settle(evidence);

  // Picks the Clippers owned, held or selected, by the draft pages and BBRef's list of their selections.
  const unkeyed = new Set<Slot>();
  const clippers = (s: Slot) => {
    if (s.key) acc(s.row.year, s.row.round, s.original!);
    else unkeyed.add(s);
  };
  for (const s of index.slots) if (s.chain.includes(LAC) || s.row.teamFranchise === LAC || s.row.tradedTo.includes(LAC)) clippers(s);
  for (const r of draft.bbref) {
    const s = index.atOverall(r.year, r.overall);
    if (s) clippers(s);
  }
  for (let year = currentDraftYear; year < currentDraftYear + FUTURE_DRAFTS; year++) for (const round of [1, 2]) acc(year, round, LAC);
  const forfeited = new Set<string>();
  for (const f of draft.forfeited ?? []) {
    if (f.round == null || !(f.round > 0)) continue;
    forfeited.add(pickKey(f.year, f.round, f.teamFranchise));
    if (f.teamFranchise === LAC) acc(f.year, f.round, LAC);
  }

  // Trade parts.
  const hops = new Map<string, MovePart[]>();
  const swapAccs = new Map<string, { a: FranchiseId; b: FranchiseId; year: number; round: number; protections: PickAcc['protections'] }>();
  for (const m of out) {
    for (const p of m.parts) {
      if (p.kind === 'pick' && p.pick) linkPick(p);
      else if (p.kind === 'swap' && p.swap) linkSwap(p);
      if (p.pickKey) push(hops, p.pickKey, p);
    }
    m.complete = m.parts.every((p) => !p.gap) && m.conflicts.length === 0;
  }

  function linkPick(p: MovePart): void {
    const pick = p.pick!;
    let a: PickAcc | null = null;
    if (identified(p)) {
      const { year, round } = pick;
      const sel = pick.selected ? index.selection(pick.selected, year) : undefined;
      if (sel && sel.row.round === round) {
        if (!sel.key) {
          if (!p.gap) p.gap = 'pick_unidentified'; // the draft row's pick couldn't be settled (see settle)
          unkeyed.add(sel);
          return;
        }
        if (pick.originalFranchiseId != null && pick.originalFranchiseId !== sel.original) {
          p.gap = 'source_conflict';
          return;
        }
        a = acc(year, round, sel.original!);
        if (pick.selected?.bbrefId && !a.selectedBbrefId) a.selectedBbrefId = pick.selected.bbrefId;
      } else if (pick.originalFranchiseId != null) {
        a = acc(year, round, pick.originalFranchiseId);
      } else if (!pick.selected && year < currentDraftYear && p.from != null && p.to != null) {
        const fits = index.inRound(year, round).filter((s) => {
          const o = owners(s);
          const i = o.indexOf(p.from!);
          return i >= 0 && o.indexOf(p.to!, i + 1) > i;
        });
        if (fits.length === 1 && fits[0].key) a = acc(year, round, fits[0].original!);
      }
    }
    if (!a) {
      if (!p.gap) p.gap = 'pick_unidentified';
      return;
    }
    p.pickKey = pickKey(a.year, a.round, a.original);
    a.protections.push(protectionOf(pick.protectionsText));
    if (dead.has(p)) a.dead = true;
  }

  function linkSwap(p: MovePart): void {
    const s = p.swap!;
    if (!(s.year > 0) || !(s.round > 0) || s.franchiseA == null || s.franchiseB == null || s.franchiseA === s.franchiseB) return;
    const key = swapKey(s.year, s.round, s.franchiseA, s.franchiseB);
    p.swapKey = key;
    let sa = swapAccs.get(key);
    if (!sa) swapAccs.set(key, (sa = { a: s.franchiseA, b: s.franchiseB, year: s.year, round: s.round, protections: [] }));
    sa.protections.push(protectionOf(s.protectionsText));
  }

  // Rows.
  const picks: PickRow[] = [];
  for (const [key, a] of accs) {
    const s = a.slot;
    let status: PickStatus | null = null;
    if (s) status = 'used';
    else if (forfeited.has(key)) status = 'forfeited';
    else if (a.dead) status = 'extinguished';
    else if (a.year >= currentDraftYear) status = 'future';
    const bbrefId = s ? (index.bbrefAt(s)?.bbrefId ?? a.selectedBbrefId) : null;
    picks.push({
      pickKey: key,
      year: a.year,
      round: a.round,
      originalFranchiseId: a.original,
      ...settleProtections(a.protections),
      status,
      overall: s ? s.row.overall : null,
      selectedPersonKey: s ? personKeyOrNull(s.row.name, bbrefId, a.year) : null,
      finalOwnerFranchiseId: s ? (s.row.tradedTo.at(-1) ?? s.row.teamFranchise) : null,
    });
  }
  picks.sort((x, y) => x.year - y.year || x.round - y.round || x.pickKey.localeCompare(y.pickKey));

  const swaps: SwapRow[] = [...swapAccs].map(([key, s]) => ({
    swapKey: key,
    year: s.year,
    round: s.round,
    franchiseA: s.a,
    franchiseB: s.b,
    ...settleProtections(s.protections),
    exercised: notExercised.has(key) ? false : null,
  }));
  swaps.sort((x, y) => x.year - y.year || x.swapKey.localeCompare(y.swapKey));

  const breaks: ChainBreak[] = [];
  for (const s of index.slots) if (s.row.teamFranchise === LAC && s.key) breaks.push(...traceChain(s, s.key, hops.get(s.key) ?? []));
  const unkeyedRows = [...unkeyed].map(({ row }) => ({ year: row.year, round: row.round, overall: row.overall, name: row.name, teamFranchise: row.teamFranchise }));
  return { picks, swaps, moves: out, breaks, disputes, unkeyed: unkeyedRows };
}

/**
 * Every Clippers selection must trace from its original team to the Clippers through stored parts. Walks back from
 * the Clippers along stored parts; where none arrives, the hop is reported from the chain's previous unvisited team
 * (Wikipedia lists "via" teams, not always in order) and the walk carries on from there.
 */
function traceChain(s: Slot, key: string, parts: MovePart[]): ChainBreak[] {
  const original = s.original!; // a keyed slot always has one
  const out: ChainBreak[] = [];
  const visited = new Set<FranchiseId>([LAC]);
  let cur: FranchiseId = LAC;
  while (cur !== original) {
    const stored = parts.find((p) => p.to === cur && p.from != null && !visited.has(p.from));
    let prev: FranchiseId;
    if (stored) prev = stored.from!;
    else {
      const at = s.chain.indexOf(cur);
      const before = (at >= 0 ? s.chain.slice(0, at) : s.chain).filter((t) => !visited.has(t));
      prev = before.at(-1) ?? original;
      out.push({ pickKey: key, missingHop: [prev, cur] });
    }
    visited.add(prev);
    cur = prev;
  }
  return out;
}
