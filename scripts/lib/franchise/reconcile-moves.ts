// scripts/lib/franchise/reconcile-moves.ts
// Merges the same event seen by Basketball-Reference, Wikipedia and NBA.com into one record (spec §3.2).
//
// Two moves are the same event when the kinds agree, the dates are within 3 days, and they share a person going
// the same way (or, when both name nobody, an identified pick year + round going the same way). A shared person
// matched on name alone (the index couldn't connect the ids) never decides a merge by itself: it needs a second
// agreeing person or pick beside it. Each group has a base source:
// NBA.com from 2015-16 on (its GroupSort decides grouping), BBRef before; Wikipedia is never the base unless
// it stands alone. The base reading is kept; other sources fill what the base doesn't say (ids on people,
// pick details, the picks behind an NBA.com "draft consideration", the third team of a multi-team deal).
// Real disagreements keep the base reading, mark the part `source_conflict` and keep both readings in
// `conflicts`. A move no other source matches passes through on its own. Pure: no DB, no I/O.
import { NBA_TEAM_IDS, TRICODE_BY_NBA_ID } from '../nba-teams.js';
import { normalizePersonName } from '../player-match.js';
import { chooseTransactionKey } from './keys.js';
import { resolveRef, type PeopleIndex } from './people.js';
import type { FranchiseId, MoveKind, MovePart, ParsedMove, PersonRef } from './types.js';

const LAC = NBA_TEAM_IDS.LAC;
const NBA_ERA_START = '2015-07-01';
const WINDOW_DAYS = 3;

export interface MergedMove extends ParsedMove {
  sources: string[];
  transactionKey: string;
  /**
   * Disputed parts. `partIndex` is the merged part's index, or null for a part another source lists that the
   * base doesn't (the base reading, its absence, is kept, so there is no part to point at).
   */
  conflicts: Array<{ partIndex: number | null; readings: string[] }>;
}

export interface ReconcileInput {
  bbref: ParsedMove[];
  wiki: ParsedMove[];
  nba: ParsedMove[];
  /** People crosswalk used to tell whether two refs are the same person. */
  index: PeopleIndex;
}

type Source = 'nba' | 'bbref' | 'wiki';

// ---- helpers -----------------------------------------------------------------

function seasonOf(date: string): number {
  const y = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 7 ? y : y - 1;
}

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

function addDays(date: string, n: number): string {
  return new Date((dayNumber(date) + n) * 86_400_000).toISOString().slice(0, 10);
}

/** Lower is stronger. From 2015-16 on NBA.com decides grouping; before, BBRef is the base. */
function rank(source: Source, date: string): number {
  const order: Source[] = date >= NBA_ERA_START ? ['nba', 'bbref', 'wiki'] : ['bbref', 'nba', 'wiki'];
  return order.indexOf(source);
}

/** NBA.com writes re-signings separately; BBRef calls them signings. Every other kind must agree exactly. */
function kindFamily(k: MoveKind): string {
  return k === 're_signing' ? 'signing' : k;
}

/**
 * Contract kinds the sources label differently for one event: NBA.com files a two-way or 10-day deal as a plain
 * Signing, and an Exhibit 10 turned two-way as ContractConverted; BBRef names the contract. These match each other
 * only a day apart at most (kindsMatch), and the merged move takes BBRef's contract kind (mergeGroup).
 */
const CONTRACT_KINDS = new Set<MoveKind>(['signing', 're_signing', 'two_way', 'ten_day', 'conversion']);
const NAMED_CONTRACTS = new Set<MoveKind>(['two_way', 'ten_day', 'conversion']);

function kindsMatch(a: ParsedMove, b: ParsedMove): boolean {
  if (kindFamily(a.kind) === kindFamily(b.kind)) return true;
  return CONTRACT_KINDS.has(a.kind) && CONTRACT_KINDS.has(b.kind) && Math.abs(dayNumber(a.date) - dayNumber(b.date)) <= 1;
}

function team(id: FranchiseId | null): string {
  return id == null ? '?' : (TRICODE_BY_NBA_ID[id] ?? String(id));
}

const ORD = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

function describe(p: MovePart): string {
  let what: string;
  if (p.person) what = p.person.name;
  else if (p.pick) {
    what = p.pick.vague || !p.pick.year ? 'unidentified pick' : `${p.pick.year} ${ORD(p.pick.round)}-rd pick`;
    if (p.pick.originalFranchiseId != null) what += ` (orig ${team(p.pick.originalFranchiseId)})`;
    if (p.pick.selected) what += ` (${p.pick.selected.name} selected)`;
  } else if (p.swap) what = `${p.swap.year} ${ORD(p.swap.round)}-rd swap`;
  else what = p.text ?? p.kind;
  return `${what} ${team(p.from)}→${team(p.to)}`;
}

