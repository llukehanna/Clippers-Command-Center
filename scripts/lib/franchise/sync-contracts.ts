// scripts/lib/franchise/sync-contracts.ts
// The weekly contracts and current-season job (scripts/sync-franchise-contracts.ts is the thin entry point; spec §3.5).
// Two BBRef pages, 6,000 ms apart (fetchAll, bbrefCap 2): /contracts/LAC.html and the current season's transactions
// page; plus the current Wikipedia season page. Then, in one database transaction, in job mode (adds rows and fills
// nulls, never deletes):
//   - the contracts snapshot is replaced (write.ts writeContracts: the new snapshot goes in, then the old one goes);
//   - the current season's salaries are upserted from the contracts page's column for this season (it matches the
//     team page's salary table, which is a third page the job doesn't fetch);
//   - this season's incomplete Clippers trades are read back from the database and reconciled with the fresh BBRef and
//     Wikipedia readings as the import does (the stored row is the base, as NBA.com is in the import), so the picks
//     behind NBA.com's "draft consideration" can be filled; then applyMoveOverrides -> buildPicks -> applyOverrides.
//     The writer rewrites an incomplete row only when this version is strictly better. Pick identities are never
//     guessed: a pick no source names stays `pick_unidentified` and the trade is listed in `stillIncomplete`.
// Ruling R16: every source key the job adds (transactions.sources, salaries.source) starts with `weekly:`, so the
// import, whose deletes only touch rows sourced entirely by bbref:/wiki:/override:, never deletes them. contracts has
// no source column: the import only replaces a snapshot with a newer page (writeContracts compares fetched_at).
//
// Anything wrong stops the run before the database is touched, so the old snapshot stays: any non-200 (FetchStopped,
// naming the page), a page whose shape changed (FeedShapeError: no contracts rows, no column for this season, no list
// of moves), or a line no parser or override reads (UnparsedLinesError). Fetched pages go to a temp dir, never data/.
//
// People: as the nightly job, person_xref plus `players` plus the override links. A BBRef id new to person_xref gets a
// row; when its move part also carries an NBA.com id an `nba:` row holds, the writer merges that row into it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'node-html-parser';
import type { Db } from '../history/write.js';
import { applyMoveOverrides, applyOverrides } from './apply-overrides.js';
import { parseTransactionPage } from './bbref-moves.js';
import { parseContracts } from './bbref-tables.js';
import { defaultDraftYear } from './build-dataset.js';
import { buildContracts, buildSalaries, completePeople } from './build-tables.js';
import { seasonOfDate } from './describe.js';
import { cachePath, fetchAll, FetchStopped, manifestKey, readManifest, type FetchDeps, type SourceSpec } from './fetcher.js';
import { OVERRIDES } from './overrides.js';
import { buildIndex, resolveRef, type DbPlayer, type PersonRow } from './people.js';
import { buildPicks } from './picks.js';
import { reconcileMoves, type MergedMove } from './reconcile-moves.js';
import { bbrefSources, wikiSeasonTitle, wikiSources } from './sources.js';
import { pacificDate } from './sync-moves.js';
import type { AssetKind, FranchiseDataset, FranchiseId, GapReason, MovePart, Override, ParsedMove, PickRef, SwapRef, UnparsedLine } from './types.js';
import { parseSeasonTrades } from './wiki-season.js';
import { writeFranchise } from './write.js';

/** R16: the prefix of every source key the weekly job writes. */
export const WEEKLY_PREFIX = 'weekly:';
/** salaries.source of the current-season rows the job writes. */
export const SALARY_SOURCE = `${WEEKLY_PREFIX}bbref:contracts`;

/** A fetched page or parse that can't be trusted: nothing is written. */
export class FeedShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedShapeError';
  }
}

/** The run stopped before writing: lines no parser or override could read. */
export class UnparsedLinesError extends Error {
  constructor(public readonly lines: UnparsedLine[]) {
    super(`${lines.length} unparsed line(s); nothing written. Settle them with an override in overrides.ts:\n` +
      lines.map((l) => `  ${l.source} ${l.date ?? '(no date)'} ${l.text}`).join('\n'));
    this.name = 'UnparsedLinesError';
  }
}

// ---- fetch -------------------------------------------------------------------------

