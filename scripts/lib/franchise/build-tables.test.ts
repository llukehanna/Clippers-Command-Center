import { describe, expect, it } from 'vitest';
import { NBA_TEAM_IDS } from '../nba-teams.js';
import type { CoachSeasonRow } from './bbref-tables.js';
import {
  buildCoachSeasons, buildContracts, buildExecTerms, buildSalaries, checkCoachStints, completePeople, kindOfBbrefId,
  resolveHonors,
} from './build-tables.js';
import type { PickRow } from './picks.js';
import type { MergedMove } from './reconcile-moves.js';

const { LAC, HOU } = NBA_TEAM_IDS;

const coach = (seasonId: number, bbrefId: string, name: string, wins: number, losses: number, order = 0): CoachSeasonRow => ({
  seasonId, bbrefId, name, games: wins + losses, wins, losses, playoffWins: null, playoffLosses: null, order,
});

describe('buildSalaries (payroll partial rule)', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ bbrefId: `p${i}`, name: `P ${i}`, amountUsd: 1000 }));
  it('is partial when fewer salaries than players with a game (player_seasons), else by the 10-player rule', () => {
    const { salaries, payroll } = buildSalaries([
      { seasonId: 2004, source: 'bbref:LAC-2005', rows: rows(12) },
      { seasonId: 2005, source: 'bbref:LAC-2006', rows: rows(12) },
      { seasonId: 1985, source: 'bbref:LAC-1986', rows: [...rows(9), rows(1)[0]] }, // one player listed twice
    ], new Map([[2004, 14], [2005, 12]]));
    expect(payroll).toEqual([
      { seasonId: 1985, listedPlayers: 9, rosterPlayers: null, listedTotalUsd: 9000, isPartial: true },
      { seasonId: 2004, listedPlayers: 12, rosterPlayers: 14, listedTotalUsd: 12000, isPartial: true },
      { seasonId: 2005, listedPlayers: 12, rosterPlayers: 12, listedTotalUsd: 12000, isPartial: false },
    ]);
    expect(salaries.filter((s) => s.seasonId === 1985)).toHaveLength(9);
    expect(salaries[0].source).toBe('bbref:LAC-1986');
  });
});

describe('buildContracts', () => {
  it('keeps the first row of a player listed twice and reports the duplicate', () => {
    const r = (bbrefId: string, name: string) => ({ bbrefId, name, seasons: [{ seasonId: 2026, amountUsd: 5, option: null }], guaranteedUsd: null });
    const out = buildContracts([r('hachiru01', 'Rui Hachimura'), r('garlada01', 'Darius Garland'), r('hachiru01', 'Rui Hachimura')], '2026-11-18T02:29:01.474Z');
    expect(out.contracts.map((c) => c.personKey)).toEqual(['hachiru01', 'garlada01']);
    expect(out.duplicates).toEqual(['Rui Hachimura (hachiru01)']);
    expect(out.contracts[0].fetchedAt).toBe('2026-11-18T02:29:01.474Z');
    expect(buildContracts([r('a01', 'A')], null).contracts).toEqual([]);
  });
});

describe('buildCoachSeasons (Ruling R6)', () => {
  it('gives a season\'s playoff record only to its single coach', () => {
    const out = buildCoachSeasons(
      [coach(2015, 'riverdo01c', 'Doc Rivers', 53, 29), coach(1991, 'schulmi01c', 'Mike Schuler', 21, 24), coach(1991, 'brownla01c', 'Larry Brown', 23, 12, 1)],
      new Map([[2015, { wins: 2, losses: 4 }], [1991, { wins: 2, losses: 3 }]]),
    );
    expect(out.map((c) => [c.seasonId, c.playoffWins, c.playoffLosses])).toEqual([[2015, 2, 4], [1991, null, null], [1991, null, null]]);
    expect(buildCoachSeasons([coach(2016, 'riverdo01c', 'Doc Rivers', 51, 31)], new Map())[0].playoffWins).toBeNull();
  });

  it('checks stints (BBRef From/To are season END years) against fully cached seasons', () => {
    const seasons = [coach(1991, 'brownla01c', 'Larry Brown', 23, 12), coach(1992, 'brownla01c', 'Larry Brown', 41, 40)];
    const stint = { bbrefId: 'brownla01c', name: 'Larry Brown', fromSeasonId: 1992, toSeasonId: 1993, games: 117, wins: 64, losses: 53, playoffWins: 4, playoffLosses: 6 };
    expect(checkCoachStints(seasons, [stint], new Set([1991, 1992]))).toEqual(['Larry Brown (brownla01c) 1991–1992: stint 64-53, seasons 64-52']);
    expect(checkCoachStints(seasons, [stint], new Set([1991]))).toEqual([]); // 1992-93 not cached: not checked
  });
});

describe('buildExecTerms', () => {
  it('keeps full dates and writes a bare year as null, reported', () => {
    const out = buildExecTerms([{ bbrefId: 'donoved99x', name: 'Eddie Donovan', title: null, start: '1970', end: '1975-03-20', notes: null }]);
    expect(out.terms).toEqual([{ personKey: 'donoved99x', name: 'Eddie Donovan', title: null, startDate: null, endDate: '1975-03-20' }]);
    expect(out.partialDates).toEqual(['Eddie Donovan: "1970"']);
  });
});

