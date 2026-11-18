// scripts/lib/franchise/counterparties.ts
// Other teams' Wikipedia season pages that trade trees need before 2015-16 (spec §2 second pass, §4.3). Pure.
//
// A player (or a player's draft rights) the Clippers trade away before 2015-16 is followed for up to 3 steps: his
// next trade is on the receiving team's season pages, the one after that on the next team's, and so on. We don't
// know when that next trade happens, so each holder's pages are listed for the season he arrived and the
// HORIZON - 1 seasons after it, never past 2014-15 (NBA.com's league-wide rows take over from 2015-16). Picks need no
// pages: a pick's "from X via Y" draft chain follows it in any era.
//
// Only pages already in the cache can show the next step, so the list grows over runs: the first dry run lists step-1
// pages, the fetch's second pass (`--only=wiki-counterparties`) downloads them, the next dry run reads them and adds
// step-2 pages, and so on until a run adds nothing new.
//
// The trades read from those pages come back as league rows (involvesClippers false). Trades on them that include the
// Clippers are left out: the Clippers' own season page and BBRef already carry those.
import { NBA_TEAM_IDS } from '../nba-teams.js';
import { normalizePersonName } from '../player-match.js';
import { eraTeamName, seasonOfDate } from './describe.js';
import { teamSeasonTitle } from './sources.js';
import type { FranchiseId, ParsedMove, UnparsedLine } from './types.js';
import { parseSeasonTrades } from './wiki-season.js';

const LAC = NBA_TEAM_IDS.LAC;
/** NBA.com's league-wide rows cover trees from this date on. */
export const COUNTERPARTY_ERA_END = '2015-07-01';
const LAST_SEASON = 2014;
export const MAX_STEPS = 3;
/** Seasons of a holder's pages listed: the arrival season and the next two. */
export const HORIZON = 3;

interface Holding {
  name: string;
  team: FranchiseId;
  since: string;
  /** The step whose event these pages would show (1 = the first move after leaving the Clippers). */
  step: number;
}

export interface CounterpartyResult {
  /** Every page title trees need (cached or not), sorted. */
  pages: string[];
  /** League trades read from the cached pages (involvesClippers false). */
  moves: ParsedMove[];
  /** Trades on cached pages that couldn't be read. */
  unparsed: UnparsedLine[];
  /** Cached pages read. */
  read: number;
  /** Trades on cached pages that include the Clippers (left out; the Clippers' sources have them). */
  clippersTradesLeftOut: number;
}

/**
 * `seeds`: the Clippers' parsed trades (BBRef and their own Wikipedia season pages). `wikitextOf(title)` returns a
 * cached page's wikitext, or null when it isn't cached.
 */
export function collectCounterparties(seeds: ParsedMove[], wikitextOf: (title: string) => string | null): CounterpartyResult {
  const pages = new Map<string, { team: FranchiseId; season: number }>();
  const parsed = new Map<string, { moves: ParsedMove[]; unparsed: UnparsedLine[] } | null>();
  let clippersTradesLeftOut = 0;
  const pageOf = (team: FranchiseId, season: number) => teamSeasonTitle(season, eraTeamName(team, season));
  const read = (title: string, team: FranchiseId, season: number) => {
    if (!parsed.has(title)) {
      const text = wikitextOf(title);
      if (text == null) parsed.set(title, null);
      else {
        const r = parseSeasonTrades(text, season, title, team);
        const league = r.moves.filter((m) => !m.involvesClippers);
        clippersTradesLeftOut += r.moves.length - league.length;
        parsed.set(title, { moves: league, unparsed: r.unparsed });
      }
    }
    return parsed.get(title) ?? null;
  };

  const holdings: Holding[] = [];
  const seen = new Set<string>();
  const hold = (h: Holding) => {
    const k = `${h.name}|${h.team}|${h.since}`;
    if (!h.name || h.team === LAC || h.since >= COUNTERPARTY_ERA_END || seen.has(k)) return;
    seen.add(k);
    holdings.push(h);
  };
  for (const m of seeds) {
    if (m.kind !== 'trade') continue;
    for (const p of m.parts) {
      if (p.from !== LAC || p.to == null || !p.person || (p.kind !== 'player' && p.kind !== 'draft_rights')) continue;
      hold({ name: normalizePersonName(p.person.name), team: p.to, since: m.date, step: 1 });
    }
  }

  for (let i = 0; i < holdings.length; i++) {
    const h = holdings[i];
    const first = seasonOfDate(h.since);
    let next: Holding | null = null;
    for (let s = first; s <= Math.min(first + HORIZON - 1, LAST_SEASON); s++) {
      const title = pageOf(h.team, s);
      pages.set(title, { team: h.team, season: s });
      if (next || h.step >= MAX_STEPS) continue;
      const page = read(title, h.team, s);
      const event = page?.moves
        .filter((m) => m.kind === 'trade' && m.date > h.since)
        .sort((a, b) => a.date.localeCompare(b.date))
        .find((m) => m.parts.some((p) => p.from === h.team && p.to != null && p.person && normalizePersonName(p.person.name) === h.name));
      if (event) {
        const part = event.parts.find((p) => p.from === h.team && p.person && normalizePersonName(p.person.name) === h.name)!;
        next = { name: h.name, team: part.to as FranchiseId, since: event.date, step: h.step + 1 };
      }
    }
    if (next) hold(next);
  }

  // Every cached page listed is read, including step-3 pages (their trades are the tree's last step).
  const moves: ParsedMove[] = [];
  const unparsed: UnparsedLine[] = [];
  let readCount = 0;
  const titles = [...pages.keys()].sort();
  for (const title of titles) {
    const { team, season } = pages.get(title)!;
    const page = read(title, team, season);
    if (!page) continue;
    readCount++;
    moves.push(...page.moves);
    unparsed.push(...page.unparsed);
  }
  return { pages: titles, moves, unparsed, read: readCount, clippersTradesLeftOut };
}
