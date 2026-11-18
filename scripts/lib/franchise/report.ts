// scripts/lib/franchise/report.ts
// The review report and the write gates (spec §3.3). Pure: reads a dataset (after applyOverrides), returns data.
//
// Gates (gateFailures): exactly two, per the spec. Unparsed lines no `ignore` override settled (applyOverrides moves
// those to `ignored`), and `future` picks whose protections aren't known. Everything else is listed for review only:
// gaps on old trades are expected and are written as unlinked text.
//
// Moves are counted and their gaps listed for Clippers moves only (league rows exist only for trade trees).
// possibleDuplicates (Ruling R14): two Clippers moves no merge joined, whose sources share no prefix (bbref / wiki /
// nba / …), within 30 days, sharing a counterparty (or both naming none) and at least one person (by key or
// normalized name) or pick (by key, or year and round) in common: Wikipedia date drift and name variants the 3-day
// matcher misses. Settled with overrides.
import { normalizePersonName } from '../player-match.js';
import { NBA_TEAM_IDS } from '../nba-teams.js';
import { seasonOfDate } from './describe.js';
import type { ChainBreak, ChainDispute, PicksResult } from './picks.js';
import type { MergedMove } from './reconcile-moves.js';
import type { FranchiseDataset, GapReason, IgnoredLine, MovePart, Override, UnparsedLine } from './types.js';

const LAC = NBA_TEAM_IDS.LAC;
const DUPLICATE_WINDOW_DAYS = 30;
const GAP_REASONS: GapReason[] = ['pick_unidentified', 'protections_unknown', 'source_conflict', 'person_unmatched', 'party_unknown'];

export interface ConflictEntry {
  transactionKey: string;
  date: string;
  /** "part N", or "absent in base" for a part another source lists that the base doesn't. */
  part: string;
  readings: string[];
}

export interface PossibleDuplicate {
  a: string;
  b: string;
  days: number;
  /** The people and picks the two share. */
  shared: string[];
}

export interface FranchiseReport {
  /** Headline counts (rows per table, list lengths, skipped by reason as `skipped.<reason>`). */
  counts: Record<string, number>;
  /** Clippers moves per season (start year) and kind. */
  bySeasonKind: Record<string, Record<string, number>>;
  /** Gate: unparsed lines no override settled. */
  unparsed: UnparsedLine[];
  ignored: IgnoredLine[];
  /** Ruling R9: lines deliberately skipped (G League, duplicates), by reason. */
  skippedByReason: Record<string, number>;
  unmatchedPeople: string[];
  ambiguousPeople: string[];
  /** Clippers move parts by gap reason: "<transaction key> part <i> (<date>): <label>". */
  gaps: Record<GapReason, string[]>;
  conflicts: ConflictEntry[];
  chainBreaks: ChainBreak[];
  disputes: ChainDispute[];
  unkeyed: PicksResult['unkeyed'];
  /** Gate: future picks whose protections aren't known (pick keys). */
  futureWithoutProtections: string[];
  /** Swaps of drafts already held whose outcome no source records (exercised null). */
  unsettledSwaps: string[];
  partialPayrolls: number[];
  staleOverrides: Override[];
  /** Lottery pick keys whose slot came from tied records. */
  tieUnresolved: string[];
  lotteryFlags: Array<{ pickKey: string; flags: string[] }>;
  /** Team-article award headings with no honor code. */
  skippedCategories: string[];
  possibleDuplicates: PossibleDuplicate[];
}

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

function partLabel(p: MovePart): string {
  if (p.text) return p.text;
  if (p.person) return p.person.name;
  if (p.pick) return `${p.pick.year || '?'} round ${p.pick.round || '?'} pick`;
  if (p.swap) return `${p.swap.year} round ${p.swap.round} swap`;
  return p.kind;
}

/** People and picks a move names, as comparable tokens (`p:` person, `k:` pick) mapped to a display label. */
function tokens(m: MergedMove): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of m.parts) {
    const people = [p.person, p.pick?.selected].filter((x) => x != null);
    for (const r of people) {
      const label = r.name;
      for (const k of [p.person === r ? p.personKey : undefined, r.bbrefId, r.nbaPersonId != null ? `nba:${r.nbaPersonId}` : undefined]) {
        if (k) out.set(`p:${k}`, label);
      }
      const n = normalizePersonName(r.name);
      if (n) out.set(`p:name:${n}`, label);
    }
    if (p.pickKey) out.set(`k:${p.pickKey}`, p.pickKey);
    if (p.pick && !p.pick.vague && p.pick.year > 0 && p.pick.round > 0) out.set(`k:${p.pick.year}-${p.pick.round}`, `${p.pick.year} round ${p.pick.round} pick`);
  }
  return out;
}

