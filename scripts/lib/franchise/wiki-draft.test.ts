import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NBA_TEAM_IDS } from '../nba-teams.js';
import { parseDraftPage, parseLotterySection } from './wiki-draft.js';

const fx = (n: string) =>
  readFileSync(new URL(`../__fixtures__/franchise/wiki/${n}`, import.meta.url), 'utf8');

const { LAC, CLE, PHX, CHA, UTA, POR, ATL, DEN, NYK, NOP, MEM, LAL, SAC, HOU, CHI, WAS, SAS, TOR, BOS, MIN, IND, DET, MIL, DAL } = NBA_TEAM_IDS;
const d2005 = fx('draft-2005.txt');
const d1995 = fx('draft-1995.txt');
const d2019 = fx('draft-2019-lottery.txt');

const HEADER = [
  '==Draft selections==',
  '{| class="wikitable sortable"',
  '! Round',
  '! Pick',
  '! Player',
  '! Position',
  '! Nationality',
  '! Team',
  '! School/club team',
];

describe('parseDraftPage', () => {
  it('reads "from Cleveland via Phoenix" as the chain [CLE, PHX], original owner first', () => {
    const { picks } = parseDraftPage(d2005, 2005);
    expect(picks.find((p) => p.overall === 13)).toMatchObject({ name: 'Sean May', chain: [CLE, PHX] });
    expect(picks.find((p) => p.overall === 13)).toMatchObject({ year: 2005, round: 1, teamFranchise: CHA });
  });

  it('reads a pick with no "from" as an empty chain', () => {
    const { picks } = parseDraftPage(d2005, 2005);
    expect(picks.find((p) => p.overall === 12)).toMatchObject({ name: 'Yaroslav Korolev', teamFranchise: LAC, chain: [] });
  });

  it('reads every pick on the page, stripping sort templates and markers', () => {
    const { picks, unparsed } = parseDraftPage(d2005, 2005);
    expect(unparsed).toEqual([]);
    expect(picks).toEqual([
      { year: 2005, round: 1, overall: 3, name: 'Deron Williams', teamFranchise: UTA, chain: [POR], tradedTo: [] },
      { year: 2005, round: 1, overall: 12, name: 'Yaroslav Korolev', teamFranchise: LAC, chain: [], tradedTo: [] },
      { year: 2005, round: 1, overall: 13, name: 'Sean May', teamFranchise: CHA, chain: [CLE, PHX], tradedTo: [] },
      { year: 2005, round: 2, overall: 31, name: 'Salim Stoudamire', teamFranchise: ATL, chain: [], tradedTo: [] },
    ]);
  });

  it('keeps the drafting team on a draft-day "(traded to X)" and records where the pick went', () => {
    const { picks } = parseDraftPage(d1995, 1995);
    expect(picks.find((p) => p.overall === 2)).toEqual({
      year: 1995, round: 1, overall: 2, name: 'Antonio McDyess', teamFranchise: LAC, chain: [], tradedTo: [DEN],
    });
  });

  /** One selections row with this team cell. */
  const row = (teamCell: string, year = 2022) =>
    parseDraftPage([...HEADER, '|-', '| 1', '| 13', '| [[Jalen Duren]]<sup>*</sup>', '| C', '| {{USA}}', `| ${teamCell}`, '| Memphis', '|}'].join('\n'), year);

  it.each([
    ['(from A to B to C)', '[[Toronto Raptors]] {{small|(from Chicago to Washington to San Antonio)}}', TOR, [CHI, WAS, SAS], []],
    ['(from A, B and C)', '[[Charlotte Hornets]] {{small|(from [[New York Knicks|New York]], Boston, and Dallas)}}', CHA, [NYK, BOS, DAL], []],
    ['a footnote inside the {{small}}', '[[Indiana Pacers]] {{small|(from Milwaukee via Cleveland,{{refn|group=upper-alpha|name=x|June 1: [[Milwaukee Bucks]] to [[Cleveland Cavaliers]] (three-team trade with [[Sacramento Kings]])}})}}', IND, [MIL, CLE], []],
    ['(rights traded to X)', '[[Los Angeles Clippers]] {{small|(rights traded to [[New York Knicks|New York]])}}', LAC, [], [NYK]],
    ['(traded to X via Y)', '[[Charlotte Hornets]] {{small|(traded to Detroit via New York)}}{{refn|group=lower-alpha|name=13th}}', CHA, [], [NYK, DET]],
    ['(from A,}}…{{small| traded to B)', '[[Chicago Bulls]] {{small|(from [[Denver Nuggets|Denver]],}}{{ref label|N|o|o}}{{small| traded to [[Indiana Pacers|Indiana]])}}', CHI, [DEN], [IND]],
    ['"…), traded to X" outside the parentheses', '[[Minnesota Timberwolves]] (from [[Sacramento Kings]] via [[Houston Rockets|Houston]]), traded to [[Cleveland Cavaliers]]', MIN, [SAC, HOU], [CLE]],
    ['(traded to A; later traded to B)', '[[Milwaukee Bucks]] (traded to Detroit; later traded to Cleveland)', MIL, [], [DET, CLE]],
    ["(from A, traded ''back'' to A)", "[[Dallas Mavericks]] <small>(from [[Los Angeles Lakers|L.A. Lakers]],</small><small> traded ''back'' to the L.A. Lakers)</small>", DAL, [LAL], [LAL]],
  ])('reads %s', (_, cell, teamFranchise, chain, tradedTo) => {
    const { picks, unparsed } = row(cell);
    expect(unparsed).toEqual([]);
    expect(picks).toEqual([{ year: 2022, round: 1, overall: 13, name: 'Jalen Duren', teamFranchise, chain, tradedTo }]);
  });

  it('reads era names: a link target with a "(…)" qualifier, an en dash, and an expansion team before its first season', () => {
    expect(row('[[Charlotte Hornets (1988–2002)|Charlotte Hornets]]', 1995).picks[0].teamFranchise).toBe(CHA);
    expect(row('[[Sacramento Kings|Kansas City–Omaha Kings]]', 1973).picks[0].teamFranchise).toBe(SAC);
    expect(row('[[Charlotte Bobcats]] <small>(from [[Los Angeles Clippers|L.A. Clippers]])</small>', 2004).picks[0]).toMatchObject({ teamFranchise: CHA, chain: [LAC] });
  });

  it('returns a forfeited pick in forfeited, not as a pick or unparsed', () => {
    const page = [
      ...HEADER,
      '|-bgcolor="lightgray"',
      '|style="text-align:center;"|2',
      '!scope="row" colspan="6" style="text-align:center;” | [[Milwaukee Bucks]] {{small|(forfeited due to tampering violation)}}',
      '|-', '| 2', '| 32', '| X Y', '| F', '| {{USA}}', '| [[Golden State Warriors]]', '| Nowhere',
      '|}',
    ].join('\n');
    expect(parseDraftPage(page, 2022)).toEqual({
      picks: [{ year: 2022, round: 2, overall: 32, name: 'X Y', teamFranchise: NBA_TEAM_IDS.GSW, chain: [], tradedTo: [] }],
      forfeited: [{ year: 2022, round: 2, teamFranchise: MIL }],
      unparsed: [],
    });
  });

  it('returns a pick whose team cannot be resolved in unparsed instead of dropping it', () => {
    const page = [
      ...HEADER,
      '|-', '| 1', '| 1', '| {{sortname|Joe|Smith}}', '| PF', '| {{USA}}', '| [[Golden State Warriors]]', '| Maryland',
      '|-', '| 1', '| 2', '| {{sortname|Jane|Doe}}', '| F', '| {{USA}}', '| [[Gotham Rockets]] <small>(from [[Golden State Warriors|Golden State]])</small>', '| Nowhere',
      '|}',
    ].join('\n');
    const { picks, unparsed } = parseDraftPage(page, 1995);
    expect(picks.map((p) => p.overall)).toEqual([1]);
    expect(unparsed).toHaveLength(1);
    expect(unparsed[0]).toMatchObject({ source: '1995 NBA draft', index: 2, date: null });
    expect(unparsed[0].text).toContain('Jane Doe');
    expect(unparsed[0].text).toContain('Gotham Rockets');
  });

  it('returns an unknown "from" parenthetical in unparsed', () => {
    const page = [
      ...HEADER,
      '|-', '| 1', '| 1', '| [[Joe Smith (basketball)|Joe Smith]]', '| PF', '| {{USA}}',
      '| [[Golden State Warriors]] <small>(compensation for [[Chris Webber]])</small>', '| Maryland',
      '|}',
    ].join('\n');
    const { picks, unparsed } = parseDraftPage(page, 1995);
    expect(picks).toEqual([]);
    expect(unparsed.map((u) => u.index)).toEqual([1]);
  });
});

