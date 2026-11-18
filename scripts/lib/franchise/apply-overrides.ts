// scripts/lib/franchise/apply-overrides.ts
// Applies overrides.ts to an assembled dataset, after parsing and before the report and the write (spec §3.2
// "Overrides"). Pure: returns a new dataset and never mutates its input.
//
// What each kind does (phases run in this order, so a later phase sees an earlier one's moves):
//   ignore    every unparsed line with that { source, text } moves to `ignored`, with the reason.
//   move      by moveKey (a transaction key or any of its source keys): the parts are replaced, the conflicts are
//             cleared (the override is the settled reading), and `complete` is the override's, else "no gaps".
//             By an unparsed line's { source, text } plus `create`: the first such line leaves `unparsed` and becomes
//             a new move. Its key is `override:<line source>#<8 hex of sha1(source + text)>`, so it is stable across
//             re-imports as long as the line reads the same; its date is the line's (or `create.date`).
//   pick      by pickKey: protections (either field) are set and marked known; identity fields re-key the row and
//             every part and lottery row pointing at it. By moveKey + partIndex: the pick part's identity is filled,
//             and once year, round and original are known it is linked to that row (created when missing) and its
//             `pick_unidentified` gap cleared; protections go on the row as above.
//   person    every move part, honor and executive term whose person matches `ref` (equal BBRef id, `nba:<id>`, or
//             normalized name) gets `personKey`; a part's `person_unmatched` gap is cleared.
//   teamName  read by franchiseFromName at parse time (team-names.ts); here only checked for staleness.
// Moves an override touched get `complete` recomputed (no gaps and no conflicts) unless a move override forced it.
//
// Stale: an override that matches nothing (no such pick, move, part, line or person), a re-key onto a key another
// row already has (or an identity that forms no key), a created move with no date, and a teamName the base tables already resolve to the same team.
import { createHash } from 'node:crypto';
import { normalizePersonName } from '../player-match.js';
import { pickKey } from './keys.js';
import type { PickRow } from './picks.js';
import { parseProtections } from './protections.js';
import type { MergedMove } from './reconcile-moves.js';
import { franchiseFromName } from './team-names.js';
import type { FranchiseDataset, MovePart, Override, PersonRef, UnparsedLine } from './types.js';

/** A pick key, or null when the identity can't form one (placeholder year/round, unknown franchise id). */
function keyOf(year: number, round: number, original: number): string | null {
  try {
    return pickKey(year, round, original);
  } catch {
    return null;
  }
}

type Of<K extends Override['kind']> = Extract<Override, { kind: K }>;
type PickOverride = Of<'pick'>;

const PHASES: Array<Override['kind']> = ['teamName', 'ignore', 'move', 'pick', 'person'];

