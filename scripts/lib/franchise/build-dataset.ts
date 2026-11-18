// scripts/lib/franchise/build-dataset.ts
// Reads the raw cache (data/franchise-raw, written by fetch-franchise-sources) and runs every parser, reconciler and
// override phase into one FranchiseDataset plus its review report (spec §3). Reads files only; the database rows it
// needs come in through `db`. Shared by the import CLI and the jobs.
//
// Order (Task 13): parse -> reconcileMoves -> applyMoveOverrides (move/merge/drop/create, part identity, draft-row
// originals) -> buildPicks (draft incl. originals) -> buildLottery (collectWikiLottery) -> season tables, honors and
// people -> applyOverrides (protections/person/ignore/teamName) -> buildReport(data, stale, invalid).
//
// Cache layout (<dir>/<source>/<key>.<ext>, plus manifest.json): a file counts only when the manifest has it at status
// 200. BBRef `<BUF|SDC|LAC>-<endYear>.html` (team season: roster, salaries, coach line) and `…_transactions.html` (season
// = endYear - 1), `draft.html`, `coaches.html`, `executives.html`, `contracts.html`; Wikipedia `wiki/<Title>.json` =
// { title, resolvedTitle, wikitext } (Clippers season pages, `<Y>_NBA_draft`, `Los_Angeles_Clippers`, counterparty
// season pages); ESPN `espn/draft-<Y>.json`; NBA.com `nba/movement.json`.
//
// Covered seasons (the writer's `seasons`): those whose BBRef transactions page AND team-season page are both cached.
// Every in-range season that isn't covered is reported (checks.uncoveredSeasons), with the missing page and its status.
// Honors and the people they name resolve against EVERY cached season's roster and coaches, whatever the range; a run
// over part of the cached seasons never prunes undated honors (Hall of Fame, retired numbers).
// `--only` narrows the dataset to some tables, and the write scope with it, so a partial run can never delete rows
// another part of the import owns (ONLY_TABLES says which tables each value writes).
import fs from 'node:fs';
import path from 'node:path';
import { normalizePersonName } from '../player-match.js';
import { applyMoveOverrides, applyOverrides } from './apply-overrides.js';
import { parseTransactionPage } from './bbref-moves.js';
import {
  parseCoachStints, parseCoaches, parseContracts, parseExecutives, parseFranchiseDraft, parseRoster, parseSalaries,
  type CoachSeasonRow, type DraftRow, type RosterRow,
} from './bbref-tables.js';
import {
  buildCoachSeasons, buildContracts, buildExecTerms, buildSalaries, checkCoachStints, completePeople, kindOfBbrefId,
  resolveHonors, type PlayoffRecord, type SalaryPage,
} from './build-tables.js';
import { collectCounterparties } from './counterparties.js';
import { seasonOfDate } from './describe.js';
import { parseEspnDraftRounds } from './espn.js';
import { readManifest } from './fetcher.js';
import { buildLottery, collectWikiLottery, type TeamSeasonRow } from './lottery.js';
import { parseMovement } from './nba-movement.js';
import { OVERRIDES } from './overrides.js';
import { buildIndex, matchPeople, resolveRef, type DbPlayer } from './people.js';
import { buildPicks } from './picks.js';
import { reconcileMoves, type MergedMove } from './reconcile-moves.js';
import { buildReport, type FranchiseReport } from './report.js';
import { bbrefEra, wikiKey, wikiSeasonTitle } from './sources.js';
import type { FranchiseDataset, Override, ParsedMove, UnparsedLine } from './types.js';
import { parseDraftPage, type DraftPickRow, type ForfeitedPick } from './wiki-draft.js';
import { parseSeasonTrades } from './wiki-season.js';
import { parseTeamArticle } from './wiki-team.js';

