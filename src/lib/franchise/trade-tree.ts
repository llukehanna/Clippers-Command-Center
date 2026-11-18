// src/lib/franchise/trade-tree.ts
// Builds a trade page's sides and its "What it became" outline from rows the
// loader (src/lib/data/franchise-trade.ts) already fetched. Pure: no I/O, and it
// never fetches anything at request time (spec §4.3).
//
// Each asset of the trade is a row that expands into its next event:
//   - a player becomes their next move (trade, signing, waiver, …);
//   - a pick becomes its next trade, then the player drafted with it;
//   - a swap becomes its next trade.
// After `depth` steps a row stops with `truncatedAt` = the trade page to
// continue on. Unknowns are notes, never guesses: "no further record",
// "traded on to T (details not recorded)", "protections not recorded".

import type {
  FranchisePersonRef, FranchiseTeamRef, TradeAsset, TradeAssetKind, TradeSide, TreeNode,
} from '@/src/lib/ui/types';
import { CLIPPERS_FRANCHISE_ID, staticTeam, teamFullName } from './franchise-ids';
import { protectionsLabel } from './protections-text';

export type { TradeAsset, TradeSide, TreeNode };

export interface TreeTxn {
  transaction_id: string;
  slug: string;
  date: string | null;
  season_id: number | null;
  kind: string;
  involves_clippers: boolean;
}

export interface TreePart {
  transaction_id: string;
  from_franchise_id: number | null;
  to_franchise_id: number | null;
  asset_kind: string;
  person_key: string | null;
  pick_id: number | null;
  swap_id: number | null;
  unlinked_text: string | null;
  gap_reason: string | null;
}

export interface TreePick {
  pick_id: number;
  pick_key: string;
  draft_year: number;
  round: number;
  original_franchise_id: number;
  protections: unknown | null;
  protections_text: string | null;
  protections_known: boolean | null;
  status: string | null;
  overall_pick: number | null;
  selected_person: string | null;
  final_owner_franchise_id: number | null;
}

export interface TreeSwap {
  swap_id: number;
  swap_key: string;
  draft_year: number;
  round: number;
  franchise_a: number;
  franchise_b: number;
  protections_text: string | null;
  protections_known: boolean | null;
  exercised: boolean | null;
}

export interface TreePerson {
  person_key: string;
  display_name: string;
  player_id: string | null;
  /** person_xref's, else the linked player's; null when unknown. */
  nba_person_id?: number | string | null;
}

/** Era team of a franchise in a season (null season = latest). */
export type TeamLookup = (franchiseId: number, seasonId: number | null) => FranchiseTeamRef;

export interface TreeRows {
  /** The root trade and every later move of its assets. */
  transactions: TreeTxn[];
  /** All parts of those transactions. */
  parts: TreePart[];
  picks: TreePick[];
  swaps: TreeSwap[];
  people: TreePerson[];
  /** Defaults to the static current team names. */
  team?: TeamLookup;
}

// ─── Gap notes ───────────────────────────────────────────────────────────────

export const GAP_NOTES: Record<string, string> = {
  pick_unidentified: 'pick not identified',
  protections_unknown: 'protections not recorded',
  source_conflict: 'sources disagree',
  person_unmatched: 'player not identified',
  party_unknown: 'team not recorded',
};

/** Quiet note for a part's gap code; unknown codes still get a note, never an error. */
export function gapNote(reason: string | null): string | null {
  if (!reason) return null;
  return GAP_NOTES[reason] ?? 'details not recorded';
}

// ─── Labels ──────────────────────────────────────────────────────────────────

/** Season whose team names a pick uses: the draft concludes season draft_year - 1. */
export const pickSeason = (draftYear: number) => draftYear - 1;

function roundWord(round: number): string {
  return round === 1 ? 'first-round' : round === 2 ? 'second-round' : `round-${round}`;
}

export function pickLabel(year: number, round: number): string {
  return `${year} ${roundWord(round)} pick`;
}

