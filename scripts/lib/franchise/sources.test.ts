import { describe, expect, it } from 'vitest';
import { bbrefSources, espnDraftSources, NBA_MOVEMENT, wikiCounterpartySources, wikiSources } from './sources.js';

describe('bbrefSources', () => {
  it('uses era codes by season end year', () => {
    const urls = bbrefSources(1970, 1985).map((s) => s.url);
    expect(urls).toContain('https://www.basketball-reference.com/teams/BUF/1971_transactions.html');
    expect(urls).toContain('https://www.basketball-reference.com/teams/BUF/1978.html');
    expect(urls).toContain('https://www.basketball-reference.com/teams/SDC/1979.html');
    expect(urls).toContain('https://www.basketball-reference.com/teams/SDC/1984.html');
    expect(urls).toContain('https://www.basketball-reference.com/teams/LAC/1985.html');
    expect(urls).toContain('https://www.basketball-reference.com/teams/LAC/1986_transactions.html');
  });
  it('adds the franchise-wide pages once and has unique keys', () => {
    const specs = bbrefSources(1970, 2026);
    const keys = specs.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining(['draft', 'coaches', 'executives', 'contracts']));
    expect(specs.length).toBe(57 * 2 + 4);
    expect(specs.every((s) => s.source === 'bbref' && s.ext === 'html')).toBe(true);
  });
});

describe('wikiSources', () => {
  const specs = wikiSources(1970, 2026, [2027, 2028]);
  const titleOf = (s: { title?: string }) => s.title!;
  const titles = specs.map(titleOf);
  it('names season pages by start year with an en dash and era team name', () => {
    expect(titles).toContain('1970–71 Buffalo Braves season');
    expect(titles).toContain('1977–78 Buffalo Braves season');
    expect(titles).toContain('1978–79 San Diego Clippers season');
    expect(titles).toContain('1983–84 San Diego Clippers season');
    expect(titles).toContain('1984–85 Los Angeles Clippers season');
    expect(titles).toContain('1999–2000 Los Angeles Clippers season');
    expect(titles).toContain('2026–27 Los Angeles Clippers season');
  });
  it('adds drafts, future drafts, the franchise page and the lottery page', () => {
    expect(titles).toContain('1970 NBA draft');
    expect(titles).toContain('2026 NBA draft');
    expect(titles).toContain('2028 NBA draft');
    expect(titles).toContain('Los Angeles Clippers');
    expect(titles).toContain('NBA draft lottery');
  });
  it('builds query-API urls and filesystem-safe keys', () => {
    const s = specs.find((x) => titleOf(x) === '1970–71 Buffalo Braves season')!;
    expect(s.url).toContain('https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&redirects=1&format=json&formatversion=2&titles=');
    expect(s.title).toBe('1970–71 Buffalo Braves season');
    expect(s.key).toBe('1970–71_Buffalo_Braves_season');
    expect(s.ext).toBe('json');
  });
});

describe('other sources', () => {
  it('lists ESPN draft rounds from 2003', () => {
    const s = espnDraftSources(2003, 2005);
    expect(s.map((x) => x.key)).toEqual(['draft-2003', 'draft-2004', 'draft-2005']);
    expect(s[0].url).toBe('https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2003/draft/rounds?limit=100');
  });
  it('has the NBA movement file', () => {
    expect(NBA_MOVEMENT.url).toBe('https://stats.nba.com/js/data/playermovement/NBA_Player_Movement.json');
  });
  it('builds counterparty wiki pages', () => {
    const s = wikiCounterpartySources(['Boston Celtics']);
    expect(s[0].key).toBe('Boston_Celtics');
    expect(s[0].source).toBe('wiki');
  });
});