const NBA_ERA_START = '2015-07-01';
const ESPN_FIRST_DRAFT = 2003;
const FIRST_LOTTERY = 1985;
/** Drafts read past the last season: the next one plus the seven after it (picks owed). */
const FUTURE_DRAFTS = 8;
/** R15's unmerged check: signings and waivers, compared within a family (a signing never pairs with a waiver). */
const SIGNING_FAMILY: Record<string, string> = {
  signing: 'in', re_signing: 'in', extension: 'in', two_way: 'in', ten_day: 'in', conversion: 'in',
  claim: 'claim', waiver: 'out', release: 'out',
};

/** Source prefixes the import owns (the writer may delete its own stale rows carrying only these). */
export const IMPORT_SOURCES = ['bbref:', 'wiki:', 'override:'];

export const ONLY_VALUES = ['draft', 'trades', 'moves', 'salaries', 'people', 'honors'] as const;
export type OnlyValue = (typeof ONLY_VALUES)[number];
/** What each --only value writes. person_xref is upserted by every run (never deleted). */
export const ONLY_TABLES: Record<OnlyValue, string> = {
  draft: 'draft_picks, pick_swaps, draft_lottery',
  trades: 'transactions of kind trade (+ parts), draft_picks, pick_swaps, draft_lottery; never deletes transactions',
  moves: 'transactions (+ parts), draft_picks, pick_swaps, draft_lottery',
  salaries: 'salaries, payroll_seasons, contracts',
  people: 'person_xref, coach_seasons, executive_terms',
  honors: 'honors',
};

export interface DbInput {
  players: DbPlayer[];
  teamSeasons: TeamSeasonRow[];
  /** Players with at least one game for the Clippers, by season (Part 1's player_seasons). */
  playersBySeason?: Map<number, number>;
  /** The Clippers' playoff W-L by season (Part 1's games). */
  playoffs?: Map<number, PlayoffRecord>;
}

export interface BuildOptions {
  /** Season start years. */
  from: number;
  to: number;
  only?: OnlyValue | null;
  /** The next draft not yet held. Default: this year's until July, then next year's. */
  currentDraftYear?: number;
  overrides?: Override[];
}

export interface WriteScope {
  importSources: string[];
  seasons: number[];
  /** False when the range leaves out cached seasons: undated honors can't all resolve, so none are pruned. */
  pruneUndatedHonors: boolean;
}

export interface ImportChecks {
  coveredSeasons: number[];
  /** In-range seasons whose BBRef team or transactions page isn't cached at status 200, and why. */
  uncoveredSeasons: string[];
  writeScope: WriteScope;
  /** Moves NBA.com and BBRef both list that merged into one (R15). */
  nbaBbrefMerged: number;
  /** 2015-16+ Clippers signings/waivers listed by both NBA.com and BBRef that didn't merge (R15: DB players lack ids). */
  unmergedSignings: Array<{ name: string; date: string; nba: string; bbref: string }>;
  /** Draft pages whose title redirects elsewhere (e.g. 2027 -> "NBA draft"). */
  draftPagesSkipped: string[];
  lotteryFailedYears: number[];
  contractDuplicates: string[];
  coachStintMismatches: string[];
  execPartialDates: string[];
  counterparties: { listed: number; read: number; moves: number; clippersTradesLeftOut: number };
  /** Inputs the run worked without (Part 1 tables empty, files not cached). */
  degraded: string[];
}

export interface BuiltDataset {
  data: FranchiseDataset;
  report: FranchiseReport;
  /** counterparties.json: the Wikipedia pages trade trees need (spec §2 second pass). */
  counterparties: string[];
  checks: ImportChecks;
}

// ---- the cache ------------------------------------------------------------------------------------------------------

interface WikiPage { title: string; resolvedTitle?: string; wikitext: string }

function openCache(dir: string) {
  const manifest = readManifest(dir);
  const file = (key: string) => path.join(dir, `${key}.${key.startsWith('bbref/') ? 'html' : 'json'}`);
  const ok = (key: string) => manifest[key]?.status === 200 && fs.existsSync(file(key));
  const text = (key: string) => (ok(key) ? fs.readFileSync(file(key), 'utf8') : null);
  const json = <T>(key: string): T | null => {
    const t = text(key);
    return t == null ? null : (JSON.parse(t) as T);
  };
  return { manifest, ok, text, json, wiki: (title: string) => json<WikiPage>(`wiki/${wikiKey(title)}`) };
}

