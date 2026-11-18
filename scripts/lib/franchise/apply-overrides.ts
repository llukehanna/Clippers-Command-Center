// scripts/lib/franchise/apply-overrides.ts
// Applies overrides.ts on every import and job run (spec §3.2 "Overrides"). Pure: nothing passed in is mutated.
//
// Two phases, because picks are built from the moves:
//
// Phase 1, applyMoveOverrides: after reconcileMoves, BEFORE buildPicks. Its output is buildPicks' input, so every
// link, chain check, status and owner is computed with the override in place.
//   move, by moveKey (a transaction key or any of its source keys), applied in this order:
//     drop       the move leaves the list; it goes to `dropped` with its sources and reason.
//     mergeInto  the move joins the target (found the same way): sources and notes are unioned and the target keeps its
//                key. A part both list the same way fills the target's missing ids; one listed the other way marks the
//                target's part `source_conflict`; one the target lacks is NOT added (never silently add a
//                contradicting player): it is a conflict with partIndex null ("absent in base"), as in reconcile.
//     replace    `replaceParts` become the parts and the conflicts are cleared (the override is the settled reading).
//                `complete` is the override's when given (R10: "compensation not recorded" stays incomplete).
//     create     by an unparsed line's { source, text }: the first such line leaves `unparsed` and becomes a move keyed
//                `override:<line source>#<8 hex of sha1(source + "\n" + text)>` (stable while the line reads the same),
//                dated by the line or `create.date`.
//   pick, by { moveKey, partIndex }: fills the pick part's year / round / original and clears its vague flag and
//                `pick_unidentified` gap; buildPicks then links it (or puts the gap back if it still can't).
//   pick, by { draftYear, overall }: the draft row's original franchise, returned as `originals` for
//                DraftInput.originals; it outranks every source reading, so it keys a row buildPicks left unkeyed.
//
// Phase 2, applyOverrides: on the assembled dataset, AFTER buildPicks.
//   pick, by pickKey: protections. `protections` given (or `protectionsText` that parseProtections reads) marks them
//                known; text it can't read with no `protections` is invalid: reported, nothing changes, the pick stays
//                gated. `status: 'forfeited'` marks the pick forfeited (no longer future, so no longer gated).
//   person       parts, honors and executive terms matching `ref` get `personKey` (a part's `person_unmatched` gap is
//                cleared). An id ref (BBRef id, `nba:<id>`) matches that id; a name ref matches, by normalized name,
//                only people carrying no id (parts with no bbrefId / nbaPersonId / personKey, rows with a null
//                personKey). `scope` narrows it to one move or one season.
//   ignore       every unparsed line with that { source, text } moves to `ignored`, with the reason.
//   teamName     read by franchiseFromName at parse time (team-names.ts); here only checked for staleness.
//
// Each phase skips the other phase's kinds. Stale (reported): an override that matches nothing (no such move, part,
// line, draft row, pick or person), a merge into itself, a created move with no date, and a teamName the base tables
// already resolve to the same team. Moves an override touched get `complete` recomputed (no gaps and no conflicts)
// unless a move override forced it.
import { createHash } from 'node:crypto';
import { normalizePersonName } from '../player-match.js';
import { seasonOfDate } from './describe.js';
import { parseProtections } from './protections.js';
import type { MergedMove } from './reconcile-moves.js';
import { franchiseFromName } from './team-names.js';
import type { DraftOriginal, DroppedMove, FranchiseDataset, MovePart, Override, PersonRef, UnparsedLine } from './types.js';

type Of<K extends Override['kind']> = Extract<Override, { kind: K }>;
type MoveOv = Of<'move'>;
type PickOv = Of<'pick'>;

const lineMatches = (l: UnparsedLine, match: { source: string; text: string }) => l.source === match.source && l.text === match.text;
const findMove = (moves: MergedMove[], key: string) => moves.find((m) => m.transactionKey === key || m.sources.includes(key));
const noGaps = (parts: MovePart[]) => parts.every((p) => !p.gap);

function settleCompleteness(touched: Set<MergedMove>, forced: Map<MergedMove, boolean>): void {
  for (const m of touched) m.complete = forced.get(m) ?? (noGaps(m.parts) && m.conflicts.length === 0);
}

// ---- merging -------------------------------------------------------------------------

