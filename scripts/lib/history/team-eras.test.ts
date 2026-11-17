import { describe, it, expect } from 'vitest';
import { NBA_TEAM_IDS, TRICODE_BY_NBA_ID } from '../nba-teams.js';
import { resolveEra, franchiseStartSeason, TEAM_ERAS } from './team-eras.js';

// Seasons in which a franchise legitimately did not play (Charlotte, between the
// Hornets' move to New Orleans and the Bobcats' expansion debut).
const DORMANT: Record<string, number[]> = { CHA: [2002, 2003] };

describe('NBA team ids', () => {
  it('maps tricodes to ids and back', () => {
    expect(NBA_TEAM_IDS.LAC).toBe(1610612746);
    expect(TRICODE_BY_NBA_ID[1610612746]).toBe('LAC');
    expect(Object.keys(NBA_TEAM_IDS)).toHaveLength(30);
  });
});

describe('resolveEra', () => {
  it('names the Clippers by era', () => {
    expect(resolveEra('LAC', 1975)).toMatchObject({ abbreviation: 'BUF', city: 'Buffalo', name: 'Braves' });
    expect(resolveEra('LAC', 1980)).toMatchObject({ abbreviation: 'SDC', city: 'San Diego', name: 'Clippers' });
    expect(resolveEra('LAC', 2026)).toMatchObject({ abbreviation: 'LAC', name: 'Clippers' });
  });
  it('names relocated opponents by era', () => {
    expect(resolveEra('OKC', 1979)).toMatchObject({ abbreviation: 'SEA', name: 'SuperSonics' });
    expect(resolveEra('SAC', 1980)).toMatchObject({ abbreviation: 'KCK', name: 'Kings' });
  });
  it('switches Seattle to Oklahoma City after 2007', () => {
    expect(resolveEra('OKC', 2007)).toMatchObject({ abbreviation: 'SEA' });
    expect(resolveEra('OKC', 2008)).toMatchObject({ abbreviation: 'OKC', city: 'Oklahoma City', name: 'Thunder' });
  });
  it('credits 1988-2001 Hornets to Charlotte, not New Orleans', () => {
    expect(resolveEra('CHA', 1995)).toMatchObject({ abbreviation: 'CHH', city: 'Charlotte', name: 'Hornets' });
    expect(resolveEra('CHA', 2002)).toBeNull();
    expect(resolveEra('CHA', 2003)).toBeNull();
    expect(resolveEra('CHA', 2004)).toMatchObject({ abbreviation: 'CHA', name: 'Bobcats' });
    expect(resolveEra('CHA', 2014)).toMatchObject({ abbreviation: 'CHA', name: 'Hornets' });
    expect(franchiseStartSeason('NOP')).toBe(2002);
    expect(resolveEra('NOP', 1995)).toBeNull();
    expect(resolveEra('NOP', 2002)).toMatchObject({ abbreviation: 'NOH' });
    expect(resolveEra('NOP', 2005)).toMatchObject({ abbreviation: 'NOK' });
    expect(resolveEra('NOP', 2007)).toMatchObject({ abbreviation: 'NOH' });
    expect(resolveEra('NOP', 2013)).toMatchObject({ abbreviation: 'NOP', name: 'Pelicans' });
  });
  it('handles Washington, Nets, Warriors and Kings boundaries', () => {
    expect(resolveEra('WAS', 1973)).toMatchObject({ abbreviation: 'CAP' });
    expect(resolveEra('WAS', 1974)).toMatchObject({ abbreviation: 'WSB' });
    expect(resolveEra('WAS', 1997)).toMatchObject({ abbreviation: 'WAS', name: 'Wizards' });
    expect(resolveEra('BKN', 1976)).toMatchObject({ abbreviation: 'NYN' });
    expect(resolveEra('BKN', 1977)).toMatchObject({ abbreviation: 'NJN' });
    expect(resolveEra('BKN', 2012)).toMatchObject({ abbreviation: 'BKN' });
    expect(resolveEra('GSW', 1970)).toMatchObject({ abbreviation: 'SFW' });
    expect(resolveEra('GSW', 1971)).toMatchObject({ abbreviation: 'GSW' });
    expect(resolveEra('SAC', 1972)).toMatchObject({ abbreviation: 'KCO' });
    expect(resolveEra('SAC', 1975)).toMatchObject({ abbreviation: 'KCK' });
    expect(resolveEra('SAC', 1985)).toMatchObject({ abbreviation: 'SAC' });
  });
  it('returns null for unknown franchises and pre-founding seasons', () => {
    expect(resolveEra('XXX', 2000)).toBeNull();
    expect(resolveEra('DAL', 1979)).toBeNull();
    expect(resolveEra('TOR', 1994)).toBeNull();
  });
  it('has no overlapping or gapped eras per franchise from 1970', () => {
    for (const tri of Object.keys(NBA_TEAM_IDS))
      for (let s = 1970; s <= 2026; s++) {
        // Franchises that didn't exist yet in that season (e.g. Toronto before 1995) are skipped.
        if (franchiseStartSeason(tri) > s) continue;
        if (DORMANT[tri]?.includes(s)) continue;
        expect(resolveEra(tri, s), `${tri} ${s}`).not.toBeNull();
      }
  });
  it('never has two eras claiming the same season', () => {
    for (const tri of Object.keys(NBA_TEAM_IDS))
      for (let s = 1970; s <= 2026; s++)
        expect(
          TEAM_ERAS.filter((e) => e.franchiseTricode === tri && e.firstSeason <= s && (e.lastSeason ?? Infinity) >= s).length,
          `${tri} ${s}`,
        ).toBeLessThanOrEqual(1);
  });
});
