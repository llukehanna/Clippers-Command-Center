import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parseCoachStints, parseCoaches, parseContracts, parseExecutives, parseFranchiseDraft,
  parseRoster, parseSalaries, uncomment,
} from './bbref-tables.js';

const fx = (n: string) =>
  readFileSync(new URL(`../__fixtures__/franchise/bbref/${n}`, import.meta.url), 'utf8');

describe('uncomment', () => {
  it('unwraps html comments, keeping their content', () => {
    expect(uncomment('a<!-- <b>x</b> -->c')).toBe('a <b>x</b> c');
  });
});

describe('parseRoster', () => {
  const rows = parseRoster(fx('roster-buf-1971.html'));
  it('reads the first row', () => {
    expect(rows[0]).toEqual({ bbrefId: 'bowmana01', name: 'Nate Bowman', number: '17', birthdate: '1943-03-19' });
    expect(rows).toHaveLength(4);
  });
  it('returns null birthdate for a blank cell', () => {
    const r = parseRoster(fx('roster-blank-birthdate.html'));
    expect(r[1]).toMatchObject({ bbrefId: 'bryanem01', birthdate: null });
  });
});

describe('parseSalaries', () => {
  it('reads salaries inside an HTML comment', () => {
    const rows = parseSalaries(fx('salaries-lac-1985-commented.html'));
    expect(rows.length).toBe(8);
    expect(rows[0]).toMatchObject({ bbrefId: 'waltobi01', name: 'Bill Walton', amountUsd: 1350000 });
  });
});

describe('parseFranchiseDraft', () => {
  const rows = parseFranchiseDraft(fx('draft.html'));
  it('reads year, round, overall, player and id', () => {
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ year: 2026, round: 1, overall: 5, name: 'Keaton Wagler', bbrefId: 'wagleke01' });
  });
  it('strips the traded-pick suffix from the name', () => {
    expect(rows[2].name).toBe('Henri Veesaar');
  });
});

describe('parseContracts', () => {
  const rows = parseContracts(fx('contracts.html'));
  it('reads seasons by start year and guaranteed money', () => {
    expect(rows[0]).toMatchObject({ bbrefId: 'garlada01', name: 'Darius Garland', guaranteedUsd: 87053440 });
    expect(rows[0].seasons).toEqual([
      { seasonId: 2026, amountUsd: 42166510, option: null },
      { seasonId: 2027, amountUsd: 44886930, option: null },
    ]);
  });
  it('marks a player option season', () => {
    const ingram = rows.find((r) => r.bbrefId === 'ingrabr01')!;
    expect(ingram.seasons[1]).toEqual({ seasonId: 2027, amountUsd: 41904762, option: 'player' });
    expect(ingram.seasons[0].option).toBeNull();
  });
  it('marks a team option season', () => {
    const h = rows.find((r) => r.bbrefId === 'hachiru01')!;
    expect(h.seasons.find((s) => s.option === 'team')).toMatchObject({ seasonId: 2027 });
  });
});

describe('parseCoaches (team-season page)', () => {
  it('returns one row per coach in page order, season = start year', () => {
    expect(parseCoaches(fx('team-lac-1985-coach.html'))).toEqual([
      { seasonId: 1984, bbrefId: 'lynamji99c', name: 'Jim Lynam', games: 61, wins: 22, losses: 39, playoffWins: null, playoffLosses: null, order: 0 },
      { seasonId: 1984, bbrefId: 'chanedo01c', name: 'Don Chaney', games: 21, wins: 9, losses: 12, playoffWins: null, playoffLosses: null, order: 1 },
    ]);
  });
});

describe('parseCoachStints (franchise coaches page)', () => {
  it('reads from/to years and totals', () => {
    const rows = parseCoachStints(fx('coaches.html'));
    expect(rows[0]).toMatchObject({
      bbrefId: 'brownla01c', name: 'Larry Brown', fromSeasonId: 1992, toSeasonId: 1993,
      games: 117, wins: 64, losses: 53, playoffWins: 4, playoffLosses: 6,
    });
    expect(rows[1]).toMatchObject({ name: 'Mack Calvin', playoffWins: null, playoffLosses: null });
  });
});

describe('parseExecutives', () => {
  const rows = parseExecutives(fx('executives.html'));
  it('reads names, ids and dates', () => {
    expect(rows[0]).toMatchObject({ bbrefId: 'donoved99x', name: 'Eddie Donovan', start: '1970', end: '1975-03-20' });
    expect(rows[1]).toMatchObject({ name: 'Bob MacKinnon', start: '1975-05-21', title: null });
  });
});