const personIds = (p: PersonRef, key?: string) =>
  [key, p.bbrefId, p.nbaPersonId != null ? `nba:${p.nbaPersonId}` : undefined].filter((x): x is string => !!x);

/** Same asset (ignoring direction). People by a shared id, else by normalized name when either side has no id. */
function sameAsset(a: MovePart, b: MovePart): boolean {
  if (a.kind !== b.kind) return false;
  if (a.person || b.person) {
    if (!a.person || !b.person) return false;
    const ia = personIds(a.person, a.personKey);
    const ib = personIds(b.person, b.personKey);
    if (ia.length && ib.length) return ia.some((x) => ib.includes(x));
    return normalizePersonName(a.person.name) === normalizePersonName(b.person.name);
  }
  if (a.pick || b.pick) {
    if (!a.pick || !b.pick) return false;
    if (a.pick.vague || b.pick.vague) return a.pick.vague === b.pick.vague && a.text === b.text;
    const oa = a.pick.originalFranchiseId;
    const ob = b.pick.originalFranchiseId;
    return a.pick.year === b.pick.year && a.pick.round === b.pick.round && (oa == null || ob == null || oa === ob);
  }
  if (a.swap || b.swap) return !!a.swap && !!b.swap && a.swap.year === b.swap.year && a.swap.round === b.swap.round;
  if (a.kind === 'other') return a.text === b.text;
  return true; // cash, exception
}

const label = (p: MovePart) => {
  const what = p.person?.name ?? (p.pick && !p.pick.vague ? `${p.pick.year} round ${p.pick.round} pick` : p.text ?? p.kind);
  return `${what} ${p.from ?? '-'}→${p.to ?? '-'}`;
};

function merge(target: MergedMove, src: MergedMove): void {
  target.sources = [...new Set([...target.sources, ...src.sources])];
  const notes = [...new Set([...(target.notes ?? []), ...(src.notes ?? [])])];
  if (notes.length) target.notes = notes;
  for (const sp of src.parts) {
    const i = target.parts.findIndex((tp) => sameAsset(tp, sp));
    if (i < 0) {
      target.conflicts.push({ partIndex: null, readings: [`${target.transactionKey}: (absent)`, `${src.transactionKey}: ${label(sp)}`] });
      continue;
    }
    const tp = target.parts[i];
    if (tp.from !== sp.from || tp.to !== sp.to) {
      tp.gap = 'source_conflict';
      target.conflicts.push({ partIndex: i, readings: [`${target.transactionKey}: ${label(tp)}`, `${src.transactionKey}: ${label(sp)}`] });
      continue;
    }
    if (tp.person && sp.person) {
      if (!tp.person.bbrefId && sp.person.bbrefId) tp.person.bbrefId = sp.person.bbrefId;
      if (tp.person.nbaPersonId == null && sp.person.nbaPersonId != null) tp.person.nbaPersonId = sp.person.nbaPersonId;
    }
    if (tp.pick && sp.pick && !tp.pick.vague) {
      if (tp.pick.originalFranchiseId == null && sp.pick.originalFranchiseId != null) tp.pick.originalFranchiseId = sp.pick.originalFranchiseId;
      if (!tp.pick.selected && sp.pick.selected) tp.pick.selected = sp.pick.selected;
      if (!tp.pick.protectionsText && sp.pick.protectionsText) tp.pick.protectionsText = sp.pick.protectionsText;
    }
  }
}

// ---- phase 1 ------------------------------------------------------------------------

export interface MoveOverridesInput {
  /** reconcileMoves' output. */
  moves: MergedMove[];
  /** Every parser's unparsed lines (a `create` override takes its line out). */
  unparsed: UnparsedLine[];
  /** The draft rows a `{ draftYear, overall }` override may name (Wikipedia draft pages' rows). */
  draftRows: Array<{ year: number; overall: number }>;
}

export interface MoveOverridesResult {
  moves: MergedMove[];
  unparsed: UnparsedLine[];
  dropped: DroppedMove[];
  /** For DraftInput.originals. */
  originals: DraftOriginal[];
  stale: Override[];
}