const identified = (p: MovePart) => p.kind === 'pick' && !!p.pick && !p.pick.vague && p.pick.year > 0 && p.pick.round > 0;
/** NBA.com's "draft consideration": a pick with no identity at all, waiting to be filled. */
const fillable = (p: MovePart) => p.kind === 'pick' && !p.pick && p.gap === 'pick_unidentified';

function clonePart(p: MovePart): MovePart {
  const c: MovePart = { ...p };
  if (p.person) c.person = { ...p.person };
  if (p.pick) c.pick = { ...p.pick, ...(p.pick.selected ? { selected: { ...p.pick.selected } } : {}) };
  if (p.swap) c.swap = { ...p.swap };
  return c;
}

function teamsOf(m: ParsedMove): Set<FranchiseId> {
  const s = new Set<FranchiseId>();
  for (const p of m.parts) {
    if (p.from != null) s.add(p.from);
    if (p.to != null) s.add(p.to);
  }
  return s;
}

// ---- people ------------------------------------------------------------------

interface Item {
  move: ParsedMove;
  source: Source;
  rank: number;
  /** Resolved key (or null) and normalized name for each part's person, by part index. */
  people: Array<Who | null>;
}

/**
 * `nbaVia`: for a BBRef key the index can't tie to an NBA.com id, the id a `person` override links it to
 * (PeopleIndex.nbaIdByBbref), else the id of the one `players` row carrying this name (nbaIdByUniqueDbName). It lets
 * that key match `nba:<id>` of the same name; a name two players share never links on its own.
 */
type Who = { key: string | null; name: string; nbaVia?: number };

function who(ref: PersonRef, index: PeopleIndex, season: number): Who {
  const key = resolveRef(ref, index, season);
  const name = normalizePersonName(ref.name);
  if (key && !key.startsWith('nba:') && index.byBbref.get(key)?.nbaPersonId == null) {
    const linked = index.nbaIdByBbref.get(key);
    if (linked != null) return { key, name, nbaVia: linked };
    const nbaVia = index.nbaIdByUniqueDbName.get(name);
    if (nbaVia != null && !index.byNbaId.has(nbaVia)) return { key, name, nbaVia };
  }
  return { key, name };
}

/** 'key': the index resolves both to one person. 'name': only the names agree (weak). false: different people. */
function personMatch(a: Who, b: Who): 'key' | 'name' | false {
  if (a.key && b.key) {
    if (a.key === b.key) return 'key';
    if (a.name !== '' && a.name === b.name && (a.key === `nba:${b.nbaVia}` || b.key === `nba:${a.nbaVia}`)) return 'key';
    // Two keys of the same kind (two BBRef ids, or two NBA ids) that differ are different people. A BBRef key
    // and an `nba:` key only differ because the index couldn't connect them, so the name may still agree.
    if (a.key.startsWith('nba:') === b.key.startsWith('nba:')) return false;
  }
  return a.name !== '' && a.name === b.name ? 'name' : false;
}

const samePerson = (a: Who, b: Who) => personMatch(a, b) !== false;

function makeItem(move: ParsedMove, source: Source, index: PeopleIndex): Item {
  const season = seasonOf(move.date);
  return {
    move,
    source,
    rank: rank(source, move.date),
    people: move.parts.map((p) => (p.person ? who(p.person, index, season) : null)),
  };
}

function mergePerson(base: PersonRef, other: PersonRef): void {
  if (!base.bbrefId && other.bbrefId) base.bbrefId = other.bbrefId;
  if (base.nbaPersonId == null && other.nbaPersonId != null) base.nbaPersonId = other.nbaPersonId;
}

// ---- matching ----------------------------------------------------------------

/** Same direction, where an unstated (null) end agrees with anything. */
function sameWay(x: MovePart, y: MovePart): boolean {
  return (x.from == null || y.from == null || x.from === y.from) && (x.to == null || y.to == null || x.to === y.to);
}

/**
 * How strongly two moves overlap; 0 = not the same event. Evidence is shared people when both name people, or
 * shared identified picks (year + round) when both name nobody; a move naming people never matches one that
 * doesn't. Only evidence that agrees on direction counts: a person who goes the other way is a different event.
 * At least one agreeing person must be matched through the index, or else two agreeing pieces (people or picks)
 * must corroborate each other, so a lone name never decides a merge.
 */