export interface WeeklyPages {
  contractsHtml: string;
  /** When the contracts page was fetched (ISO): the snapshot's id. */
  contractsFetchedAt: string;
  transactionsHtml: string;
  /** Cache key of the transactions page, e.g. `LAC-2027_transactions` (overrides match lines by it). */
  transactionsPage: string;
  wiki: { title: string; wikitext: string };
}

/** The import's own specs (sources.ts) for the job's three pages: two BBRef, one Wikipedia. */
export function weeklySpecs(season: number): SourceSpec[] {
  const bbref = bbrefSources(season, season).filter((s) => s.key === 'contracts' || s.key.endsWith('_transactions'));
  const wiki = wikiSources(season, season, []).filter((s) => s.title === wikiSeasonTitle(season));
  return [...bbref, ...wiki];
}

/** Fetches the three pages into a temp dir (removed after). Throws FetchStopped on any non-200. */
export async function fetchWeekly(season: number, deps: FetchDeps): Promise<WeeklyPages> {
  const specs = weeklySpecs(season);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccc-franchise-weekly-'));
  try {
    await fetchAll(specs, dir, deps, { refresh: new Set(), bbrefCap: 2 });
    // fetchAll stops on a BBRef non-200 itself; a failed Wikipedia page is only recorded.
    const manifest = readManifest(dir);
    for (const s of specs) {
      const status = manifest[manifestKey(s)]?.status ?? 0;
      if (status !== 200) throw new FetchStopped(manifestKey(s), status);
    }
    const text = (s: SourceSpec) => fs.readFileSync(cachePath(dir, s), 'utf8');
    const contracts = specs.find((s) => s.key === 'contracts')!;
    const tx = specs.find((s) => s.key.endsWith('_transactions'))!;
    const wiki = JSON.parse(text(specs.find((s) => s.source === 'wiki')!)) as { title: string; wikitext: string };
    return {
      contractsHtml: text(contracts), contractsFetchedAt: manifest[manifestKey(contracts)].fetchedAt,
      transactionsHtml: text(tx), transactionsPage: tx.key, wiki: { title: wiki.title, wikitext: wiki.wikitext },
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---- stored trades -----------------------------------------------------------------

export interface StoredPart {
  from: FranchiseId | null;
  to: FranchiseId | null;
  kind: AssetKind;
  personKey: string | null;
  personName: string | null;
  nbaPersonId: number | null;
  /** The linked draft_picks row. */
  pick: { year: number; round: number; originalFranchiseId: FranchiseId; protectionsText: string | null } | null;
  /** The linked pick_swaps row. */
  swap: { year: number; round: number; franchiseA: FranchiseId; franchiseB: FranchiseId; protectionsText: string | null } | null;
  text: string | null;
  gap: GapReason | null;
}

/** A stored incomplete trade with its parts in order. */
export interface StoredTrade {
  transactionKey: string;
  date: string;
  involvesClippers: boolean;
  sources: string[];
  parts: StoredPart[];
}

/** A stored row read back as a move: linked people, picks and swaps by their ids, the rest as written (text, gap). */
export function storedToMove(t: StoredTrade): ParsedMove {
  const parts = t.parts.map((p): MovePart => {
    const out: MovePart = { from: p.from, to: p.to, kind: p.kind };
    if (p.personKey) {
      out.person = {
        name: p.personName ?? '',
        ...(p.personKey.includes(':') ? {} : { bbrefId: p.personKey }),
        ...(p.nbaPersonId != null ? { nbaPersonId: p.nbaPersonId } : {}),
      };
      out.personKey = p.personKey;
    }
    if (p.pick) {
      const pick: PickRef = { year: p.pick.year, round: p.pick.round, originalFranchiseId: p.pick.originalFranchiseId };
      if (p.pick.protectionsText) pick.protectionsText = p.pick.protectionsText;
      out.pick = pick;
    }
    if (p.swap) {
      const swap: SwapRef = { year: p.swap.year, round: p.swap.round, franchiseA: p.swap.franchiseA, franchiseB: p.swap.franchiseB };
      if (p.swap.protectionsText) swap.protectionsText = p.swap.protectionsText;
      out.swap = swap;
    }
    if (p.text != null) out.text = p.text;
    if (p.gap != null) out.gap = p.gap;
    return out;
  });
  return { sourceKey: t.transactionKey, date: t.date, kind: 'trade', parts, involvesClippers: t.involvesClippers, complete: false };
}

// ---- build (pure) ------------------------------------------------------------------

export interface WeeklyInput {
  /** Season start year (2026 = 2026-27). */
  season: number;
  pages: WeeklyPages;
  /** This season's stored Clippers trades with is_complete = false. */
  incomplete: StoredTrade[];
  /** person_xref. */
  people: PersonRow[];
  players: DbPlayer[];
  overrides: Override[];
  currentDraftYear: number;
}

const seasonLabel = (s: number) => `${s}-${String((s + 1) % 100).padStart(2, '0')}`;

/**
 * The week's dataset: the contracts snapshot, this season's salaries, the stored incomplete trades a fresh page lists
 * (with the picks they point at) and the people those rows need; plus the lines still unparsed. Throws FeedShapeError.
 */
export function buildWeekly(input: WeeklyInput): { data: FranchiseDataset; unparsed: UnparsedLine[] } {
  const { season, pages, overrides } = input;

  // Contracts and this season's salaries.
  const contractRows = parseContracts(pages.contractsHtml);
  if (!contractRows.length) throw new FeedShapeError('contracts page has no contracts rows (table#contracts): its shape changed; nothing written');
  // The page's first salary column is the season it describes: an older page (BBRef not rolled over yet) is no snapshot
  // of this season.
  const first = Math.min(...contractRows.flatMap((r) => r.seasons.map((s) => s.seasonId)));
  if (first !== season) {
    throw new FeedShapeError(`contracts page starts at ${Number.isFinite(first) ? seasonLabel(first) : 'no season'}, not ${seasonLabel(season)}; nothing written`);
  }
  const salaryRows = contractRows.flatMap((r) => r.seasons.filter((s) => s.seasonId === season).map((s) => ({ bbrefId: r.bbrefId, name: r.name, amountUsd: s.amountUsd })));
  const contracts = buildContracts(contractRows, pages.contractsFetchedAt).contracts;
  const { salaries } = buildSalaries([{ seasonId: season, source: SALARY_SOURCE, rows: salaryRows }], new Map());

  // The fresh readings of this season's moves.
  if (!parse(pages.transactionsHtml).querySelector('ul.page_index > li')) {
    throw new FeedShapeError(`transactions page ${pages.transactionsPage} has no list of moves (ul.page_index): its shape changed; nothing written`);
  }
  const bbref = parseTransactionPage(pages.transactionsHtml, season, pages.transactionsPage);
  const wiki = parseSeasonTrades(pages.wiki.wikitext, season, pages.wiki.title);

  // As build-dataset: `person` overrides tying an NBA.com id to a BBRef id.
  const links = overrides.flatMap((o) => (o.kind === 'person' && /^nba:\d+$/.test(o.match.ref) && !o.personKey.startsWith('nba:') && !o.match.scope
    ? [{ bbrefId: o.personKey, nbaPersonId: Number(o.match.ref.slice(4)) }] : []));
  const index = buildIndex(input.people, new Map(), input.players, links);
  // The stored row is the base reading (NBA.com's rank); BBRef and Wikipedia fill what it doesn't say.
  const reconciled = reconcileMoves({ nba: input.incomplete.map(storedToMove), bbref: bbref.moves, wiki: wiki.moves, index });
  const p1 = applyMoveOverrides({ moves: reconciled, unparsed: [...bbref.unparsed, ...wiki.unparsed], draftRows: [] }, overrides);

  // Only stored trades a fresh page lists: the job adds no other moves (the nightly job does). A fresh key can equal a
  // stored one (an import-only row keyed by its BBRef line), so "fresh" is by the parsers' keys, not by absence.
  const stored = new Map(input.incomplete.map((t) => [t.transactionKey, t]));
  const freshKeys = new Set([...bbref.moves, ...wiki.moves].map((m) => m.sourceKey));
  const fresh = (m: MergedMove) => [...new Set(m.sources.filter((s) => freshKeys.has(s) || !stored.has(s)))];
  const storedOf = (m: MergedMove) => m.sources.map((s) => stored.get(s)).find((t) => t != null);
  // One move per stored row: the group holding the stored reading (the most sources) wins.
  const taken = new Set<string>();
  const matched = p1.moves
    .filter((m) => storedOf(m) && fresh(m).length)
    .sort((a, b) => b.sources.length - a.sources.length)
    .filter((m) => !taken.has(storedOf(m)!.transactionKey) && !!taken.add(storedOf(m)!.transactionKey));
  const pr = buildPicks(matched, { bbref: [], wiki: [], espn: new Map(), forfeited: [], originals: p1.originals }, input.currentDraftYear);
  const moves = pr.moves.map((m): MergedMove => {
    const row = storedOf(m)!;
    const added = fresh(m).map((s) => `${WEEKLY_PREFIX}${s}`).filter((s) => !row.sources.includes(s));
    return {
      ...m,
      // The stored key, so the writer matches the row; R16: every source the job adds is prefixed.
      transactionKey: row.transactionKey,
      sources: [...row.sources, ...added],
      parts: m.parts.map((p) => {
        if (!p.person || p.personKey) return p;
        const key = resolveRef(p.person, index, season);
        return key ? { ...p, personKey: key } : p;
      }),
    };
  });
  const usedPicks = new Set(moves.flatMap((m) => m.parts.map((p) => p.pickKey).filter(Boolean)));
  const usedSwaps = new Set(moves.flatMap((m) => m.parts.map((p) => p.swapKey).filter(Boolean)));

  // New people only. `nba:` rows stay out of the base, so a BBRef id arriving with the NBA.com id such a row holds gets
  // that id (and the writer merges the `nba:` row into it).
  const known = new Set(input.people.map((p) => p.personKey));
  const people = completePeople(input.people.filter((p) => !p.personKey.startsWith('nba:')), {
    moves, picks: [], draftNames: new Map(), coachSeasons: [], execTerms: [], salaries: [], contracts: contractRows, dbPlayers: input.players,
  }).filter((p) => !known.has(p.personKey));

  const assembled: FranchiseDataset = {
    currentDraftYear: input.currentDraftYear, people, moves,
    picks: pr.picks.filter((p) => usedPicks.has(p.pickKey)), swaps: pr.swaps.filter((s) => usedSwaps.has(s.swapKey)), lottery: [],
    salaries, payrollSeasons: [], contracts, coachSeasons: [], execTerms: [], honors: [],
    unparsed: p1.unparsed, ignored: [], dropped: p1.dropped, skipped: bbref.skipped, peopleUnmatched: [], peopleAmbiguous: [],
    breaks: [], disputes: [], unkeyed: [], skippedCategories: [],
  };
  const { data } = applyOverrides(assembled, overrides);
  return { data, unparsed: data.unparsed };
}

// ---- database ----------------------------------------------------------------------

interface PartRow {
  transaction_id: string; transaction_key: string; date: string; involves_clippers: boolean; sources: string[];
  part_id: string | null; from_franchise_id: number | null; to_franchise_id: number | null; asset_kind: AssetKind | null;
  person_key: string | null; display_name: string | null; nba_person_id: number | null; unlinked_text: string | null;
  gap_reason: GapReason | null; pick_year: number | null; pick_round: number | null; pick_original: number | null;
  pick_protections: string | null; swap_year: number | null; swap_round: number | null; swap_a: number | null;
  swap_b: number | null; swap_protections: string | null;
}

/** This season's stored Clippers trades with is_complete = false, parts in order. */
async function loadIncomplete(db: Db, season: number): Promise<Array<StoredTrade & { id: string }>> {
  const rows = await db<PartRow[]>`
    SELECT t.transaction_id::text, t.transaction_key, t.date::text, t.involves_clippers, t.sources,
           p.part_id::text, p.from_franchise_id, p.to_franchise_id, p.asset_kind, p.person_key, x.display_name,
           x.nba_person_id, p.unlinked_text, p.gap_reason,
           d.draft_year AS pick_year, d.round AS pick_round, d.original_franchise_id AS pick_original, d.protections_text AS pick_protections,
           s.draft_year AS swap_year, s.round AS swap_round, s.franchise_a AS swap_a, s.franchise_b AS swap_b, s.protections_text AS swap_protections
    FROM transactions t
    LEFT JOIN transaction_parts p ON p.transaction_id = t.transaction_id
    LEFT JOIN person_xref x ON x.person_key = p.person_key
    LEFT JOIN draft_picks d ON d.pick_id = p.pick_id
    LEFT JOIN pick_swaps s ON s.swap_id = p.swap_id
    WHERE t.season_id = ${season} AND t.kind = 'trade' AND t.involves_clippers AND NOT t.is_complete AND t.date IS NOT NULL
    ORDER BY t.date, t.transaction_id, p.part_id`;
  const out = new Map<string, StoredTrade & { id: string }>();
  for (const r of rows) {
    let t = out.get(r.transaction_id);
    if (!t) {
      t = { id: r.transaction_id, transactionKey: r.transaction_key, date: r.date, involvesClippers: r.involves_clippers, sources: r.sources, parts: [] };
      out.set(r.transaction_id, t);
    }
    if (r.part_id == null) continue;
    t.parts.push({
      from: r.from_franchise_id, to: r.to_franchise_id, kind: r.asset_kind!, personKey: r.person_key, personName: r.display_name,
      nbaPersonId: r.nba_person_id, text: r.unlinked_text, gap: r.gap_reason,
      pick: r.pick_year != null ? { year: r.pick_year, round: r.pick_round!, originalFranchiseId: r.pick_original!, protectionsText: r.pick_protections } : null,
      swap: r.swap_year != null ? { year: r.swap_year, round: r.swap_round!, franchiseA: r.swap_a!, franchiseB: r.swap_b!, protectionsText: r.swap_protections } : null,
    });
  }
  return [...out.values()];
}

/** Linked pick and swap parts on these transactions. */
async function linkedPicks(db: Db, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const [r] = await db<{ n: number }[]>`
    SELECT count(*)::int AS n FROM transaction_parts
    WHERE transaction_id = ANY(${ids}::bigint[]) AND (pick_id IS NOT NULL OR swap_id IS NOT NULL)`;
  return r.n;
}

export interface SyncContractsDeps {
  fetch: FetchDeps['fetch'];
  sleep(ms: number): Promise<void>;
  db: Db;
  now(): Date;
  /** Default OVERRIDES (overrides.ts). */
  overrides?: Override[];
  log?: (line: string) => void;
}

export interface SyncContractsResult {
  /** Season start year the run read. */
  season: number;
  /** Contract rows of the new snapshot (0: the stored snapshot was as new). */
  contracts: number;
  /** Current-season salary rows inserted or filled. */
  salaries: number;
  /** Pick and swap parts newly linked on this season's incomplete trades. */
  filledPicks: number;
  /** This season's Clippers trades still is_complete = false after the run. */
  stillIncomplete: string[];
  /** Rows the writer couldn't write (no person_xref row), never dropped silently. */
  skipped: number;
}

export async function syncContracts(deps: SyncContractsDeps): Promise<SyncContractsResult> {
  const { db } = deps;
  const log = deps.log ?? (() => {});
  const now = deps.now();
  const season = seasonOfDate(pacificDate(now));
  const pages = await fetchWeekly(season, { fetch: deps.fetch, sleep: deps.sleep, now: () => deps.now().getTime() });

  const people = [...await db<PersonRow[]>`
    SELECT person_key AS "personKey", kind, display_name AS "displayName", birthdate::text AS birthdate,
           nba_person_id AS "nbaPersonId", player_id::text AS "playerId"
    FROM person_xref`];
  const players = [...await db<DbPlayer[]>`
    SELECT player_id::text, nba_person_id, display_name, birthdate::text AS birthdate FROM players`];
  const incomplete = await loadIncomplete(db, season);
  const { data, unparsed } = buildWeekly({
    season, pages, incomplete, people, players, overrides: deps.overrides ?? OVERRIDES, currentDraftYear: defaultDraftYear(now),
  });
  if (unparsed.length) throw new UnparsedLinesError(unparsed);
  log(`${season} season: ${data.contracts.length} contract rows, ${data.salaries.length} salaries, ${data.moves.length} of ${incomplete.length} incomplete trade(s) listed again`);

  const ids = incomplete.map((t) => t.id);
  const before = incomplete.reduce((n, t) => n + t.parts.filter((p) => p.pick || p.swap).length, 0);
  let result: SyncContractsResult | undefined;
  await db.begin(async (t) => {
    const tx = t as unknown as Db;
    const res = await writeFranchise(tx, data, { kind: 'job', job: 'weekly' });
    for (const s of res.skipped) log(`skipped ${s.table}: ${s.reason}`);
    const stillIncomplete = (await tx<{ transaction_key: string }[]>`
      SELECT transaction_key FROM transactions
      WHERE season_id = ${season} AND kind = 'trade' AND involves_clippers AND NOT is_complete
      ORDER BY date, transaction_key`).map((r) => r.transaction_key);
    result = {
      season, contracts: res.inserted.contracts ?? 0,
      salaries: (res.inserted.salaries ?? 0) + (res.updated.salaries ?? 0),
      filledPicks: Math.max(0, (await linkedPicks(tx, ids)) - before), stillIncomplete, skipped: res.skipped.length,
    };
  });
  return result!;
}
