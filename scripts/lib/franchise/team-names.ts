// scripts/lib/franchise/team-names.ts
// Resolve a team name as written in a source ("the Charlotte Bobcats") to a franchise id,
// using the era-correct names for the season.
import { NBA_TEAM_IDS } from '../nba-teams.js';
import { TEAM_ERAS } from '../history/team-eras.js';
import { OVERRIDES } from './overrides.js';
import type { FranchiseId, Override } from './types.js';

export interface Alias {
  text: string; // normalized (see norm)
  firstSeason: number;
  lastSeason: number | null;
  franchiseTricode: string;
}

/** Odd forms the era table cannot produce on its own. Seasons are inclusive season start years. */
export const ALIASES: Alias[] = [
  { text: 'new orleans/oklahoma city hornets', firstSeason: 2005, lastSeason: 2006, franchiseTricode: 'NOP' },
  { text: 'new orleans oklahoma city hornets', firstSeason: 2005, lastSeason: 2006, franchiseTricode: 'NOP' },
  { text: 'oklahoma city hornets', firstSeason: 2005, lastSeason: 2006, franchiseTricode: 'NOP' },
  // NBA.com (and some Wikipedia labels) write "LA Clippers"; the era table has "Los Angeles Clippers".
  { text: 'la clippers', firstSeason: 1984, lastSeason: null, franchiseTricode: 'LAC' },
];

function norm(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’`]/g, '')
    .replace(/[^a-z0-9/-]+/g, ' ')
    .trim()
    .replace(/^the /, '')
    .trim();
}

/**
 * `teamName` overrides (overrides.ts) win over the alias and era tables; pass `[]` to resolve without them (the
 * stale check in apply-overrides.ts does).
 */
export function franchiseFromName(text: string, seasonId: number, overrides: readonly Override[] = OVERRIDES): FranchiseId | null {
  const t = norm(text);
  if (!t) return null;
  for (const o of overrides) {
    if (o.kind === 'teamName' && o.match.seasonId === seasonId && norm(o.match.text) === t) return o.franchise;
  }
  const hits = new Set<string>();
  for (const a of ALIASES) {
    if (a.text === t && a.firstSeason <= seasonId && (a.lastSeason === null || seasonId <= a.lastSeason)) {
      hits.add(a.franchiseTricode);
    }
  }
  for (const era of TEAM_ERAS) {
    if (era.firstSeason > seasonId || (era.lastSeason !== null && seasonId > era.lastSeason)) continue;
    const city = norm(era.city);
    const name = norm(era.name);
    if (t === city || t === name || t === `${city} ${name}`) hits.add(era.franchiseTricode);
  }
  if (hits.size !== 1) return null;
  return NBA_TEAM_IDS[[...hits][0]] ?? null;
}