export function applyOverrides(input: FranchiseDataset, overrides: Override[]): { data: FranchiseDataset; stale: Override[] } {
  const data = structuredClone(input);
  const stale = new Set<Override>();
  const touched = new Set<MergedMove>();
  const forced = new Map<MergedMove, boolean>();

  const findMove = (key: string) => data.moves.find((m) => m.transactionKey === key || m.sources.includes(key));
  const lineMatches = (l: UnparsedLine, match: { source: string; text: string }) => l.source === match.source && l.text === match.text;

  const setProtections = (row: PickRow, set: PickOverride['set']): boolean => {
    if (set.protections === undefined && set.protectionsText === undefined) return false;
    const parsed = set.protectionsText != null ? parseProtections(set.protectionsText) : null;
    row.protections = set.protections ?? parsed?.protections ?? null;
    row.protectionsText = set.protectionsText ?? parsed?.text ?? row.protectionsText;
    row.protectionsKnown = true;
    return true;
  };

  const applyIgnore = (o: Of<'ignore'>): boolean => {
    const hits = data.unparsed.filter((l) => lineMatches(l, o.match));
    if (!hits.length) return false;
    data.unparsed = data.unparsed.filter((l) => !hits.includes(l));
    data.ignored.push(...hits.map((l) => ({ ...l, reason: o.reason })));
    return true;
  };

  const applyMove = (o: Of<'move'>): boolean => {
    const parts = structuredClone(o.replaceParts);
    let m: MergedMove | undefined;
    if ('create' in o) {
      const i = data.unparsed.findIndex((l) => lineMatches(l, o.match));
      if (i < 0) return false;
      const line = data.unparsed[i];
      const date = o.create.date ?? line.date;
      if (!date) return false;
      data.unparsed.splice(i, 1);
      const hash = createHash('sha1').update(`${line.source}\n${line.text}`).digest('hex').slice(0, 8);
      const key = `override:${line.source}#${hash}`;
      m = {
        sourceKey: key, date, kind: o.create.kind, parts, involvesClippers: o.create.involvesClippers ?? true, complete: false,
        sources: [key], transactionKey: key, conflicts: [],
      };
      data.moves.push(m);
    } else {
      m = findMove(o.match.moveKey);
      if (!m) return false;
      m.parts = parts;
      m.conflicts = [];
    }
    touched.add(m);
    if (o.complete !== undefined) forced.set(m, o.complete);
    return true;
  };

  const applyPick = (o: PickOverride): boolean => {
    const { set, match } = o;
    if (match.pickKey != null) {
      const row = data.picks.find((p) => p.pickKey === match.pickKey);
      if (!row) return false;
      const year = set.year ?? row.year;
      const round = set.round ?? row.round;
      const original = set.originalFranchiseId ?? row.originalFranchiseId;
      const key = keyOf(year, round, original);
      if (key == null) return false;
      if (key !== row.pickKey) {
        if (data.picks.some((p) => p.pickKey === key)) return false;
        const old = row.pickKey;
        Object.assign(row, { pickKey: key, year, round, originalFranchiseId: original });
        for (const m of data.moves) {
          for (const p of m.parts) {
            if (p.pickKey !== old) continue;
            p.pickKey = key;
            if (p.pick) Object.assign(p.pick, { year, round, originalFranchiseId: original });
          }
        }
        for (const l of data.lottery) if (l.pickKey === old) l.pickKey = key;
      }
      setProtections(row, set);
      return true;
    }
    if (match.moveKey == null || match.partIndex == null) return false;
    const m = findMove(match.moveKey);
    const part = m?.parts[match.partIndex];
    if (!m || !part || part.kind !== 'pick') return false;
    const pick = (part.pick ??= { year: 0, round: 0 });
    if (set.year !== undefined) pick.year = set.year;
    if (set.round !== undefined) pick.round = set.round;
    if (set.originalFranchiseId !== undefined) pick.originalFranchiseId = set.originalFranchiseId;
    if (pick.year > 0 && pick.round > 0) delete pick.vague;
    touched.add(m);
    const original = pick.originalFranchiseId;
    const key = pick.vague || original == null ? null : keyOf(pick.year, pick.round, original);
    if (key == null || original == null) return true; // identity still partial: the part stays unlinked
    let row: PickRow | undefined = data.picks.find((p) => p.pickKey === key);
    if (!row) {
      row = {
        pickKey: key, year: pick.year, round: pick.round, originalFranchiseId: original,
        protections: null, protectionsText: null, protectionsKnown: false,
        status: pick.year >= data.currentDraftYear ? 'future' : null,
        overall: null, selectedPersonKey: null, finalOwnerFranchiseId: null,
      };
      data.picks.push(row);
    }
    part.pickKey = key;
    if (part.gap === 'pick_unidentified') delete part.gap;
    if (setProtections(row, set)) {
      if (row.protectionsText != null) pick.protectionsText = row.protectionsText;
      if (part.gap === 'protections_unknown') delete part.gap;
    }
    return true;
  };

  const applyPerson = (o: Of<'person'>): boolean => {
    const ref = o.match.ref;
    const name = normalizePersonName(ref);
    const isRef = (p: PersonRef) => p.bbrefId === ref || (p.nbaPersonId != null && `nba:${p.nbaPersonId}` === ref) || (!!name && normalizePersonName(p.name) === name);
    const isName = (n: string) => !!name && normalizePersonName(n) === name;
    let hit = false;
    for (const m of data.moves) {
      for (const p of m.parts) {
        if (!p.person || !isRef(p.person)) continue;
        p.personKey = o.personKey;
        if (p.gap === 'person_unmatched') delete p.gap;
        touched.add(m);
        hit = true;
      }
    }
    for (const row of [...data.honors, ...data.execTerms]) {
      if (!isName(row.name)) continue;
      row.personKey = o.personKey;
      hit = true;
    }
    return hit;
  };

  const applyTeamName = (o: Of<'teamName'>): boolean => franchiseFromName(o.match.text, o.match.seasonId, []) !== o.franchise;

  for (const phase of PHASES) {
    for (const o of overrides) {
      if (o.kind !== phase) continue;
      let ok: boolean;
      switch (o.kind) {
        case 'ignore': ok = applyIgnore(o); break;
        case 'move': ok = applyMove(o); break;
        case 'pick': ok = applyPick(o); break;
        case 'person': ok = applyPerson(o); break;
        case 'teamName': ok = applyTeamName(o); break;
      }
      if (!ok) stale.add(o);
    }
  }

  const noGaps = (parts: MovePart[]) => parts.every((p) => !p.gap);
  for (const m of touched) m.complete = forced.get(m) ?? (noGaps(m.parts) && m.conflicts.length === 0);

  return { data, stale: overrides.filter((o) => stale.has(o)) };
}
