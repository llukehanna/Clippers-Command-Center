// scripts/lib/franchise/lottery.ts
// Draft-lottery rows for the Clippers' lottery picks (spec §1 draft_lottery_results, §3.2). Pure: no DB, no I/O.
//
// A row exists for each lottery pick (1985 on) the Clippers owned at the draft or that originated with them.
// Wikipedia's "Draft lottery" section wins when it is present and well-formed (its rows are a permutation of
// pickWon 1..N); otherwise slot and odds are derived from the previous season's team_seasons rows. With no
// team_seasons rows only pickWon is written: preSlot and oddsFirst stay null (unknown is null, never 0).
import { NBA_TEAM_IDS } from '../nba-teams.js';
import type { FranchiseId } from './types.js';
import type { PickRow } from './picks.js';
import { parseLotterySection, type LotteryRow } from './wiki-draft.js';

const LAC = NBA_TEAM_IDS.LAC;
/** The first draft with a lottery. */
const FIRST_LOTTERY_YEAR = 1985;

export interface LotteryFormat {
  firstYear: number;
  lastYear: number | null;
  /** Teams in the lottery pool (non-playoff teams; 2019-26 includes the play-in losers). */
  teams: number;
  /** Chance of the #1 pick for each pre-lottery slot (0-1), worst record first. null: not confirmable from the source. */
  oddsFirst: Array<number | null>;
}

const equal = (n: number): number[] => Array.from({ length: n }, () => 1 / n);
const sixtySixths = (n: number): number[] => Array.from({ length: n }, (_, i) => (n - i) / 66);

// Odds sources: Wikipedia "NBA draft lottery" (cached data/franchise-raw/wiki/NBA_draft_lottery.json) and the
// cached Wikipedia draft pages' "Draft lottery" sections. Team counts: the article never states them; each is the
// league's non-playoff count (16 playoff teams) for that draft: 23 teams (1985-88 drafts) -> 7, 25 (1989) -> 9,
// 27 (1990-95) -> 11, 29 (1996-2004) -> 13, 30 (2005 on) -> 14. Only 1985-88 (7) and 1989 (9) are article-confirmed
// (the lottery-winners table notes); the rest are league-size derived. The team_count_mismatch flag
// guards derived rows against a wrong count.
export const LOTTERY_FORMATS: LotteryFormat[] = [
  // "1985-1989: Early lottery system": each non-playoff team had an equal chance at the first pick.
  { firstYear: 1985, lastYear: 1988, teams: 7, oddsFirst: equal(7) },
  { firstYear: 1989, lastYear: 1989, teams: 9, oddsFirst: equal(9) },
  // "1990-2026: Weighted lottery system": 11 chances out of 66 for the worst team, one fewer each slot. The
  // 1993 table in that section (untied records) shows 11..1 of 66.
  { firstYear: 1990, lastYear: 1993, teams: 11, oddsFirst: sixtySixths(11) },
  // Same section, October 1993 change: the worst team 25 percent, the best non-playoff team 0.5 percent. The
  // 1994 table there has tied records in slots 2-4 (averaged), so those stay null; slots 5-11 are untied.
  { firstYear: 1994, lastYear: 1995, teams: 11, oddsFirst: [0.25, null, null, null, 0.094, 0.066, 0.044, 0.027, 0.015, 0.008, 0.005] },
  // 1996-98: Toronto and Vancouver were ineligible for the #1 pick (lottery-winners table note; odds there are out of
  // 593), so slot odds depend on which teams held which slots: all null rather than a guessed fixed table.
  { firstYear: 1996, lastYear: 1998, teams: 13, oddsFirst: Array<null>(13).fill(null) },
  // 1999-2004, 13 teams: only the first and last slots are stated by the article's text (25 percent, 0.5 percent).
  { firstYear: 1999, lastYear: 2004, teams: 13, oddsFirst: [0.25, ...Array<null>(11).fill(null), 0.005] },
  // 14 teams. Not in the lottery article: confirmed against the untied "Draft lottery" table on the cached
  // "2015 NBA draft" page (250,199,156,119,88,63,43,28,17,11,8,7,6,5 of 1,000).
  { firstYear: 2005, lastYear: 2018, teams: 14, oddsFirst: [250, 199, 156, 119, 88, 63, 43, 28, 17, 11, 8, 7, 6, 5].map((c) => c / 1000) },
  // "Chances of winning": "From 2019 to 2026" list, 140/140/140/125/105/90/75/60/45/30/20/15/10/5 of 1,000.
  { firstYear: 2019, lastYear: 2026, teams: 14, oddsFirst: [140, 140, 140, 125, 105, 90, 75, 60, 45, 30, 20, 15, 10, 5].map((c) => c / 1000) },
  // "Starting in 2027: 3-2-1 format": 16 teams, ball counts only described in prose; no odds figures are given.
  { firstYear: 2027, lastYear: null, teams: 16, oddsFirst: Array<null>(16).fill(null) },
];

