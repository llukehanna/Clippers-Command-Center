// scripts/lib/franchise/team-names.ts
// Resolve a team name as written in a source ("the Charlotte Bobcats") to a franchise id,
// using the era-correct names for the season.
import { NBA_TEAM_IDS } from '../nba-teams.js';
import { TEAM_ERAS } from '../history/team-eras.js';
import type { FranchiseId } from './types.js';

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

export function franchiseFromName(text: string, seasonId: number): FranchiseId | null {
  const t = norm(text);
  if (!t) return null;
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