function possibleDuplicates(moves: MergedMove[]): PossibleDuplicate[] {
  const info = moves
    .map((m) => ({
      m,
      day: dayNumber(m.date),
      prefixes: new Set(m.sources.map((s) => s.split(':')[0])),
      teams: new Set(m.parts.flatMap((p) => [p.from, p.to]).filter((f) => f != null && f !== LAC)),
      tokens: tokens(m),
    }))
    .sort((x, y) => x.day - y.day);
  const out: PossibleDuplicate[] = [];
  for (let i = 0; i < info.length; i++) {
    const a = info[i];
    for (let j = i + 1; j < info.length && info[j].day - a.day <= DUPLICATE_WINDOW_DAYS; j++) {
      const b = info[j];
      if ([...a.prefixes].some((x) => b.prefixes.has(x))) continue;
      const shareTeam = a.teams.size === 0 ? b.teams.size === 0 : [...a.teams].some((t) => b.teams.has(t));
      if (!shareTeam) continue;
      const shared = new Set<string>();
      for (const [k, label] of a.tokens) if (b.tokens.has(k)) shared.add(label);
      if (shared.size) out.push({ a: a.m.transactionKey, b: b.m.transactionKey, days: b.day - a.day, shared: [...shared] });
    }
  }
  return out;
}