function overlap(a: Item, b: Item): number {
  if (!kindsMatch(a.move, b.move)) return 0;
  if (Math.abs(dayNumber(a.move.date) - dayNumber(b.move.date)) > WINDOW_DAYS) return 0;
  const aPeople = a.people.some((x) => x);
  const bPeople = b.people.some((y) => y);
  if (aPeople !== bPeople) return 0;
  const key = (p: MovePart) => `${p.pick!.year}-${p.pick!.round}`;
  const pb = b.move.parts.filter(identified);
  let agreeing = 0;
  let strong = false;
  for (const p of a.move.parts.filter(identified)) {
    if (pb.some((q) => key(q) === key(p) && sameWay(p, q))) {
      agreeing++;
      strong = true;
    }
  }
  if (aPeople) {
    let people = 0;
    a.people.forEach((x, i) => {
      if (!x) return;
      let best: 'key' | 'name' | false = false;
      b.people.forEach((y, j) => {
        if (!y || !sameWay(a.move.parts[i], b.move.parts[j])) return;
        const m = personMatch(x, y);
        if (m === 'key' || (m === 'name' && !best)) best = m;
      });
      if (!best) return;
      people++;
      if (best === 'key') strong = true;
    });
    if (people === 0) return 0; // shared picks only corroborate a shared person
    agreeing += people;
  }
  if (agreeing === 0) return 0;
  return strong || agreeing >= 2 ? agreeing : 0;
}

/** Every person the move names is already in the group. */
function peopleWithin(it: Item, g: Group): boolean {
  const named = it.people.filter((x): x is Who => !!x);
  return named.length > 0 && named.every((x) => g.members.some((m) => m.people.some((y) => y && samePerson(x, y))));
}

interface Group {
  members: Item[];
}

// ---- merging -----------------------------------------------------------------

interface Merge {
  base: Item;
  index: PeopleIndex;
  season: number;
  parts: MovePart[];
  /** Keyed by the merged part object (null = absent from the base), turned into indexes at the end. */
  conflicts: Array<{ part: MovePart | null; readings: string[] }>;
}

function conflict(mg: Merge, part: MovePart | null, baseReading: string, other: Item, otherReading: string): void {
  if (part) part.gap = 'source_conflict';
  const otherLine = `${other.source}: ${otherReading}`;
  const hit = part ? mg.conflicts.find((c) => c.part === part) : undefined;
  if (hit) hit.readings.push(otherLine);
  else mg.conflicts.push({ part, readings: [`${mg.base.source}: ${baseReading}`, otherLine] });
}

function personOf(mg: Merge, ref: PersonRef): Who {
  return who(ref, mg.index, mg.season);
}

/** The merged part (index) that an other-source part describes, or -1. Prefers one going the same way. */
function counterpart(mg: Merge, used: Set<number>, other: Item, oi: number): number {
  const op = other.move.parts[oi];
  const exact = (p: MovePart) => p.from === op.from && p.to === op.to;
  const prefer = (test: (p: MovePart) => boolean) => {
    const is = mg.parts.map((_, i) => i).filter((i) => !used.has(i) && test(mg.parts[i]));
    return is.find((i) => exact(mg.parts[i])) ?? is[0] ?? -1;
  };
  const who = other.people[oi];
  if (who) return prefer((p) => !!p.person && samePerson(personOf(mg, p.person), who));
  if (identified(op)) return prefer((p) => identified(p) && p.pick!.year === op.pick!.year && p.pick!.round === op.pick!.round);
  // A vague pick or a draft consideration never links: it only stands for an unidentified pick going the same way.
  if (op.kind === 'pick') return prefer((p) => p.kind === 'pick' && !identified(p) && exact(p));
  if (op.swap) return prefer((p) => p.swap?.year === op.swap!.year && p.swap?.round === op.swap!.round);
  return prefer((p) => p.kind === op.kind && !p.person && !p.pick && !p.swap && p.to === op.to);
}

/**
 * Reconciles the from/to of a matched pair in place; false when they disagree. `split`: the other source names
 * more teams than the base (Wikipedia's sides of a deal BBRef wrote as two-team), so it says which other team
 * sent or got the asset, as long as the Clippers' end agrees. When the base names more teams it is kept.
 */