export function swapLabel(year: number, round: number): string {
  return `${year} ${roundWord(round)} swap`;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export const tradeHref = (slug: string) => `/franchise/trades/${slug}`;
export const playerHref = (playerId: string | null) => (playerId ? `/players/${playerId}` : null);

/** Every (franchise, season) the builder will ask the team lookup for, so the loader can resolve them in one query. */
export function treeTeamKeys(rows: Omit<TreeRows, 'team'>): Array<[number, number | null]> {
  const season = new Map(rows.transactions.map((t) => [t.transaction_id, t.season_id]));
  const keys: Array<[number, number | null]> = [];
  for (const p of rows.parts) {
    const s = season.get(p.transaction_id) ?? null;
    if (p.from_franchise_id != null) keys.push([p.from_franchise_id, s]);
    if (p.to_franchise_id != null) keys.push([p.to_franchise_id, s]);
  }
  for (const p of rows.picks) {
    keys.push([p.original_franchise_id, pickSeason(p.draft_year)]);
    if (p.final_owner_franchise_id != null) keys.push([p.final_owner_franchise_id, pickSeason(p.draft_year)]);
  }
  for (const s of rows.swaps) {
    keys.push([s.franchise_a, pickSeason(s.draft_year)], [s.franchise_b, pickSeason(s.draft_year)]);
  }
  return keys;
}

// ─── Context ─────────────────────────────────────────────────────────────────

interface Event { txn: TreeTxn; part: TreePart }
interface Cursor { date: string | null; id: number }

type State =
  | { type: 'person'; key: string }
  | { type: 'pick'; pick: TreePick; holder: number | null }
  | { type: 'swap'; swap: TreeSwap }
  | { type: 'end' };

interface Step { node: TreeNode; state: State; cursor: Cursor; tradeSlug: string | null }

class Ctx {
  readonly txns = new Map<string, TreeTxn>();
  readonly partsByTxn = new Map<string, TreePart[]>();
  readonly picks: Map<number, TreePick>;
  readonly swaps: Map<number, TreeSwap>;
  readonly people: Map<string, TreePerson>;
  private readonly lookup: TeamLookup;

  constructor(rows: TreeRows) {
    for (const t of rows.transactions) this.txns.set(t.transaction_id, t);
    for (const p of rows.parts) {
      const list = this.partsByTxn.get(p.transaction_id) ?? [];
      list.push(p);
      this.partsByTxn.set(p.transaction_id, list);
    }
    this.picks = new Map(rows.picks.map((p) => [p.pick_id, p]));
    this.swaps = new Map(rows.swaps.map((s) => [s.swap_id, s]));
    this.people = new Map(rows.people.map((p) => [p.person_key, p]));
    this.lookup = rows.team ?? ((f) => staticTeam(f));
  }

  team(franchiseId: number | null, seasonId: number | null): FranchiseTeamRef | null {
    return franchiseId == null ? null : this.lookup(franchiseId, seasonId);
  }

  person(key: string, fallback: string | null): FranchisePersonRef {
    const p = this.people.get(key);
    const playerId = p?.player_id ?? null;
    const nba = p?.nba_person_id == null ? null : Number(p.nba_person_id);
    return {
      person_key: key,
      name: p?.display_name ?? fallback ?? key,
      player_id: playerId,
      nba_person_id: nba != null && Number.isFinite(nba) ? nba : null,
      href: playerHref(playerId),
    };
  }

  /** Moves touching an asset, in date order, one per transaction. */
  events(match: (p: TreePart) => boolean): Event[] {
    const out: Event[] = [];
    for (const [id, parts] of this.partsByTxn) {
      const txn = this.txns.get(id);
      const part = parts.find(match);
      if (txn && part && txn.date) out.push({ txn, part });
    }
    return out.sort((a, b) =>
      a.txn.date! < b.txn.date! ? -1 : a.txn.date! > b.txn.date! ? 1 : Number(a.txn.transaction_id) - Number(b.txn.transaction_id));
  }

  /** The first move of an asset strictly after the cursor. */
  next(match: (p: TreePart) => boolean, cursor: Cursor): Event | null {
    if (!cursor.date) return null; // an undated move cannot be ordered against later ones
    return this.events(match).find(({ txn }) =>
      txn.date! > cursor.date! || (txn.date === cursor.date && Number(txn.transaction_id) > cursor.id)) ?? null;
  }

  assetLabel(part: TreePart): string {
    const kind = part.asset_kind;
    if ((kind === 'player' || kind === 'draft_rights') && part.person_key) {
      const name = this.person(part.person_key, part.unlinked_text).name;
      return kind === 'draft_rights' ? `Draft rights to ${name}` : name;
    }
    if (kind === 'pick' && part.pick_id != null) {
      const pick = this.picks.get(part.pick_id);
      if (pick) {
        const base = pickLabel(pick.draft_year, pick.round);
        if (pick.original_franchise_id === part.from_franchise_id) return base;
        const orig = this.team(pick.original_franchise_id, pickSeason(pick.draft_year));
        return orig?.abbreviation ? `${base} (${orig.abbreviation})` : base;
      }
    }
    if (kind === 'swap' && part.swap_id != null) {
      const swap = this.swaps.get(part.swap_id);
      if (swap) return swapLabel(swap.draft_year, swap.round);
    }
    if (part.unlinked_text) return part.unlinked_text;
    return { player: 'Player', draft_rights: 'Draft rights', pick: 'Pick', swap: 'Pick swap', cash: 'Cash', exception: 'Trade exception' }[kind] ?? 'Other';
  }

  eventLabel(txn: TreeTxn, part: TreePart): string {
    const s = txn.season_id;
    const to = teamFullName(this.team(part.to_franchise_id, s));
    const from = teamFullName(this.team(part.from_franchise_id, s));
    switch (txn.kind) {
      case 'trade': {
        const base = part.to_franchise_id != null ? `Traded to ${to}` : 'Traded';
        const back = part.from_franchise_id == null ? [] : (this.partsByTxn.get(txn.transaction_id) ?? [])
          .filter((p) => p !== part && p.to_franchise_id === part.from_franchise_id)
          .map((p) => this.assetLabel(p));
        return back.length ? `${base} for ${joinList(back)}` : base;
      }
      case 'waiver': return `Waived by ${from}`;
      case 'release': return `Released by ${from}`;
      case 'claim': return `Claimed by ${to}`;
      case 'signing': return `Signed with ${to}`;
      case 're_signing': return `Re-signed with ${to}`;
      case 'extension': return `Signed an extension with ${to}`;
      case 'two_way': return `Signed a two-way contract with ${to}`;
      case 'ten_day': return `Signed a 10-day contract with ${to}`;
      case 'conversion': return `Converted to a standard contract with ${to}`;
      case 'draft': return `Drafted by ${to}`;
      case 'expansion_draft': return `Taken by ${to} in the expansion draft`;
      case 'retirement': return 'Retired';
      default: {
        const kind = txn.kind.replace(/_/g, ' ');
        const word = kind.charAt(0).toUpperCase() + kind.slice(1);
        const team = part.to_franchise_id != null ? to : part.from_franchise_id != null ? from : null;
        return team ? `${word} (${team})` : word;
      }
    }
  }
}

function nodeKind(assetKind: string): TreeNode['kind'] {
  if (assetKind === 'player' || assetKind === 'draft_rights') return 'player';
  if (assetKind === 'pick' || assetKind === 'swap' || assetKind === 'cash') return assetKind;
  return 'other';
}

function addNote(node: TreeNode, note: string | null) {
  if (!note || node.note?.split(' · ').includes(note)) return;
  node.note = node.note ? `${node.note} · ${note}` : note;
}

const cursorOf = (txn: TreeTxn): Cursor => ({ date: txn.date, id: Number(txn.transaction_id) });

// ─── Steps ───────────────────────────────────────────────────────────────────

function eventStep(ctx: Ctx, ev: Event, state: State, kind: TreeNode['kind']): Step {
  return {
    node: {
      label: ctx.eventLabel(ev.txn, ev.part),
      kind,
      href: ev.txn.kind === 'trade' ? tradeHref(ev.txn.slug) : null,
      note: gapNote(ev.part.gap_reason),
      children: [],
      truncatedAt: null,
      person: ev.part.person_key ? ctx.person(ev.part.person_key, null) : null,
      date: ev.txn.date,
      team: ctx.team(ev.part.to_franchise_id, ev.txn.season_id),
    },
    state,
    cursor: cursorOf(ev.txn),
    tradeSlug: ev.txn.kind === 'trade' ? ev.txn.slug : null,
  };
}

function draftedStep(ctx: Ctx, pick: TreePick): Step {
  const owner = ctx.team(pick.final_owner_franchise_id, pickSeason(pick.draft_year));
  const where = pick.overall_pick != null ? `No. ${pick.overall_pick}, ${pick.draft_year}` : `${pick.draft_year}`;
  const person = pick.selected_person ? ctx.person(pick.selected_person, null) : null;
  return {
    node: {
      label: person ? `Drafted ${person.name} (${where})` : `Used in the ${pick.draft_year} draft${pick.overall_pick != null ? ` (No. ${pick.overall_pick})` : ''}`,
      kind: person ? 'player' : 'pick',
      href: person?.href ?? null,
      note: person ? null : 'player not recorded',
      children: [],
      truncatedAt: null,
      person,
      date: null,
      team: owner,
    },
    state: person ? { type: 'person', key: person.person_key } : { type: 'end' },
    // The draft is in late June; later moves of the player follow it.
    cursor: { date: `${pick.draft_year}-06-01`, id: -1 },
    tradeSlug: null,
  };
}

/** The next step of an asset, plus a note that belongs on the current row (a pick that moved on unrecorded). */
function nextStep(ctx: Ctx, state: State, cursor: Cursor): { step: Step | null; note: string | null; terminal: string | null } {
  switch (state.type) {
    case 'person': {
      const ev = ctx.next((p) => p.person_key === state.key, cursor);
      return ev
        ? { step: eventStep(ctx, ev, state, 'player'), note: null, terminal: null }
        : { step: null, note: null, terminal: 'no further record' };
    }
    case 'pick': {
      const { pick } = state;
      const ev = ctx.next((p) => p.pick_id === pick.pick_id, cursor);
      if (ev) {
        return { step: eventStep(ctx, ev, { type: 'pick', pick, holder: ev.part.to_franchise_id }, 'pick'), note: null, terminal: null };
      }
      const owner = pick.final_owner_franchise_id;
      const tradedOn = owner != null && state.holder != null && owner !== state.holder
        ? `traded on to ${teamFullName(ctx.team(owner, pickSeason(pick.draft_year)))} (details not recorded)`
        : null;
      if (pick.status === 'used') return { step: draftedStep(ctx, pick), note: tradedOn, terminal: null };
      const terminal = tradedOn ? null : ({
        future: 'not yet drafted',
        conveyed_as_other: 'converted to another pick',
        extinguished: 'not conveyed',
        forfeited: 'forfeited',
      } as Record<string, string>)[pick.status ?? ''] ?? 'no further record';
      return { step: null, note: tradedOn, terminal };
    }
    case 'swap': {
      const { swap } = state;
      const ev = ctx.next((p) => p.swap_id === swap.swap_id, cursor);
      if (ev) return { step: eventStep(ctx, ev, state, 'swap'), note: null, terminal: null };
      const terminal = swap.exercised === true ? 'swap exercised' : swap.exercised === false ? 'swap not exercised' : 'swap not yet decided';
      return { step: null, note: null, terminal };
    }
    case 'end':
      return { step: null, note: null, terminal: null };
  }
}

function extend(ctx: Ctx, node: TreeNode, state: State, cursor: Cursor, trades: string[], level: number, maxDepth: number) {
  const { step, note, terminal } = nextStep(ctx, state, cursor);
  addNote(node, note);
  if (!step) {
    addNote(node, terminal);
    return;
  }
  if (level >= maxDepth) {
    node.truncatedAt = step.tradeSlug ?? trades[trades.length - 1] ?? null;
    if (!node.truncatedAt) addNote(node, 'further moves not shown');
    return;
  }
  node.children.push(step.node);
  extend(ctx, step.node, step.state, step.cursor, step.tradeSlug ? [...trades, step.tradeSlug] : trades, level + 1, maxDepth);
}

// ─── Sides ───────────────────────────────────────────────────────────────────

function toAsset(ctx: Ctx, part: TreePart, root: TreeTxn, counterpartyId: number | null): TradeAsset {
  const s = root.season_id;
  const person = part.person_key ? ctx.person(part.person_key, part.unlinked_text) : null;
  const pick = part.pick_id != null ? ctx.picks.get(part.pick_id) ?? null : null;
  const swap = part.swap_id != null ? ctx.swaps.get(part.swap_id) ?? null : null;
  return {
    kind: (['player', 'draft_rights', 'pick', 'swap', 'cash', 'exception'].includes(part.asset_kind) ? part.asset_kind : 'other') as TradeAssetKind,
    label: ctx.assetLabel(part),
    href: person?.href ?? null,
    person,
    pick: pick && {
      pick_key: pick.pick_key,
      draft_year: pick.draft_year,
      round: pick.round,
      original_team: ctx.team(pick.original_franchise_id, pickSeason(pick.draft_year))!,
      overall_pick: pick.overall_pick,
      status: pick.status,
      protections_known: pick.protections_known,
      protections_text: pick.protections_text,
      protections_label: protectionsLabel(pick),
    },
    swap: swap && {
      swap_key: swap.swap_key,
      draft_year: swap.draft_year,
      round: swap.round,
      teams: [swap.franchise_a, swap.franchise_b].map((f) => ctx.team(f, pickSeason(swap.draft_year))!),
      exercised: swap.exercised,
      protections_known: swap.protections_known,
      protections_text: swap.protections_text,
      protections_label: protectionsLabel(swap),
    },
    counterparty: ctx.team(counterpartyId, s),
    gap_reason: part.gap_reason,
    gap_note: gapNote(part.gap_reason),
  };
}

/** Franchises in the order they appear, Clippers first. */
export function sideOrder(parts: TreePart[]): number[] {
  const order: number[] = [];
  for (const p of parts) {
    for (const f of [p.from_franchise_id, p.to_franchise_id]) if (f != null && !order.includes(f)) order.push(f);
  }
  return [...order.filter((f) => f === CLIPPERS_FRANCHISE_ID), ...order.filter((f) => f !== CLIPPERS_FRANCHISE_ID)];
}

// ─── Builder ─────────────────────────────────────────────────────────────────

export function buildTradeTree(rootSlug: string, rows: TreeRows, depth = 3): { sides: TradeSide[]; became: TreeNode[] } {
  const root = rows.transactions.find((t) => t.slug === rootSlug);
  if (!root) throw new Error(`buildTradeTree: no transaction with slug "${rootSlug}"`);
  const ctx = new Ctx(rows);
  const parts = ctx.partsByTxn.get(root.transaction_id) ?? [];
  const order = sideOrder(parts);

  const sides: TradeSide[] = order.map((f) => ({
    team: ctx.team(f, root.season_id)!,
    received: parts.filter((p) => p.to_franchise_id === f).map((p) => toAsset(ctx, p, root, p.from_franchise_id)),
    sent: parts.filter((p) => p.from_franchise_id === f).map((p) => toAsset(ctx, p, root, p.to_franchise_id)),
  }));

  // Outline rows follow the sides: what each team received, then parts with no receiver.
  const ordered = [
    ...order.flatMap((f) => parts.filter((p) => p.to_franchise_id === f)),
    ...parts.filter((p) => p.to_franchise_id == null),
  ];
  const became = ordered.map((part) => {
    const pick = part.pick_id != null ? ctx.picks.get(part.pick_id) ?? null : null;
    const swap = part.swap_id != null ? ctx.swaps.get(part.swap_id) ?? null : null;
    const node: TreeNode = {
      label: ctx.assetLabel(part),
      kind: nodeKind(part.asset_kind),
      href: part.person_key ? ctx.person(part.person_key, null).href : null,
      note: gapNote(part.gap_reason),
      children: [],
      truncatedAt: null,
      person: part.person_key ? ctx.person(part.person_key, part.unlinked_text) : null,
      date: null,
      team: ctx.team(part.to_franchise_id, root.season_id),
    };
    if (pick && pick.status === 'future' && pick.protections_known !== true) addNote(node, GAP_NOTES.protections_unknown);

    let state: State | null = null;
    if (part.person_key && (part.asset_kind === 'player' || part.asset_kind === 'draft_rights')) state = { type: 'person', key: part.person_key };
    else if (pick) state = { type: 'pick', pick, holder: part.to_franchise_id };
    else if (swap) state = { type: 'swap', swap };
    if (state) extend(ctx, node, state, cursorOf(root), [], 0, depth);
    return node;
  });

  return { sides, became };
}