export function buildReport(data: FranchiseDataset, staleOverrides: Override[] = []): FranchiseReport {
  const clippers = data.moves.filter((m) => m.involvesClippers);

  const bySeasonKind: Record<string, Record<string, number>> = {};
  for (const m of clippers) {
    const s = (bySeasonKind[String(seasonOfDate(m.date))] ??= {});
    s[m.kind] = (s[m.kind] ?? 0) + 1;
  }

  const gaps = Object.fromEntries(GAP_REASONS.map((g) => [g, [] as string[]])) as Record<GapReason, string[]>;
  const conflicts: ConflictEntry[] = [];
  for (const m of clippers) {
    m.parts.forEach((p, i) => {
      if (p.gap) gaps[p.gap].push(`${m.transactionKey} part ${i} (${m.date}): ${partLabel(p)}`);
    });
    for (const c of m.conflicts) {
      conflicts.push({ transactionKey: m.transactionKey, date: m.date, part: c.partIndex == null ? 'absent in base' : `part ${c.partIndex}`, readings: c.readings });
    }
  }

  const skippedByReason: Record<string, number> = {};
  for (const s of data.skipped) skippedByReason[s.reason] = (skippedByReason[s.reason] ?? 0) + 1;

  const unmatchedPeople = [...new Set([
    ...data.peopleUnmatched.map((r) => `${r.name} (${r.bbrefId})`),
    ...data.honors.filter((h) => h.personKey == null).map((h) => `${h.name} (honor ${h.honor})`),
    ...data.execTerms.filter((e) => e.personKey == null).map((e) => `${e.name} (executive)`),
  ])];
  const ambiguousPeople = [...new Set(data.peopleAmbiguous.map((r) => `${r.name} (${r.bbrefId})`))];

  const futureWithoutProtections = data.picks.filter((p) => p.status === 'future' && p.protectionsKnown !== true).map((p) => p.pickKey);
  const unsettledSwaps = data.swaps.filter((s) => s.year < data.currentDraftYear && s.exercised === null).map((s) => s.swapKey);
  const partialPayrolls = data.payrollSeasons.filter((p) => p.isPartial).map((p) => p.seasonId).sort((a, b) => a - b);
  const tieUnresolved = data.lottery.filter((l) => l.tieUnresolved).map((l) => l.pickKey);
  const lotteryFlags = data.lottery.filter((l) => l.flags.length).map((l) => ({ pickKey: l.pickKey, flags: l.flags }));
  const dups = possibleDuplicates(clippers);

  const counts: Record<string, number> = {
    moves: data.moves.length,
    clippersMoves: clippers.length,
    clippersIncomplete: clippers.filter((m) => !m.complete).length,
    people: data.people.length,
    picks: data.picks.length,
    futurePicks: data.picks.filter((p) => p.status === 'future').length,
    swaps: data.swaps.length,
    lottery: data.lottery.length,
    salaries: data.salaries.length,
    payrollSeasons: data.payrollSeasons.length,
    contracts: data.contracts.length,
    coachSeasons: data.coachSeasons.length,
    execTerms: data.execTerms.length,
    honors: data.honors.length,
    unparsed: data.unparsed.length,
    ignored: data.ignored.length,
    skipped: data.skipped.length,
    ...Object.fromEntries(Object.entries(skippedByReason).map(([k, v]) => [`skipped.${k}`, v])),
    unmatchedPeople: unmatchedPeople.length,
    ambiguousPeople: ambiguousPeople.length,
    ...Object.fromEntries(GAP_REASONS.map((g) => [`gaps.${g}`, gaps[g].length])),
    conflicts: conflicts.length,
    chainBreaks: data.breaks.length,
    disputes: data.disputes.length,
    unkeyed: data.unkeyed.length,
    futureWithoutProtections: futureWithoutProtections.length,
    unsettledSwaps: unsettledSwaps.length,
    partialPayrolls: partialPayrolls.length,
    staleOverrides: staleOverrides.length,
    tieUnresolved: tieUnresolved.length,
    lotteryFlags: lotteryFlags.length,
    skippedCategories: data.skippedCategories.length,
    possibleDuplicates: dups.length,
  };

  return {
    counts, bySeasonKind, unparsed: data.unparsed, ignored: data.ignored, skippedByReason, unmatchedPeople, ambiguousPeople,
    gaps, conflicts, chainBreaks: data.breaks, disputes: data.disputes, unkeyed: data.unkeyed, futureWithoutProtections,
    unsettledSwaps, partialPayrolls, staleOverrides, tieUnresolved, lotteryFlags, skippedCategories: data.skippedCategories,
    possibleDuplicates: dups,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Non-empty blocks a real write (unless --allow-gaps). */
export function gateFailures(r: FranchiseReport): string[] {
  const out: string[] = [];
  if (r.unparsed.length) out.push(`${plural(r.unparsed.length, 'unparsed line', 'unparsed lines')} not marked ignored`);
  if (r.futureWithoutProtections.length) {
    out.push(`${plural(r.futureWithoutProtections.length, 'future pick', 'future picks')} without known protections`);
  }
  return out;
}

/** The short console summary (the full report goes to data/franchise-report.json). */
export function summarizeReport(r: FranchiseReport): string[] {
  const c = r.counts;
  const byReason = Object.entries(r.skippedByReason).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
  const gaps = Object.entries(r.gaps).map(([k, v]) => `${k} ${v.length}`).join(', ');
  const gates = gateFailures(r);
  return [
    `moves: ${c.moves} (${c.clippersMoves} Clippers, ${c.clippersIncomplete} incomplete); picks: ${c.picks} (${c.futurePicks} future); swaps: ${c.swaps}; lottery: ${c.lottery}`,
    `people: ${c.people} (${c.unmatchedPeople} unmatched, ${c.ambiguousPeople} ambiguous); salaries: ${c.salaries}; contracts: ${c.contracts}; coach seasons: ${c.coachSeasons}; exec terms: ${c.execTerms}; honors: ${c.honors}`,
    `unparsed: ${c.unparsed} (${c.ignored} ignored)`,
    `skipped: ${byReason}`,
    `gaps: ${gaps}`,
    `conflicts: ${c.conflicts}; possible duplicates: ${c.possibleDuplicates}; chain breaks: ${c.chainBreaks}; chain disputes: ${c.disputes}; unkeyed draft rows: ${c.unkeyed}`,
    `future picks without protections: ${c.futureWithoutProtections}; unsettled past swaps: ${c.unsettledSwaps}; partial payrolls: ${c.partialPayrolls}`,
    `lottery: ${c.tieUnresolved} tie unresolved, ${c.lotteryFlags} flagged; skipped award categories: ${c.skippedCategories}; stale overrides: ${c.staleOverrides}`,
    gates.length ? `GATES FAILING: ${gates.join('; ')}` : 'gates: clear',
  ];
}