function mergeEnds(bp: MovePart, op: MovePart, split: 'adopt' | 'keep' | null): boolean {
  // A null end is "not stated" (a free agent, a waiver claim NBA.com doesn't name the old team for): it never disputes.
  const fromOk = bp.from === op.from || op.from == null || bp.from == null;
  const toOk = bp.to === op.to || op.to == null || bp.to == null;
  if (fromOk && toOk) {
    if (bp.from == null && op.from != null) bp.from = op.from;
    if (bp.to == null && op.to != null) bp.to = op.to;
    if (bp.gap === 'party_unknown' && bp.from != null && bp.to != null) delete bp.gap;
    return true;
  }
  const lacAgrees = (bp.from === LAC && op.from === LAC) || (bp.to === LAC && op.to === LAC);
  if (!lacAgrees || !split) return false;
  if (split === 'adopt') {
    bp.from = op.from ?? bp.from;
    bp.to = op.to ?? bp.to;
  }
  return true;
}

function mergePick(mg: Merge, bp: MovePart, op: MovePart): boolean {
  const a = bp.pick!;
  const b = op.pick!;
  let agree = true;
  if (a.originalFranchiseId != null && b.originalFranchiseId != null && a.originalFranchiseId !== b.originalFranchiseId) agree = false;
  else if (a.originalFranchiseId == null && b.originalFranchiseId != null) a.originalFranchiseId = b.originalFranchiseId;
  if (a.selected && b.selected) {
    if (samePerson(personOf(mg, a.selected), personOf(mg, b.selected))) mergePerson(a.selected, b.selected);
    else agree = false;
  } else if (!a.selected && b.selected) a.selected = { ...b.selected };
  if (!a.protectionsText && b.protectionsText) a.protectionsText = b.protectionsText;
  return agree;
}

/**
 * A part the base source couldn't have listed, so its absence there is an omission, not a dispute: NBA.com
 * hides everything but players with an id (draft rights, cash, pick details, swaps, other considerations), and
 * BBRef gives only the Clippers' side of a deal. Anything else the base doesn't list is a conflict.
 */
function baseCannotSay(base: Source, op: MovePart): boolean {
  if (base === 'nba') return op.kind !== 'player';
  if (base === 'bbref') return op.from !== LAC && op.to !== LAC;
  return false;
}

function mergeMember(mg: Merge, other: Item): void {
  const baseTeams = teamsOf(mg.base.move).size;
  const otherTeams = teamsOf(other.move).size;
  const split =
    otherTeams > baseTeams && mg.base.source === 'bbref' && other.source === 'wiki' ? 'adopt'
    : baseTeams > otherTeams ? 'keep'
    : null;
  const used = new Set<number>();
  const extras: MovePart[] = [];
  other.move.parts.forEach((op, oi) => {
    const bi = counterpart(mg, used, other, oi);
    if (bi < 0) {
      extras.push(op);
      return;
    }
    used.add(bi);
    const bp = mg.parts[bi];
    const before = describe(bp);
    let agree = mergeEnds(bp, op, split);
    if (bp.person && op.person) mergePerson(bp.person, op.person);
    if (identified(bp) && identified(op)) agree = mergePick(mg, bp, op) && agree;
    if (bp.swap && op.swap && !bp.swap.protectionsText && op.swap.protectionsText) bp.swap.protectionsText = op.swap.protectionsText;
    if (!agree) conflict(mg, bp, before, other, describe(op));
  });

  // The picks NBA.com hid behind "draft consideration": the other source's identified picks and swaps going
  // the same way replace every draft consideration in that direction.
  const dir = (p: MovePart) => `${p.from}>${p.to}`;
  const fillers = new Map<string, MovePart[]>();
  for (const op of extras) {
    if (!(identified(op) || op.swap)) continue;
    if (!mg.parts.some((p) => fillable(p) && dir(p) === dir(op))) continue;
    (fillers.get(dir(op)) ?? fillers.set(dir(op), []).get(dir(op))!).push(op);
  }
  if (fillers.size > 0) {
    const next: MovePart[] = [];
    for (const p of mg.parts) {
      const f = fillable(p) ? fillers.get(dir(p)) : undefined;
      if (!f) next.push(p);
      else if (f.length > 0) next.push(...f.splice(0).map(clonePart)); // first one in that direction takes them all
    }
    mg.parts = next;
  }

  for (const op of extras) {
    if (fillers.has(dir(op)) && (identified(op) || op.swap)) continue;
    // An unidentified pick only stands for a pick going the same way; when the deal already has one it adds nothing.
    if (op.kind === 'pick' && !identified(op) && mg.parts.some((p) => p.kind === 'pick' && dir(p) === dir(op))) continue;
    if (baseCannotSay(mg.base.source, op)) mg.parts.push(clonePart(op));
    else conflict(mg, null, '(absent)', other, describe(op));
  }
}