export interface LotteryOut {
  year: number;
  pickKey: string;
  preSlot: number | null;
  oddsFirst: number | null;
  pickWon: number;
  source: 'wiki' | 'derived';
  /** Records were tied, so the lottery slot (the lower-numbered tied slot) is not a certain order. */
  tieUnresolved: boolean;
  /** Quality flags for the run report: wiki_not_permutation, wiki_unreadable, wiki_franchise_mismatch, team_seasons_incomplete, team_count_mismatch, original_not_in_lottery. */
  flags: string[];
}

/** Mirrors Part 1's team_seasons table (playoff_round 0 = missed the playoffs). */
export interface TeamSeasonRow {
  season_id: number;
  nba_franchise_id: number;
  wins: number | null;
  losses: number | null;
  playoff_round: number | null;
}

export interface LotteryInput {
  wiki: LotteryRow[];
  picks: PickRow[];
  teamSeasons: TeamSeasonRow[];
  /** Years whose Wikipedia lottery section was unreadable (see collectWikiLottery). */
  wikiFailedYears?: number[];
}

const formatFor = (year: number): LotteryFormat | undefined =>
  LOTTERY_FORMATS.find((f) => f.firstYear <= year && (f.lastYear == null || year <= f.lastYear));

/** Parses each year's Wikipedia lottery section; a year that throws is reported, never aborts the rest. */
export function collectWikiLottery(wikitextByYear: Map<number, string>): { rows: LotteryRow[]; failedYears: number[] } {
  const rows: LotteryRow[] = [];
  const failedYears: number[] = [];
  for (const [year, text] of [...wikitextByYear].sort((a, b) => a[0] - b[0])) {
    try {
      rows.push(...parseLotterySection(text, year));
    } catch {
      failedYears.push(year);
    }
  }
  return { rows, failedYears };
}

function wikiYearOk(rows: LotteryRow[], year: number): boolean {
  const n = rows.length;
  if (n !== formatFor(year)?.teams) return false;
  const won = new Set(rows.map((r) => r.pickWon));
  return won.size === n && rows.every((r) => Number.isInteger(r.pickWon) && r.pickWon >= 1 && r.pickWon <= n);
}

interface Derived {
  /** Slot (and tie flag) by franchise, or null when the year can't be derived (with the reason). */
  slots: Map<FranchiseId, { slot: number; tied: number[] }> | null;
  flag: string | null;
}

