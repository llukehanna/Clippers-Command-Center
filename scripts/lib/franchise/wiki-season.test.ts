import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NBA_TEAM_IDS } from '../nba-teams.js';
import { parseSeasonTrades } from './wiki-season.js';

const fx = (n: string) =>
  readFileSync(new URL(`../__fixtures__/franchise/wiki/${n}`, import.meta.url), 'utf8');

const { LAC, HOU, PHI, DEN, ATL, BOS, PHX } = NBA_TEAM_IDS;
const PAGE_2017 = '2017–18 Los Angeles Clippers season';

describe('parseSeasonTrades', () => {
  it('reads the 2017 Chris Paul trade as seven players, a 2018 first and cash to LAC', () => {
    const { moves, unparsed } = parseSeasonTrades(fx('trades-2017-18.txt'), 2017, PAGE_2017);
    expect(unparsed).toEqual([]);
    const t = moves.find((m) => m.date === '2017-06-28')!;
    expect(t.sourceKey).toBe(`wiki:${PAGE_2017}#2`);
    expect(t.kind).toBe('trade');
    expect(t.involvesClippers).toBe(true);
    expect(t.complete).toBe(true);
    const toLac = t.parts.filter((p) => p.to === LAC);
    expect(toLac.every((p) => p.from === HOU)).toBe(true);
    expect(toLac.filter((p) => p.kind === 'player').map((p) => p.person)).toEqual([
      { name: 'Patrick Beverley' }, { name: 'Lou Williams' }, { name: 'Sam Dekker' }, { name: 'Montrezl Harrell' },
      { name: 'Darrun Hilliard' }, { name: 'DeAndre Liggins' }, { name: 'Kyle Wiltjer' },
    ]);
    expect(toLac.filter((p) => p.kind === 'pick').map((p) => p.pick)).toEqual([{ year: 2018, round: 1 }]);
    expect(toLac.filter((p) => p.kind === 'cash')).toEqual([{ from: HOU, to: LAC, kind: 'cash', text: 'cash' }]);
    expect(t.parts.filter((p) => p.to === HOU)).toEqual([
      { from: LAC, to: HOU, kind: 'player', person: { name: 'Chris Paul' } },
    ]);
  });

  it('reads a rowspan three-team trade with (from Denver) on Gallinari', () => {
    const { moves } = parseSeasonTrades(fx('trades-2017-18.txt'), 2017, PAGE_2017);
    expect(moves.map((m) => m.sourceKey)).toEqual([1, 2, 3, 4].map((n) => `wiki:${PAGE_2017}#${n}`));
    // The rowspan date covers two trades: Jawun Evans (two-team) and the Gallinari three-team deal.
    const [evans, gallinari] = moves.filter((m) => m.date === '2017-07-06');
    expect(evans.parts).toEqual([
      { from: PHI, to: LAC, kind: 'draft_rights', person: { name: 'Jawun Evans' } },
      { from: LAC, to: PHI, kind: 'cash', text: 'cash' },
    ]);
    expect(gallinari.parts).toEqual([
      { from: DEN, to: LAC, kind: 'player', person: { name: 'Danilo Gallinari' } },
      { from: ATL, to: DEN, kind: 'pick', pick: { year: 2019, round: 2 } },
      { from: LAC, to: ATL, kind: 'player', person: { name: 'Jamal Crawford' } },
      { from: LAC, to: ATL, kind: 'player', person: { name: 'Diamond Stone' } },
      { from: LAC, to: ATL, kind: 'pick', pick: { year: 2018, round: 1 } },
    ]);
  });

  it('reads the 1985 Walton trade bullet list', () => {
    const { moves, unparsed } = parseSeasonTrades(fx('trades-1985-86.txt'), 1985, '1985–86 Los Angeles Clippers season');
    expect(unparsed).toEqual([]);
    expect(moves).toHaveLength(3);
    const t = moves[0];
    expect(t.date).toBe('1985-09-06');
    expect(t.parts).toEqual([
      { from: BOS, to: LAC, kind: 'player', person: { name: 'Cedric Maxwell' } },
      { from: BOS, to: LAC, kind: 'pick', pick: { year: 1986, round: 1 } },
      { from: LAC, to: BOS, kind: 'player', person: { name: 'Bill Walton' } },
    ]);
  });

  it('returns a trade row it cannot read as unparsed, never dropping it', () => {
    const page = '1976–77 Buffalo Braves season';
    const { moves, unparsed } = parseSeasonTrades(fx('trades-1976-77-aba.txt'), 1976, page);
    expect(unparsed).toHaveLength(1);
    expect(unparsed[0]).toMatchObject({ source: page, index: 1, date: '1976-08-05' });
    expect(unparsed[0].text).toContain('ABA dispersal draft');
    expect(unparsed[0].text).toContain('Milwaukee Bucks');
    // The row after it still parses, keeping its place in the numbering.
    expect(moves).toHaveLength(1);
    expect(moves[0].sourceKey).toBe(`wiki:${page}#2`);
    expect(moves[0].parts).toEqual([
      { from: PHX, to: LAC, kind: 'pick', pick: { year: 1977, round: 2 } },
      { from: LAC, to: PHX, kind: 'player', person: { name: 'Tom Van Arsdale' } },
    ]);
  });

  it('marks multi-team entries with no "(from X)" as party_unknown, leaving the move incomplete', () => {
    const page = '2025–26 Los Angeles Clippers season';
    const { moves, unparsed } = parseSeasonTrades(fx('trades-2025-26-three-team.txt'), 2025, page);
    expect(unparsed).toEqual([]);
    expect(moves).toHaveLength(1);
    const t = moves[0];
    expect(t.sourceKey).toBe(`wiki:${page}#1`);
    expect(t.date).toBe('2025-07-07');
    expect(t.parts).toEqual([
      { from: null, to: LAC, kind: 'player', person: { name: 'John Collins' }, gap: 'party_unknown' },
      { from: null, to: NBA_TEAM_IDS.MIA, kind: 'player', person: { name: 'Norman Powell' }, gap: 'party_unknown' },
      { from: null, to: NBA_TEAM_IDS.UTA, kind: 'player', person: { name: 'Kyle Anderson' }, gap: 'party_unknown' },
      { from: null, to: NBA_TEAM_IDS.UTA, kind: 'player', person: { name: 'Kevin Love' }, gap: 'party_unknown' },
      // The one entry that names its sender has no gap.
      { from: LAC, to: NBA_TEAM_IDS.UTA, kind: 'pick', pick: { year: 2027, round: 2 } },
    ]);
    expect(t.complete).toBe(false);
  });

  it('keeps signing compensation free of party_unknown: a free agent has no sending team', () => {
    const { moves } = parseSeasonTrades([
      '===Trades===',
      '{|',
      '|- bgcolor="eeeeee"',
      '| style="width:12%" | October 6, [[1977–78 NBA season|1977]]',
      "| style=\"width:30%\" valign=\"top\"| To '''[[Buffalo Braves]]'''<hr>",
      '* The right to sign [[Ted McClain]] as a veteran free agent',
      "| style=\"width:30%\" valign=\"top\"| To '''[[Denver Nuggets]]'''<hr>",
      '* A 1978 3rd round draft pick as compensation',
      '|}',
    ].join('\n'), 1977, 'p'); // shape from "1977–78 Buffalo Braves season"
    expect(moves[0].kind).toBe('signing');
    expect(moves[0].parts[0]).toEqual({ from: null, to: LAC, kind: 'player', person: { name: 'Ted McClain' } });
    expect(moves[0].complete).toBe(true);
  });

  it('returns empty arrays when the page has no Trades section or no trades', () => {
    expect(parseSeasonTrades('==Roster==\nx', 2000, 'p')).toEqual({ moves: [], unparsed: [] });
    expect(parseSeasonTrades('===Trades===\nNo trades occurred for this team.\n', 2006, 'p')).toEqual({ moves: [], unparsed: [] });
  });

  it('reads a date cell whose citation runs onto the next line, and a two-year swap right', () => {
    // Shapes from "2024–25 Los Angeles Clippers season" (Kris Dunn, cite split over two lines) and
    // "2019–20 Los Angeles Clippers season" (Paul George), trimmed to a few entries.
    const wt = [
      '===Trades===',
      '{| border=1',
      '|- style="background:#eee;"',
      '| style="width:10%" | July 18, 2024<ref>{{cite web|title=LA Clippers Acquire Kris Dunn',
      '|url=https://www.nba.com/clippers/news/la-clippers-acquire-kris-dunn|website=NBA.com}}</ref>',
      "| style=\"width:31%; vertical-align:top;\"| To '''[[Los Angeles Clippers]]'''<hr>[[Kris Dunn]] ([[Sign-and-trade deal|sign-and-trade]])",
      "| style=\"width:31%; vertical-align:top;\"| To '''[[Utah Jazz]]'''<hr>[[Russell Westbrook]]<br>2030 second-round pick swap right",
      '|- bgcolor="eeeeee"',
      '| style="width:12%" | July 10, [[2019–20 NBA season|2019]] ',
      "| style=\"width:30%\" valign=\"top\"| To '''[[Los Angeles Clippers]]'''<hr>[[Paul George]]",
      "| style=\"width:30%\" valign=\"top\"| To '''[[Oklahoma City Thunder]]'''<hr>2021 first-round pick (from Miami)<br>A future protected first-round draft pick<br>Right to swap first-round picks in 2023 and 2025",
      '|}',
    ].join('\n');
    const { moves, unparsed } = parseSeasonTrades(wt, 2024, 'p');
    expect(unparsed).toEqual([]);
    expect(moves.map((m) => m.date)).toEqual(['2024-07-18', '2019-07-10']);
    expect(moves[0].parts).toContainEqual({
      from: LAC, to: NBA_TEAM_IDS.UTA, kind: 'swap', swap: { year: 2030, round: 2, franchiseA: LAC, franchiseB: NBA_TEAM_IDS.UTA },
    });
    const okc = moves[1].parts.filter((p) => p.to === NBA_TEAM_IDS.OKC);
    expect(okc.map((p) => p.pick ?? p.swap)).toEqual([
      { year: 2021, round: 1, originalFranchiseId: NBA_TEAM_IDS.MIA },
      { year: 0, round: 1, vague: true, protectionsText: 'protected' },
      { year: 2023, round: 1, franchiseA: LAC, franchiseB: NBA_TEAM_IDS.OKC },
      { year: 2025, round: 1, franchiseA: LAC, franchiseB: NBA_TEAM_IDS.OKC },
    ]);
    expect(okc[1].gap).toBe('pick_unidentified');
    expect(moves[1].complete).toBe(false);
  });
});