/** A BBRef id ("freewo01", coaches "dunlemi01c") or `nba:<id>`; anything else is a name. */
const ID_REF = /^(?:nba:\d+|[a-z][a-z'.]{0,7}\d{2}[a-z]?)$/;

const isPhase1 = (o: Override) => o.kind === 'move' || (o.kind === 'pick' && !('pickKey' in o.match));

/** Phase 1: run between reconcileMoves and buildPicks. */
export function applyMoveOverrides(input: MoveOverridesInput, overrides: Override[]): MoveOverridesResult {
  let moves = structuredClone(input.moves);
  const unparsed = [...input.unparsed];
  const dropped: DroppedMove[] = [];
  const originals: DraftOriginal[] = [];
  const stale = new Set<Override>();
  const touched = new Set<MergedMove>();
  const forced = new Map<MergedMove, boolean>();
  const remove = (m: MergedMove) => {
    moves = moves.filter((x) => x !== m);
    touched.delete(m);
  };

  const moveOvs = overrides.filter((o): o is MoveOv => o.kind === 'move');
  const step = (o: MoveOv) => ('drop' in o ? 0 : 'mergeInto' in o ? 1 : 'create' in o ? 3 : 2);
  for (const o of [...moveOvs].sort((a, b) => step(a) - step(b))) {
    if ('create' in o) {
      const i = unparsed.findIndex((l) => lineMatches(l, o.match));
      const line = unparsed[i];
      const date = o.create.date ?? line?.date;
      if (i < 0 || !date) {
        stale.add(o);
        continue;
      }
      unparsed.splice(i, 1);
      const hash = createHash('sha1').update(`${line.source}\n${line.text}`).digest('hex').slice(0, 8);
      const key = `override:${line.source}#${hash}`;
      const m: MergedMove = {
        sourceKey: key, date, kind: o.create.kind, parts: structuredClone(o.replaceParts),
        involvesClippers: o.create.involvesClippers ?? true, complete: false, sources: [key], transactionKey: key, conflicts: [],
      };
      moves.push(m);
      touched.add(m);
      if (o.complete !== undefined) forced.set(m, o.complete);
      continue;
    }
    const m = findMove(moves, o.match.moveKey);
    if (!m) {
      stale.add(o);
      continue;
    }
    if ('drop' in o) {
      dropped.push({ transactionKey: m.transactionKey, sources: m.sources, reason: o.reason });
      remove(m);
    } else if ('mergeInto' in o) {
      const target = findMove(moves, o.mergeInto);
      if (!target || target === m) {
        stale.add(o);
        continue;
      }
      merge(target, m);
      remove(m);
      touched.add(target);
    } else {
      m.parts = structuredClone(o.replaceParts);
      m.conflicts = [];
      touched.add(m);
      if (o.complete !== undefined) forced.set(m, o.complete);
    }
  }

  for (const o of overrides) {
    if (o.kind !== 'pick' || 'pickKey' in o.match) continue;
    if ('draftYear' in o.match) {
      const { draftYear, overall } = o.match;
      if (!input.draftRows.some((r) => r.year === draftYear && r.overall === overall)) stale.add(o);
      else originals.push({ year: draftYear, overall, originalFranchiseId: (o as Extract<PickOv, { match: { draftYear: number } }>).set.originalFranchiseId });
      continue;
    }
    const set = (o as Extract<PickOv, { match: { partIndex: number } }>).set;
    const m = findMove(moves, o.match.moveKey);
    const part = m?.parts[o.match.partIndex];
    if (!m || !part || part.kind !== 'pick') {
      stale.add(o);
      continue;
    }
    const pick = (part.pick ??= { year: 0, round: 0 });
    if (set.year !== undefined) pick.year = set.year;
    if (set.round !== undefined) pick.round = set.round;
    if (set.originalFranchiseId !== undefined) pick.originalFranchiseId = set.originalFranchiseId;
    if (pick.year > 0 && pick.round > 0) {
      delete pick.vague;
      if (part.gap === 'pick_unidentified') delete part.gap; // buildPicks puts it back if it still can't link
    }
    delete part.pickKey;
    touched.add(m);
  }

  settleCompleteness(touched, forced);
  return { moves, unparsed, dropped, originals, stale: overrides.filter((o) => stale.has(o)) };
}

// ---- phase 2 ------------------------------------------------------------------------

/** Phase 2: run on the assembled dataset, after buildPicks. `invalid`: overrides that can't apply as written. */
export function applyOverrides(input: FranchiseDataset, overrides: Override[]): { data: FranchiseDataset; stale: Override[]; invalid: Override[] } {
  const data = structuredClone(input);
  const stale = new Set<Override>();
  const invalid = new Set<Override>();
  const touched = new Set<MergedMove>();

  const applyIgnore = (o: Of<'ignore'>): boolean => {
    const hits = data.unparsed.filter((l) => lineMatches(l, o.match));
    if (!hits.length) return false;
    data.unparsed = data.unparsed.filter((l) => !hits.includes(l));
    data.ignored.push(...hits.map((l) => ({ ...l, reason: o.reason })));
    return true;
  };

  const applyProtections = (o: Extract<PickOv, { match: { pickKey: string } }>): boolean => {
    const row = data.picks.find((p) => p.pickKey === o.match.pickKey);
    if (!row) return false;
    const { protections, protectionsText, status } = o.set;
    if (status === 'forfeited') {
      row.status = 'forfeited';
      if (protections === undefined && protectionsText == null) return true;
    }
    const parsed = protectionsText != null ? parseProtections(protectionsText) : null;
    if (protections === undefined && !parsed) {
      invalid.add(o); // nothing structured to record: the pick stays unknown (and gated if future)
      return true;
    }
    row.protections = protections ?? parsed!.protections;
    row.protectionsText = protectionsText ?? row.protectionsText;
    row.protectionsKnown = true;
    return true;
  };

  const applyPerson = (o: Of<'person'>): boolean => {
    const { ref, scope } = o.match;
    const isId = ID_REF.test(ref);
    const name = isId ? '' : normalizePersonName(ref);
    const partHit = (p: MovePart): boolean => {
      if (!p.person) return false;
      if (isId) return p.person.bbrefId === ref || (p.person.nbaPersonId != null && `nba:${p.person.nbaPersonId}` === ref);
      const hasId = !!(p.person.bbrefId || p.person.nbaPersonId != null || p.personKey);
      return !hasId && !!name && normalizePersonName(p.person.name) === name;
    };
    const rowHit = (row: { name: string; personKey: string | null }) =>
      !isId && row.personKey == null && !!name && normalizePersonName(row.name) === name;
    let hit = false;
    for (const m of data.moves) {
      if (scope?.moveKey != null && m.transactionKey !== scope.moveKey && !m.sources.includes(scope.moveKey)) continue;
      if (scope?.seasonId != null && seasonOfDate(m.date) !== scope.seasonId) continue;
      for (const p of m.parts) {
        if (!partHit(p)) continue;
        p.personKey = o.personKey;
        if (p.gap === 'person_unmatched') delete p.gap;
        touched.add(m);
        hit = true;
      }
    }
    if (scope?.moveKey == null) {
      const inSeason = (start: string | null, end: string | null) =>
        scope?.seasonId == null || ((start == null || seasonOfDate(start) <= scope.seasonId) && (end == null || seasonOfDate(end) >= scope.seasonId));
      for (const h of data.honors) {
        if ((scope?.seasonId != null && h.seasonId !== scope.seasonId) || !rowHit(h)) continue;
        h.personKey = o.personKey;
        hit = true;
      }
      for (const e of data.execTerms) {
        if (!inSeason(e.startDate, e.endDate) || !rowHit(e)) continue;
        e.personKey = o.personKey;
        hit = true;
      }
    }
    return hit;
  };

  const applyTeamName = (o: Of<'teamName'>): boolean => franchiseFromName(o.match.text, o.match.seasonId, []) !== o.franchise;

  for (const o of overrides) {
    if (isPhase1(o)) continue;
    let ok = true;
    if (o.kind === 'ignore') ok = applyIgnore(o);
    else if (o.kind === 'pick' && 'pickKey' in o.match) ok = applyProtections(o as Extract<PickOv, { match: { pickKey: string } }>);
    else if (o.kind === 'person') ok = applyPerson(o);
    else if (o.kind === 'teamName') ok = applyTeamName(o);
    if (!ok) stale.add(o);
  }

  settleCompleteness(touched, new Map());
  return { data, stale: overrides.filter((o) => stale.has(o)), invalid: overrides.filter((o) => invalid.has(o)) };
}