describe('parseLotterySection', () => {
  it('returns [] when the page has no draft lottery section', () => {
    expect(parseLotterySection(d1995, 1995)).toEqual([]);
  });

  it('reads each team\'s pre-lottery slot, chance of #1 and the pick it won', () => {
    const rows = parseLotterySection(d2019, 2019);
    expect(rows).toHaveLength(14);
    expect(rows[0]).toEqual({ year: 2019, franchise: NYK, preSlot: 1, oddsFirst: 0.14, pickWon: 3 });
    expect(rows.find((r) => r.franchise === NOP)).toEqual({ year: 2019, franchise: NOP, preSlot: 7, oddsFirst: 0.06, pickWon: 1 });
    expect(rows.find((r) => r.franchise === MEM)).toMatchObject({ preSlot: 8, pickWon: 2 });
    expect(rows.find((r) => r.franchise === LAL)).toMatchObject({ preSlot: 11, oddsFirst: 0.02, pickWon: 4 });
    expect(rows[13]).toEqual({ year: 2019, franchise: SAC, preSlot: 14, oddsFirst: 0.01, pickWon: 14 });
  });

  it('reads percentages and a highlight whose style attribute is missing its closing quote', () => {
    const page = [
      '==Draft lottery==',
      '{|class="wikitable plainrowheaders"',
      '! Team !! Record !! Lottery chances !! 1st !! 2nd !! 3rd',
      '|-',
      '! scope="row" | [[Houston Rockets]]',
      '| 17–55|| 140 || 14.0% ||style="background:#ff9;| 13.4% || 12.7%',
      '|-',
      '! scope="row" | [[Detroit Pistons]]',
      '| 20–52|| 140 ||style="background:#ff9;| 14.0% || 13.4% || 12.7%',
      '|}',
    ].join('\n');
    expect(parseLotterySection(page, 2021)).toEqual([
      { year: 2021, franchise: HOU, preSlot: 1, oddsFirst: 0.14, pickWon: 2 },
      { year: 2021, franchise: DET, preSlot: 2, oddsFirst: 0.14, pickWon: 1 },
    ]);
  });

  it('throws on a lottery row with no pick marked won rather than leaving it out', () => {
    const page = ['==Draft lottery==', '{|', '! Team !! Record !! Chances !! 1st !! 2nd', '|-', '! [[Houston Rockets]]', '| 17–55 || 140 || .140 || .134', '|}'].join('\n');
    expect(() => parseLotterySection(page, 2021)).toThrow(/0 picks marked won/);
  });
});