describe('resolveHonors (only while a Clippers player or coach)', () => {
  const ctx = {
    rosterBySeason: new Map([
      [2016, [{ bbrefId: 'willilo02', name: 'Lou Williams', number: '23', birthdate: null }]],
      [1984, [{ bbrefId: 'waltobi01', name: 'Bill Walton', number: '32', birthdate: null }]],
    ]),
    coachSeasons: [coach(1991, 'brownla01c', 'Larry Brown', 23, 12)],
    execTerms: [{ personKey: 'westje01x', name: 'Jerry West', title: null, startDate: '2017-06-19', endDate: null }],
    people: [],
  };
  it('resolves against that season\'s roster, coaches or executives; Hall of Fame against any season', () => {
    const out = resolveHonors([
      { seasonId: 2017, name: 'Lou Williams', honor: 'smoy', detail: null }, // not on the 2017 roster here
      { seasonId: 2016, name: 'Lou Williams', honor: 'smoy', detail: null },
      { seasonId: null, name: 'Bill Walton', honor: 'hall_of_fame', detail: '1993' },
      { seasonId: null, name: 'Larry Brown', honor: 'hall_of_fame', detail: '2002' },
      { seasonId: 2018, name: 'Jerry West', honor: 'eoy', detail: null },
      { seasonId: null, name: 'Bill Russell', honor: 'retired_number_league', detail: '6' },
    ], ctx);
    expect(out.map((h) => h.personKey)).toEqual([null, 'willilo02', 'waltobi01', 'brownla01c', 'westje01x', null]);
    expect(out[5].honor).toBe('retired_number_league');
  });
});

describe('completePeople', () => {
  it('lets a later move ref fill a person row with no NBA.com id, but never a base row or an id already held', () => {
    const base = [{ personKey: 'basepl01', kind: 'player' as const, displayName: 'Base Player', birthdate: null, nbaPersonId: null, playerId: null }];
    const mvOf = (key: string, person: { bbrefId: string; nbaPersonId?: number; name: string }): MergedMove => ({
      sourceKey: key, transactionKey: key, sources: [key], date: '2020-01-01', kind: 'waiver', involvesClippers: true, complete: true,
      conflicts: [], parts: [{ from: LAC, to: null, kind: 'player', person }],
    });
    const out = completePeople(base, {
      moves: [
        mvOf('bbref:1', { bbrefId: 'loyerfl01', name: 'Fletcher Loyer' }),
        mvOf('nba:2', { bbrefId: 'loyerfl01', nbaPersonId: 1643630, name: 'Fletcher Loyer' }),
        mvOf('nba:3', { bbrefId: 'basepl01', nbaPersonId: 55, name: 'Base Player' }),
        mvOf('bbref:4', { bbrefId: 'otherx01', name: 'Other X' }),
        mvOf('nba:5', { bbrefId: 'otherx01', nbaPersonId: 1643630, name: 'Other X' }),
      ],
      picks: [], draftNames: new Map(), coachSeasons: [], execTerms: [], salaries: [], contracts: [],
      dbPlayers: [{ player_id: '9', nba_person_id: 1643630, display_name: 'Fletcher Loyer', birthdate: null }],
    });
    const by = new Map(out.map((p) => [p.personKey, p]));
    expect(by.get('loyerfl01')).toMatchObject({ nbaPersonId: 1643630, playerId: '9' });
    expect(by.get('basepl01')?.nbaPersonId).toBeNull(); // base rows come from matchPeople: not refilled here
    expect(by.get('otherx01')?.nbaPersonId).toBeNull(); // 1643630 is already held
  });

  it('adds coaches, executives, move people (BBRef id, else nba:<id>) and selections, never twice', () => {
    const base = [{ personKey: 'paulch01', kind: 'player' as const, displayName: 'Chris Paul', birthdate: '1985-05-06', nbaPersonId: 101108, playerId: '7' }];
    const move: MergedMove = {
      sourceKey: 'nba:Trade 1', transactionKey: 'nba:Trade 1', sources: ['nba:Trade 1'], date: '2017-06-28', kind: 'trade',
      involvesClippers: true, complete: true, conflicts: [], parts: [
        { from: LAC, to: HOU, kind: 'player', person: { nbaPersonId: 101108, name: 'Chris Paul' } },
        { from: HOU, to: LAC, kind: 'player', person: { nbaPersonId: 201976, name: 'Patrick Beverley' } },
        { from: HOU, to: LAC, kind: 'player', person: { bbrefId: 'willilo02', nbaPersonId: 101150, name: 'Lou Williams' } },
      ],
    };
    const pick = { pickKey: '2018-1-HOU', year: 2018, round: 1, overall: 30, selectedPersonKey: 'name:omari-spellman-2018' } as PickRow;
    const out = completePeople(base, {
      moves: [move], picks: [pick], draftNames: new Map([['2018-30', 'Omari Spellman']]),
      coachSeasons: [coach(2017, 'riverdo01c', 'Doc Rivers', 42, 40)],
      execTerms: [{ personKey: 'westje01x', name: 'Jerry West', title: null, startDate: null, endDate: null }],
      salaries: [{ bbrefId: 'willilo02', name: 'Lou Williams' }], contracts: [],
      dbPlayers: [{ player_id: '9', nba_person_id: 201976, display_name: 'Patrick Beverley', birthdate: null }],
    });
    const by = new Map(out.map((p) => [p.personKey, p]));
    expect(out).toHaveLength(6);
    expect(by.get('riverdo01c')?.kind).toBe('coach');
    expect(by.get('westje01x')?.kind).toBe('executive');
    expect(by.get('nba:201976')).toMatchObject({ nbaPersonId: 201976, playerId: '9', displayName: 'Patrick Beverley' });
    expect(by.has('nba:101108')).toBe(false); // Chris Paul's id is on his BBRef row already
    expect(by.get('willilo02')?.nbaPersonId).toBe(101150); // from the move ref, though his salary row has no id
    expect(by.get('name:omari-spellman-2018')?.displayName).toBe('Omari Spellman');
    expect(kindOfBbrefId('donoved99x')).toBe('executive');
  });
});
