import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { NBA_TEAM_IDS } from '../nba-teams.js';
import { FetchStopped, PACE_MS } from './fetcher.js';
import type { DbPlayer, PersonRow } from './people.js';
import {
  buildWeekly, fetchWeekly, FeedShapeError, SALARY_SOURCE, storedToMove, WEEKLY_PREFIX, type StoredTrade, type WeeklyPages,
} from './sync-contracts.js';
import type { Override } from './types.js';

const { LAC, CLE } = NBA_TEAM_IDS;
const CACHE = path.join(process.cwd(), 'scripts/lib/__fixtures__/franchise/cache');
const CONTRACTS = fs.readFileSync(path.join(CACHE, 'bbref/contracts.html'), 'utf8');
const WIKI = JSON.parse(fs.readFileSync(path.join(CACHE, 'wiki/2026–27_Los_Angeles_Clippers_season.json'), 'utf8')) as { title: string; wikitext: string };

const txPage = (...lines: string[]) =>
  `<ul class='page_index'><li><span><span>November 18, 2026</span></span>${lines.map((l) => `<p><p class="transaction ">${l}</p></p>`).join('')}</li></ul>`;
const CLE_LINK = '<a data-attr-from="CLE" href="/teams/CLE/2027.html">Cleveland Cavaliers</a>';
/** BBRef's reading of the trade NBA.com called "draft consideration": a 2031 2nd, LAC's own. */
const STRUS_TRADE = `Traded a 2031 2nd round draft pick to the ${CLE_LINK} for <a href="/players/s/strusma01.html">Max Strus</a>. 2031 2nd-rd pick is LAC own`;
/** No note naming the pick's original team: it can't be identified. */
const VAGUE_TRADE = `Traded a 2032 2nd round draft pick to the ${CLE_LINK} for <a href="/players/w/weslebl01.html">Blake Wesley</a>.`;

const pages = (over: Partial<WeeklyPages> = {}): WeeklyPages => ({
  contractsHtml: CONTRACTS, contractsFetchedAt: '2026-11-23T15:00:00.000Z',
  transactionsHtml: txPage(STRUS_TRADE), transactionsPage: 'LAC-2027_transactions',
  wiki: { title: WIKI.title, wikitext: WIKI.wikitext }, ...over,
});

/** The nightly job's row: Strus in, and NBA.com's "draft consideration" out. */
const nightlyTrade = (key = 'nba:Trade 2026020', player = { key: 'strusma01', name: 'Max Strus', nba: 1629622 }): StoredTrade => ({
  transactionKey: key, date: '2026-11-18', involvesClippers: true, sources: [key],
  parts: [
    { from: CLE, to: LAC, kind: 'player', personKey: player.key, personName: player.name, nbaPersonId: player.nba, pick: null, swap: null, text: null, gap: null },
    { from: LAC, to: CLE, kind: 'pick', personKey: null, personName: null, nbaPersonId: null, pick: null, swap: null, text: 'draft consideration', gap: 'pick_unidentified' },
  ],
});

const people: PersonRow[] = [
  { personKey: 'strusma01', kind: 'player', displayName: 'Max Strus', birthdate: null, nbaPersonId: 1629622, playerId: '11' },
  { personKey: 'nba:1631104', kind: 'player', displayName: 'Blake Wesley', birthdate: null, nbaPersonId: 1631104, playerId: '10' },
];
const players: DbPlayer[] = [
  { player_id: '10', nba_person_id: 1631104, display_name: 'Blake Wesley', birthdate: null },
  { player_id: '11', nba_person_id: 1629622, display_name: 'Max Strus', birthdate: null },
];

const weekly = (over: Partial<Parameters<typeof buildWeekly>[0]> = {}) =>
  buildWeekly({ season: 2026, pages: pages(), incomplete: [nightlyTrade()], people, players, overrides: [], currentDraftYear: 2027, ...over });

// ---- fetch ---------------------------------------------------------------------------------------------------------

const wikiJson = (title: string, wikitext: string) => JSON.stringify({ query: { pages: [{ title, revisions: [{ slots: { main: { content: wikitext } } }] }] } });

function fakeFetch(status: Record<string, number> = {}) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    const code = Object.entries(status).find(([k]) => u.includes(k))?.[1] ?? 200;
    if (code !== 200) return new Response('', { status: code });
    if (u.includes('wikipedia.org')) return new Response(wikiJson(WIKI.title, WIKI.wikitext));
    if (u.includes('/contracts/LAC.html')) return new Response(CONTRACTS);
    return new Response(txPage(STRUS_TRADE));
  });
}