export function defaultDraftYear(now = new Date()): number {
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
}

// ---- checks ----------------------------------------------------------------------------------------------------------

const prefixes = (m: MergedMove) => new Set(m.sources.map((s) => s.slice(0, s.indexOf(':') + 1)));

function unmergedSignings(moves: MergedMove[]): ImportChecks['unmergedSignings'] {
  const pick = (only: string) => moves.filter((m) => {
    const p = prefixes(m);
    return m.involvesClippers && m.date >= NBA_ERA_START && m.kind in SIGNING_FAMILY && p.size === 1 && p.has(only);
  });
  const names = (m: MergedMove) => new Set(m.parts.map((p) => normalizePersonName(p.person?.name)).filter(Boolean));
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  const out: ImportChecks['unmergedSignings'] = [];
  const bbref = pick('bbref:');
  for (const n of pick('nba:')) {
    const nn = names(n);
    for (const b of bbref) {
      if (SIGNING_FAMILY[n.kind] !== SIGNING_FAMILY[b.kind] || Math.abs(day(n.date) - day(b.date)) > 3) continue;
      const shared = b.parts.find((p) => p.person && nn.has(normalizePersonName(p.person.name)));
      if (shared) out.push({ name: shared.person!.name, date: n.date, nba: n.transactionKey, bbref: b.transactionKey });
    }
  }
  return out;
}

// ---- --only ------------------------------------------------------------------------------------------------------------

export function writeScope(only: OnlyValue | null | undefined, covered: number[], fullRange: boolean): WriteScope {
  const pruneUndatedHonors = fullRange;
  switch (only) {
    case 'trades': return { importSources: IMPORT_SOURCES, seasons: [], pruneUndatedHonors }; // never prunes other moves
    case 'salaries': return { importSources: ['bbref:'], seasons: covered, pruneUndatedHonors };
    case 'draft': case 'people': case 'honors': return { importSources: [], seasons: covered, pruneUndatedHonors };
    default: return { importSources: IMPORT_SOURCES, seasons: covered, pruneUndatedHonors };
  }
}

function narrow(d: FranchiseDataset, only: OnlyValue | null | undefined, isDraftLine: (l: UnparsedLine) => boolean): FranchiseDataset {
  if (!only) return d;
  const moves = only === 'moves' || only === 'trades';
  const picks = moves || only === 'draft';
  const lines = (l: UnparsedLine) => (moves ? true : only === 'draft' ? isDraftLine(l) : false);
  return {
    ...d,
    moves: only === 'moves' ? d.moves : only === 'trades' ? d.moves.filter((m) => m.kind === 'trade') : [],
    picks: picks ? d.picks : [], swaps: picks ? d.swaps : [], lottery: picks ? d.lottery : [],
    breaks: picks ? d.breaks : [], disputes: picks ? d.disputes : [], unkeyed: picks ? d.unkeyed : [],
    salaries: only === 'salaries' ? d.salaries : [], payrollSeasons: only === 'salaries' ? d.payrollSeasons : [],
    contracts: only === 'salaries' ? d.contracts : [],
    coachSeasons: only === 'people' ? d.coachSeasons : [], execTerms: only === 'people' ? d.execTerms : [],
    honors: only === 'honors' ? d.honors : [], skippedCategories: only === 'honors' ? d.skippedCategories : [],
    unparsed: d.unparsed.filter(lines), ignored: d.ignored.filter(lines),
    dropped: moves ? d.dropped : [], skipped: moves ? d.skipped : [],
  };
}

// ---- build -------------------------------------------------------------------------------------------------------------

