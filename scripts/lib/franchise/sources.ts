// scripts/lib/franchise/sources.ts
// The list of every page/file the franchise-history archive downloads.
// Keys are filesystem-safe and readable; the cache layout is <dir>/<source>/<key>.<ext>.
import { wikiQueryUrl, type SourceSpec } from './fetcher.js';

const BBREF = 'https://www.basketball-reference.com';

/** Basketball-Reference franchise code for a season, by the season's END year. */
export function bbrefEra(endYear: number): 'BUF' | 'SDC' | 'LAC' {
  if (endYear <= 1978) return 'BUF';
  if (endYear <= 1984) return 'SDC';
  return 'LAC';
}

/** fromSeason/toSeason are season START years (1970 = 1970-71). */
export function bbrefSources(fromSeason: number, toSeason: number): SourceSpec[] {
  const specs: SourceSpec[] = [];
  for (let start = fromSeason; start <= toSeason; start++) {
    const end = start + 1;
    const code = bbrefEra(end);
    specs.push({ source: 'bbref', key: `${code}-${end}_transactions`, url: `${BBREF}/teams/${code}/${end}_transactions.html`, ext: 'html' });
    specs.push({ source: 'bbref', key: `${code}-${end}`, url: `${BBREF}/teams/${code}/${end}.html`, ext: 'html' });
  }
  specs.push({ source: 'bbref', key: 'draft', url: `${BBREF}/teams/LAC/draft.html`, ext: 'html' });
  specs.push({ source: 'bbref', key: 'coaches', url: `${BBREF}/teams/LAC/coaches.html`, ext: 'html' });
  specs.push({ source: 'bbref', key: 'executives', url: `${BBREF}/teams/LAC/executives.html`, ext: 'html' });
  specs.push({ source: 'bbref', key: 'contracts', url: `${BBREF}/contracts/LAC.html`, ext: 'html' });
  return specs;
}

/** The cache key (file name without `.json`) of a Wikipedia page title. */
export function wikiKey(title: string): string {
  return title.replace(/ /g, '_').replace(/\//g, '_');
}

function wikiSpec(title: string): SourceSpec {
  return {
    source: 'wiki',
    key: wikiKey(title),
    title,
    url: wikiQueryUrl([title]),
    ext: 'json',
  };
}

/** "<start>–<yy> <team> season" (1999–2000 spells the year out), the title Wikipedia gives a team's season page. */
export function teamSeasonTitle(start: number, team: string): string {
  const second = start === 1999 ? '2000' : String((start + 1) % 100).padStart(2, '0');
  return `${start}–${second} ${team} season`;
}

/** The Clippers' season page title for a season start year. */
export function wikiSeasonTitle(start: number): string {
  return teamSeasonTitle(start, start <= 1977 ? 'Buffalo Braves' : start <= 1983 ? 'San Diego Clippers' : 'Los Angeles Clippers');
}

export function wikiSources(fromSeason: number, toSeason: number, futureDrafts: number[]): SourceSpec[] {
  const titles: string[] = [];
  for (let y = fromSeason; y <= toSeason; y++) titles.push(wikiSeasonTitle(y));
  for (let y = fromSeason; y <= toSeason; y++) titles.push(`${y} NBA draft`);
  for (const y of futureDrafts) titles.push(`${y} NBA draft`);
  titles.push('Los Angeles Clippers', 'NBA draft lottery');
  return [...new Set(titles)].map(wikiSpec);
}

export function wikiCounterpartySources(pages: string[]): SourceSpec[] {
  return [...new Set(pages)].map(wikiSpec);
}

export function espnDraftSources(fromYear: number, toYear: number): SourceSpec[] {
  const specs: SourceSpec[] = [];
  for (let y = Math.max(fromYear, 2003); y <= toYear; y++) {
    specs.push({
      source: 'espn', key: `draft-${y}`, ext: 'json',
      url: `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/${y}/draft/rounds?limit=100`,
    });
  }
  return specs;
}

export const NBA_MOVEMENT: SourceSpec = {
  source: 'nba', key: 'movement', ext: 'json',
  url: 'https://stats.nba.com/js/data/playermovement/NBA_Player_Movement.json',
};