describe('fetchWeekly', () => {
  it('fetches exactly two bbref pages', async () => {
    const fetch = fakeFetch();
    const sleep = vi.fn(async (_ms: number) => {});
    const T = Date.parse('2026-11-23T15:00:00Z');
    const got = await fetchWeekly(2026, { fetch: fetch as unknown as typeof globalThis.fetch, sleep, now: () => T });
    const urls = fetch.mock.calls.map(([u]) => String(u));
    expect(urls.filter((u) => u.includes('basketball-reference.com')).sort()).toEqual([
      'https://www.basketball-reference.com/contracts/LAC.html',
      'https://www.basketball-reference.com/teams/LAC/2027_transactions.html',
    ]);
    // ...plus the current Wikipedia season page, nothing else.
    expect(urls.filter((u) => !u.includes('basketball-reference.com'))).toEqual([expect.stringContaining('2026%E2%80%9327%20Los%20Angeles%20Clippers%20season')]);
    expect(urls).toHaveLength(3);
    // BBRef paced 6,000 ms apart.
    expect(PACE_MS.bbref).toBe(6000);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([PACE_MS.bbref]);
    expect(got).toMatchObject({ transactionsPage: 'LAC-2027_transactions', wiki: { title: WIKI.title } });
    expect(got.contractsHtml).toBe(CONTRACTS);
    expect(got.contractsFetchedAt).toBe('2026-11-23T15:00:00.000Z');
  });

  it('fails on any non-200, naming the page and status', async () => {
    const deps = (fetch: ReturnType<typeof fakeFetch>) => ({ fetch: fetch as unknown as typeof globalThis.fetch, sleep: async () => {}, now: () => 0 });
    const err = await fetchWeekly(2026, deps(fakeFetch({ '/contracts/LAC.html': 403 }))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchStopped);
    expect(err).toMatchObject({ key: 'bbref/contracts', status: 403 });
    await expect(fetchWeekly(2026, deps(fakeFetch({ 'wikipedia.org': 503 })))).rejects.toMatchObject({ key: expect.stringMatching(/^wiki\//), status: 503 });
  });
});

// ---- build ---------------------------------------------------------------------------------------------------------

describe('buildWeekly', () => {
  it('fills a draft consideration from the current transactions page', () => {
    const { data, unparsed } = weekly();
    expect(unparsed).toEqual([]);
    // Only the stored incomplete trade is written (Wikipedia's June draft-rights deals match nothing stored).
    expect(data.moves).toHaveLength(1);
    const [m] = data.moves;
    expect(m.transactionKey).toBe('nba:Trade 2026020');
    expect(m.complete).toBe(true);
    expect(m.parts).toEqual([
      expect.objectContaining({ from: CLE, to: LAC, kind: 'player', personKey: 'strusma01' }),
      expect.objectContaining({ from: LAC, to: CLE, kind: 'pick', pickKey: '2031-2-LAC' }),
    ]);
    expect(m.parts[1].gap).toBeUndefined();
    // Everything the job adds carries the weekly: prefix (R16); the stored row's own sources stay as they are.
    expect(m.sources).toEqual(['nba:Trade 2026020', `${WEEKLY_PREFIX}bbref:2026-11-18:trade:pick2031r2|strusma01`]);
    // Only the picks the written trades point at.
    expect(data.picks.map((p) => p.pickKey)).toEqual(['2031-2-LAC']);
  });

  it('never guesses a pick: one with no stated original stays unidentified', () => {
    const wesley = nightlyTrade('nba:Trade 2026021', { key: 'nba:1631104', name: 'Blake Wesley', nba: 1631104 });
    const { data } = weekly({ pages: pages({ transactionsHtml: txPage(VAGUE_TRADE) }), incomplete: [wesley] });
    const [m] = data.moves;
    expect(m.complete).toBe(false);
    expect(m.parts.find((p) => p.kind === 'pick')).toMatchObject({ gap: 'pick_unidentified' });
    expect(m.parts.find((p) => p.kind === 'pick')!.pickKey).toBeUndefined();
    expect(data.picks).toEqual([]);
    // BBRef's id for Wesley is new: his row carries the NBA.com id, so the writer merges nba:1631104 into it.
    expect(data.people).toContainEqual(expect.objectContaining({ personKey: 'weslebl01', nbaPersonId: 1631104, playerId: '10' }));
  });

  it('writes nothing for a stored trade no fresh page lists', () => {
    const { data } = weekly({ pages: pages({ transactionsHtml: txPage(VAGUE_TRADE) }) });
    expect(data.moves).toEqual([]);
  });

  it('replaces the contracts snapshot and takes the current season salaries from the contracts page', () => {
    const { data } = weekly();
    expect(data.contracts.length).toBeGreaterThan(0);
    expect(new Set(data.contracts.map((c) => c.fetchedAt))).toEqual(new Set(['2026-11-23T15:00:00.000Z']));
    expect(data.contracts).toContainEqual(expect.objectContaining({ personKey: 'garlada01', seasonId: 2026, amountUsd: 42166510 }));
    expect(data.salaries.length).toBeGreaterThan(0);
    expect(data.salaries.every((s) => s.seasonId === 2026 && s.source === SALARY_SOURCE)).toBe(true);
    expect(SALARY_SOURCE.startsWith(WEEKLY_PREFIX)).toBe(true);
    expect(data.salaries).toContainEqual({ seasonId: 2026, personKey: 'garlada01', amountUsd: 42166510, source: SALARY_SOURCE });
    // A contract player person_xref lacks gets a person row.
    expect(data.people.map((p) => p.personKey)).toContain('garlada01');
    expect(data.payrollSeasons).toEqual([]);
  });

  it('keeps the old contracts snapshot when parsing fails', () => {
    // A changed page (no contracts table) is a failure, never an empty snapshot.
    expect(() => weekly({ pages: pages({ contractsHtml: '<html><body>Payroll moved</body></html>' }) })).toThrow(FeedShapeError);
    expect(() => weekly({ pages: pages({ contractsHtml: '<html><body>Payroll moved</body></html>' }) })).toThrow(/contracts/);
    // A contracts page with no column for this season gives no salaries: also a failure.
    expect(() => weekly({ season: 2027 })).toThrow(/2027-28/);
    // And a transactions page with no list of moves.
    expect(() => weekly({ pages: pages({ transactionsHtml: '<html><body>Not found</body></html>' }) })).toThrow(/transactions page/);
  });

  it('gates on unparsed lines, and an ignore override settles one', () => {
    const odd = 'The Los Angeles Clippers did something new.';
    const { unparsed } = weekly({ pages: pages({ transactionsHtml: txPage(STRUS_TRADE, odd) }) });
    expect(unparsed.map((l) => l.text)).toEqual([odd]);
    const ignore: Override = { kind: 'ignore', match: { source: 'LAC-2027_transactions', text: odd }, reason: 'test', source: 'test' };
    expect(weekly({ pages: pages({ transactionsHtml: txPage(STRUS_TRADE, odd) }), overrides: [ignore] }).unparsed).toEqual([]);
  });
});

describe('storedToMove', () => {
  it('reads a stored row back as a move: ids for linked people and picks, the gap for the rest', () => {
    const t: StoredTrade = {
      ...nightlyTrade(),
      parts: [
        ...nightlyTrade().parts,
        { from: LAC, to: CLE, kind: 'pick', personKey: null, personName: null, nbaPersonId: null, pick: { year: 2030, round: 1, originalFranchiseId: LAC, protectionsText: 'top-4 protected' }, swap: null, text: null, gap: null },
        { from: CLE, to: LAC, kind: 'player', personKey: 'nba:5', personName: 'Some One', nbaPersonId: 5, pick: null, swap: null, text: null, gap: null },
      ],
    };
    const m = storedToMove(t);
    expect(m).toMatchObject({ sourceKey: 'nba:Trade 2026020', date: '2026-11-18', kind: 'trade', involvesClippers: true, complete: false });
    expect(m.parts).toEqual([
      { from: CLE, to: LAC, kind: 'player', person: { name: 'Max Strus', bbrefId: 'strusma01', nbaPersonId: 1629622 }, personKey: 'strusma01' },
      { from: LAC, to: CLE, kind: 'pick', text: 'draft consideration', gap: 'pick_unidentified' },
      { from: LAC, to: CLE, kind: 'pick', pick: { year: 2030, round: 1, originalFranchiseId: LAC, protectionsText: 'top-4 protected' } },
      { from: CLE, to: LAC, kind: 'player', person: { name: 'Some One', nbaPersonId: 5 }, personKey: 'nba:5' },
    ]);
  });
});
