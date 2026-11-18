import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTeamArticle } from './wiki-team.js';

const article = readFileSync(new URL('../__fixtures__/franchise/wiki/team-article.txt', import.meta.url), 'utf8');

describe('parseTeamArticle', () => {
  it('lists retired numbers with number and name', () => {
    // The Clippers have retired no numbers of their own; the section records the league-wide No. 6.
    expect(parseTeamArticle(article).retired).toEqual([
      { seasonId: null, name: 'Bill Russell', honor: 'retired_number', detail: '6' },
    ]);
  });

  it('reads retired numbers from a table too', () => {
    const t = [
      '===Retired numbers===',
      '{| class="wikitable"',
      '! No. !! Player !! Position !! Tenure',
      '|-',
      "| '''32''' || [[Bill Walton]] || C || 1979–1985",
      '|}',
    ].join('\n');
    expect(parseTeamArticle(t).retired).toEqual([
      { seasonId: null, name: 'Bill Walton', honor: 'retired_number', detail: '32' },
    ]);
  });

  it('reads individual awards with season start years, expanding year ranges', () => {
    const { awards, skippedCategories } = parseTeamArticle(article);
    const of = (honor: string) => awards.filter((a) => a.honor === honor).map((a) => [a.name, a.seasonId]);
    expect(of('roy')).toEqual([['Terry Cummings', 1982], ['Blake Griffin', 2010]]);
    expect(of('smoy')).toEqual([
      ['Jamal Crawford', 2013], ['Jamal Crawford', 2015], ['Lou Williams', 2017], ['Lou Williams', 2018], ['Montrezl Harrell', 2019],
    ]);
    expect(of('all_nba_1')).toEqual([
      ['Chris Paul', 2011], ['Chris Paul', 2012], ['Chris Paul', 2013], ['DeAndre Jordan', 2015], ['Kawhi Leonard', 2020],
    ]);
    expect(of('all_rookie_2')).toHaveLength(7);
    expect(awards.every((a) => a.detail === null || a.honor === 'hall_of_fame')).toBe(true);
    expect(skippedCategories).toEqual(['NBA Sportsmanship Award', 'Slam Dunk champion']);
  });

  it('reads Hall of Famers into awards with the induction year as detail', () => {
    const hof = parseTeamArticle(article).awards.filter((a) => a.honor === 'hall_of_fame');
    expect(hof.map((a) => a.name)).toEqual([
      'Bill Walton', 'Bob McAdoo', 'Jack Ramsay', 'Larry Brown', 'Bill Fitch', 'Doc Rivers', 'Cotton Fitzsimmons', 'Jerry West',
    ]);
    expect(hof[0]).toEqual({ seasonId: null, name: 'Bill Walton', honor: 'hall_of_fame', detail: '1993' });
  });

  it('reads All-Star selections and All-Star MVPs', () => {
    const { allStars } = parseTeamArticle(article);
    const kawhi = allStars.filter((a) => a.name === 'Kawhi Leonard' && a.honor === 'all_star').map((a) => a.seasonId);
    expect(kawhi).toEqual([2019, 2020, 2023]);
    expect(allStars.filter((a) => a.honor === 'all_star')).toHaveLength(26);
    expect(allStars.filter((a) => a.honor === 'all_star_mvp').map((a) => [a.name, a.seasonId])).toEqual([
      ['Randy Smith', 1977], ['Chris Paul', 2012], ['Kawhi Leonard', 2019],
    ]);
  });

  it('reads head coaches from a list, and none from a section that only points elsewhere', () => {
    expect(parseTeamArticle(article).coaches).toEqual([]);
    const list = '==Head coaches==\n* [[Jack Ramsay]] (1972–1976)\n* [[Tyronn Lue]] (2020–present)\n';
    expect(parseTeamArticle(list).coaches).toEqual([
      { name: 'Jack Ramsay', from: 1972, to: 1976 },
      { name: 'Tyronn Lue', from: 2020, to: null },
    ]);
  });

  it('returns empty arrays when a section is missing', () => {
    expect(parseTeamArticle('==History==\nNothing here.')).toEqual({
      retired: [], awards: [], allStars: [], coaches: [], skippedCategories: [],
    });
  });
});