export function buildDataset(dir: string, db: DbInput, opts: BuildOptions): BuiltDataset {
  const cache = openCache(dir);
  const overrides = opts.overrides ?? OVERRIDES;
  const currentDraftYear = opts.currentDraftYear ?? defaultDraftYear();
  const inRange = (s: number) => s >= opts.from && s <= opts.to;
  const degraded: string[] = [];

  // BBRef team seasons and transactions, the Clippers' Wikipedia season pages.
  const bbref: ParsedMove[] = [], wiki: ParsedMove[] = [], unparsed: UnparsedLine[] = [];
  const skipped: FranchiseDataset['skipped'] = [];
  const rosterBySeason = new Map<number, RosterRow[]>();
  const salaryPages: SalaryPage[] = [];
  const coachRows: CoachSeasonRow[] = [];
  const covered: number[] = [];
  const uncovered: string[] = [];
  // Every cached team season: rosters and coaches for honors and their people, whatever the range.
  const allRosters = new Map<number, RosterRow[]>();
  const allCoachRows: CoachSeasonRow[] = [];
  const cachedTeamSeasons = Object.keys(cache.manifest)
    .map((k) => /^bbref\/(?:BUF|SDC|LAC)-(\d{4})$/.exec(k))
    .filter((m): m is RegExpExecArray => m != null)
    .map((m) => Number(m[1]) - 1)
    .filter((s) => cache.ok(`bbref/${bbrefEra(s + 1)}-${s + 1}`))
    .sort((a, b) => a - b);
  for (const s of cachedTeamSeasons) {
    const page = `${bbrefEra(s + 1)}-${s + 1}`;
    const team = cache.text(`bbref/${page}`) as string;
    const roster = parseRoster(team);
    const coaches = parseCoaches(team);
    allRosters.set(s, roster);
    allCoachRows.push(...coaches);
    if (!inRange(s)) continue;
    rosterBySeason.set(s, roster);
    salaryPages.push({ seasonId: s, source: `bbref:${page}`, rows: parseSalaries(team) });
    coachRows.push(...coaches);
  }
  const fullRange = cachedTeamSeasons.every(inRange);
  for (let s = opts.from; s <= opts.to; s++) {
    const page = `${bbrefEra(s + 1)}-${s + 1}`;
    const team = rosterBySeason.has(s);
    const tx = cache.text(`bbref/${page}_transactions`);
    const missing = [page, `${page}_transactions`].filter((k) => !cache.ok(`bbref/${k}`)).map((k) => {
      const status = cache.manifest[`bbref/${k}`]?.status;
      return `${k} ${status == null ? 'not fetched' : status === 200 ? 'file missing' : `HTTP ${status}`}`;
    });
    if (missing.length) uncovered.push(`season ${s} not covered: ${missing.join(', ')}`);
    if (tx != null) {
      const p = parseTransactionPage(tx, s, `${page}_transactions`);
      bbref.push(...p.moves);
      unparsed.push(...p.unparsed);
      skipped.push(...p.skipped);
    }
    if (team && tx != null) covered.push(s);
    const w = cache.wiki(wikiSeasonTitle(s));
    if (w) {
      const p = parseSeasonTrades(w.wikitext, s, w.title ?? wikiSeasonTitle(s));
      wiki.push(...p.moves);
      unparsed.push(...p.unparsed);
    }
  }

  // NBA.com (league-wide, 2015-16 on).
  const nba: ParsedMove[] = [];
  const movement = cache.json<unknown>('nba/movement');
  if (movement == null) degraded.push('nba/movement.json not cached: no NBA.com rows');
  else {
    const p = parseMovement(movement);
    nba.push(...p.moves.filter((m) => inRange(seasonOfDate(m.date))));
    unparsed.push(...p.unparsed.filter((l) => l.date == null || inRange(seasonOfDate(l.date))));
  }

  // People: roster rows matched to Part 1's players (R15: the index needs their NBA.com ids).
  const matched = matchPeople([...rosterBySeason.values()].flat(), db.players);
  const index = buildIndex(matched.people, rosterBySeason);

  // Counterparty season pages (other teams, before 2015-16), already cached ones read as league rows.
  const cp = collectCounterparties([...bbref, ...wiki], (title) => cache.wiki(title)?.wikitext ?? null);
  unparsed.push(...cp.unparsed);

  const reconciled = reconcileMoves({ bbref, wiki: [...wiki, ...cp.moves], nba, index });

  // The draft: BBRef's Clippers selections, every Wikipedia draft page, ESPN's trade notes.
  const draftBbref: DraftRow[] = parseFranchiseDraft(cache.text('bbref/draft') ?? '');
  if (!cache.ok('bbref/draft')) degraded.push('bbref/draft.html not cached');
  const wikiDraft: DraftPickRow[] = [], forfeited: ForfeitedPick[] = [];
  const draftLines = new Set<string>();
  const lotteryText = new Map<number, string>();
  const draftPagesSkipped: string[] = [];
  const espn = new Map<string, string | null>();
  for (let y = opts.from; y <= opts.to + FUTURE_DRAFTS; y++) {
    const title = `${y} NBA draft`;
    const w = cache.wiki(title);
    if (w && w.resolvedTitle && w.resolvedTitle !== title) draftPagesSkipped.push(title);
    else if (w) {
      try {
        const p = parseDraftPage(w.wikitext, y);
        wikiDraft.push(...p.picks);
        forfeited.push(...p.forfeited);
        unparsed.push(...p.unparsed);
        for (const l of p.unparsed) draftLines.add(`${l.source}#${l.index}`);
      } catch (e) {
        // A page the parser can't read at all is still never dropped silently: it gates like an unparsed line.
        const line = { source: title, index: 0, date: null, text: `draft page unreadable: ${(e as Error).message}` };
        unparsed.push(line);
        draftLines.add(`${line.source}#0`);
      }
      if (y >= FIRST_LOTTERY) lotteryText.set(y, w.wikitext);
    }
    if (y >= ESPN_FIRST_DRAFT) {
      const e = cache.json<unknown>(`espn/draft-${y}`);
      if (e) for (const r of parseEspnDraftRounds(e, y)) espn.set(`${y}-${r.overall}`, r.tradeNote);
    }
  }

  // Phase 1 overrides, picks, lottery.
  const p1 = applyMoveOverrides({ moves: reconciled, unparsed, draftRows: wikiDraft }, overrides);
  const pr = buildPicks(p1.moves, { bbref: draftBbref, wiki: wikiDraft, espn, forfeited, originals: p1.originals }, currentDraftYear);
  const wl = collectWikiLottery(lotteryText);
  const lottery = buildLottery({ wiki: wl.rows, picks: pr.picks, teamSeasons: db.teamSeasons, wikiFailedYears: wl.failedYears });
  // A part naming someone by name only gets the person key the roster index resolves uniquely (never a guess).
  const moves = pr.moves.map((m) => ({
    ...m,
    parts: m.parts.map((p) => {
      if (!p.person || p.personKey || p.person.bbrefId || p.person.nbaPersonId != null) return p;
      const key = resolveRef(p.person, index, seasonOfDate(m.date));
      return key ? { ...p, personKey: key } : p;
    }),
  }));

  // Season tables.
  const { salaries, payroll } = buildSalaries(salaryPages, db.playersBySeason ?? new Map());
  const contractsText = cache.text('bbref/contracts');
  const contractRows = contractsText ? parseContracts(contractsText) : [];
  const contracts = buildContracts(contractRows, cache.manifest['bbref/contracts']?.fetchedAt ?? null);
  const coachSeasons = buildCoachSeasons(coachRows, db.playoffs ?? new Map());
  const stintsText = cache.text('bbref/coaches');
  const coachStintMismatches = stintsText ? checkCoachStints(coachSeasons, parseCoachStints(stintsText), new Set(rosterBySeason.keys())) : [];
  const execsText = cache.text('bbref/executives');
  const execs = buildExecTerms(execsText ? parseExecutives(execsText) : []);

  const draftNames = new Map(wikiDraft.map((r) => [`${r.year}-${r.overall}`, r.name]));
  for (const r of draftBbref) draftNames.set(`${r.year}-${r.overall}`, r.name);
  const people = completePeople(matched.people, {
    moves, picks: pr.picks, draftNames, coachSeasons, execTerms: execs.terms,
    salaries: salaryPages.flatMap((p) => p.rows), contracts: contractRows, dbPlayers: db.players,
  });
  const article = cache.wiki('Los Angeles Clippers');
  const team = article ? parseTeamArticle(article.wikitext) : null;
  const honors = team
    ? resolveHonors([...team.retired, ...team.awards, ...team.allStars].filter((h) => h.seasonId == null || inRange(h.seasonId)), {
      rosterBySeason: allRosters, coachSeasons: allCoachRows, execTerms: execs.terms, people,
    })
    : [];
  // An honoree resolved on a season outside the range still needs a person row.
  const known = new Set(people.map((p) => p.personKey));
  const nameOf = new Map<string, string>([
    ...[...allRosters.values()].flat().map((r) => [r.bbrefId, r.name] as [string, string]),
    ...allCoachRows.map((c) => [c.bbrefId, c.name] as [string, string]),
  ]);
  for (const h of honors) {
    if (!h.personKey || known.has(h.personKey)) continue;
    known.add(h.personKey);
    people.push({
      personKey: h.personKey, kind: kindOfBbrefId(h.personKey), displayName: nameOf.get(h.personKey) ?? h.name,
      birthdate: null, nbaPersonId: null, playerId: null,
    });
  }

  const assembled: FranchiseDataset = {
    currentDraftYear, people, moves, picks: pr.picks, swaps: pr.swaps, lottery,
    salaries, payrollSeasons: payroll, contracts: contracts.contracts, coachSeasons, execTerms: execs.terms, honors,
    unparsed: p1.unparsed, ignored: [], dropped: p1.dropped, skipped,
    peopleUnmatched: matched.unmatched, peopleAmbiguous: matched.ambiguous,
    breaks: pr.breaks, disputes: pr.disputes, unkeyed: pr.unkeyed, skippedCategories: team?.skippedCategories ?? [],
  };
  const p2 = applyOverrides(assembled, overrides);
  const data = narrow(p2.data, opts.only, (l) => draftLines.has(`${l.source}#${l.index}`));
  const report = buildReport(data, [...p1.stale, ...p2.stale], p2.invalid);

  if (!db.players.length) degraded.push('players is empty: people stay unmatched and NBA.com/BBRef moves can\'t merge (run Part 1\'s import first)');
  if (!db.teamSeasons.length) degraded.push('team_seasons is empty: lottery slots and payroll partial checks degraded');
  else if (!db.playersBySeason?.size) degraded.push('player_seasons has no Clippers rows: payroll partial check uses the 10-player rule');
  if (!db.playoffs?.size) degraded.push('no Clippers playoff games in Part 1: coach playoff W/L stay null');
  if (!article) degraded.push('wiki/Los_Angeles_Clippers.json not cached: no honors');
  if (!contractsText) degraded.push('bbref/contracts.html not cached: no contracts');

  const checks: ImportChecks = {
    coveredSeasons: covered,
    uncoveredSeasons: uncovered,
    writeScope: writeScope(opts.only, covered, fullRange),
    nbaBbrefMerged: p2.data.moves.filter((m) => { const p = prefixes(m); return p.has('nba:') && p.has('bbref:'); }).length,
    unmergedSignings: unmergedSignings(p2.data.moves),
    draftPagesSkipped,
    lotteryFailedYears: wl.failedYears,
    contractDuplicates: contracts.duplicates,
    coachStintMismatches,
    execPartialDates: execs.partialDates,
    counterparties: { listed: cp.pages.length, read: cp.read, moves: cp.moves.length, clippersTradesLeftOut: cp.clippersTradesLeftOut },
    degraded,
  };
  return { data, report, counterparties: cp.pages, checks };
}