/** Non-playoff teams of the season before the draft, worst record first. Ties share the lower slot. */
function deriveSlots(year: number, teams: number, teamSeasons: TeamSeasonRow[]): Derived {
  const season = teamSeasons.filter((t) => t.season_id === year - 1);
  if (season.length === 0) return { slots: null, flag: null };
  if (season.some((t) => t.playoff_round == null || t.wins == null || t.losses == null)) return { slots: null, flag: 'team_seasons_incomplete' };
  const pool = season.filter((t) => t.playoff_round === 0 && (t.wins as number) + (t.losses as number) > 0);
  if (pool.length !== teams) return { slots: null, flag: 'team_count_mismatch' };
  const pct = (t: TeamSeasonRow) => (t.wins as number) / ((t.wins as number) + (t.losses as number));
  pool.sort((a, b) => pct(a) - pct(b));
  const slots = new Map<FranchiseId, { slot: number; tied: number[] }>();
  for (let i = 0; i < pool.length; ) {
    let j = i;
    while (j + 1 < pool.length && Math.abs(pct(pool[j + 1]) - pct(pool[i])) < 1e-9) j++;
    const tied = Array.from({ length: j - i + 1 }, (_, k) => i + k + 1);
    for (let k = i; k <= j; k++) slots.set(pool[k].nba_franchise_id, { slot: i + 1, tied });
    i = j + 1;
  }
  return { slots, flag: null };
}

export function buildLottery(input: LotteryInput): LotteryOut[] {
  const wikiByYear = new Map<number, LotteryRow[]>();
  for (const r of input.wiki) {
    const list = wikiByYear.get(r.year) ?? [];
    list.push(r);
    wikiByYear.set(r.year, list);
  }
  const failed = new Set(input.wikiFailedYears ?? []);
  const derivedCache = new Map<number, Derived>();
  const out: LotteryOut[] = [];

  const picks = input.picks
    .filter((p) => p.round === 1 && p.year >= FIRST_LOTTERY_YEAR && p.overall != null && (p.originalFranchiseId === LAC || p.finalOwnerFranchiseId === LAC))
    .sort((a, b) => a.year - b.year || (a.overall as number) - (b.overall as number));

  for (const p of picks) {
    const overall = p.overall as number;
    const wikiRows = wikiByYear.get(p.year);
    const flags: string[] = [];
    let useWiki = false;
    if (wikiRows) {
      if (wikiYearOk(wikiRows, p.year)) useWiki = true;
      else flags.push('wiki_not_permutation');
    }
    if (!wikiRows && failed.has(p.year)) flags.push('wiki_unreadable');

    if (useWiki) {
      const rows = wikiRows as LotteryRow[];
      if (overall > rows.length) continue; // not a lottery pick
      const row = rows.find((r) => r.pickWon === overall) as LotteryRow;
      if (row.franchise !== p.originalFranchiseId && row.franchise !== p.finalOwnerFranchiseId) flags.push('wiki_franchise_mismatch');
      out.push({ year: p.year, pickKey: p.pickKey, preSlot: row.preSlot, oddsFirst: row.oddsFirst, pickWon: overall, source: 'wiki', tieUnresolved: false, flags });
      continue;
    }

    const fmt = formatFor(p.year);
    if (!fmt || overall > fmt.teams) continue;
    let d = derivedCache.get(p.year);
    if (!d) {
      d = deriveSlots(p.year, fmt.teams, input.teamSeasons);
      derivedCache.set(p.year, d);
    }
    let preSlot: number | null = null;
    let oddsFirst: number | null = null;
    let tieUnresolved = false;
    if (d.flag) flags.push(d.flag);
    if (d.slots) {
      const s = d.slots.get(p.originalFranchiseId);
      if (!s) flags.push('original_not_in_lottery');
      else {
        // A tie gets the lower-numbered tied slot and is never presented as resolved. Odds for a tie are known
        // only when every tied slot has the same figure (the equal-odds years); the weighted years average the
        // tied slots' odds, which the article states only for 2019 on, so those stay null.
        preSlot = s.slot;
        tieUnresolved = s.tied.length > 1;
        const odds = s.tied.map((t) => fmt.oddsFirst[t - 1] ?? null);
        oddsFirst = odds.every((o) => o != null && Math.abs(o - (odds[0] as number)) < 1e-12) ? odds[0] : null;
      }
    }
    out.push({ year: p.year, pickKey: p.pickKey, preSlot, oddsFirst, pickWon: overall, source: 'derived', tieUnresolved, flags });
  }
  return out;
}