function mergeGroup(g: Group, index: PeopleIndex): MergedMove {
  const members = [...g.members].sort((a, b) => a.rank - b.rank);
  const base = members[0];
  const mg: Merge = { base, index, season: seasonOf(base.move.date), parts: base.move.parts.map(clonePart), conflicts: [] };
  for (const other of members.slice(1)) mergeMember(mg, other);

  const nbaDate = members.find((m) => m.source === 'nba')?.move.date;
  const date = nbaDate ?? members.map((m) => m.move.date).sort()[0];
  const notes: string[] = [];
  for (const m of members) for (const n of m.move.notes ?? []) if (!notes.includes(n)) notes.push(n);
  const sources = members.map((m) => m.move.sourceKey);
  const out: MergedMove = {
    sourceKey: base.move.sourceKey,
    date,
    kind: members.find((m) => m.source === 'bbref' && NAMED_CONTRACTS.has(m.move.kind) && CONTRACT_KINDS.has(base.move.kind))?.move.kind
      ?? base.move.kind,
    parts: mg.parts,
    involvesClippers: members.some((m) => m.move.involvesClippers),
    // A dispute about a part the base doesn't list leaves no gap on any part, but the move still isn't settled.
    complete: mg.parts.every((p) => !p.gap) && mg.conflicts.length === 0,
    sources,
    transactionKey: chooseTransactionKey(sources),
    conflicts: mg.conflicts.map((c) => ({ partIndex: c.part ? mg.parts.indexOf(c.part) : null, readings: c.readings })),
  };
  if (notes.length) out.notes = notes;
  return out;
}

// ---- entry -------------------------------------------------------------------

export function reconcileMoves(input: ReconcileInput): MergedMove[] {
  const { index } = input;
  const items: Item[] = [
    ...input.nba.map((m) => makeItem(m, 'nba', index)),
    ...input.bbref.map((m) => makeItem(m, 'bbref', index)),
    ...input.wiki.map((m) => makeItem(m, 'wiki', index)),
  ];
  const groups: Group[] = [];
  const byDate = new Map<string, Group[]>();
  const found = (it: Item) => {
    const g: Group = { members: [it] };
    groups.push(g);
    (byDate.get(it.move.date) ?? byDate.set(it.move.date, []).get(it.move.date)!).push(g);
  };
  const candidates = (it: Item, sameSourceOk: boolean) => {
    const out: Array<{ it: Item; g: Group; score: number; gap: number }> = [];
    for (let d = -WINDOW_DAYS; d <= WINDOW_DAYS; d++) {
      for (const g of byDate.get(addDays(it.move.date, d)) ?? []) {
        if (!sameSourceOk && g.members.some((m) => m.source === it.source)) continue;
        const score = Math.max(...g.members.map((m) => overlap(m, it)));
        if (score > 0) out.push({ it, g, score, gap: Math.abs(d) });
      }
    }
    return out;
  };

  // Strongest sources first (rank 0 founds the groups), then each weaker tier joins them best match first:
  // one move per source per event, so a player traded twice on one day goes to the deal that agrees on direction.
  for (const tier of [0, 1, 2]) {
    const tierItems = items.filter((it) => it.rank === tier);
    const pairs = tierItems.flatMap((it) => candidates(it, false)).sort((x, y) => y.score - x.score || x.gap - y.gap);
    const placed = new Set<Item>();
    for (const { it, g } of pairs) {
      if (placed.has(it) || g.members.some((m) => m.source === it.source)) continue;
      g.members.push(it);
      placed.add(it);
    }
    for (const it of tierItems) {
      if (placed.has(it)) continue;
      // Wikipedia sometimes splits one deal over two table rows: a leftover row joins the deal it overlaps, but only
      // when it names nobody the deal doesn't already have (it may not bring in parts of a different event).
      const again = it.source === 'wiki'
        ? candidates(it, true).filter((c) => peopleWithin(it, c.g)).sort((x, y) => y.score - x.score || x.gap - y.gap)[0]
        : undefined;
      if (again) again.g.members.push(it);
      else found(it);
    }
  }
  return groups.map((g) => mergeGroup(g, index));
}
