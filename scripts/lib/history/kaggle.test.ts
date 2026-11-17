import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import {
  streamCsv, assertHeaders, parseGame, parsePlayerGame, parsePerson, KaggleRowError,
  seasonIdOfGame, minutesToClock, GAMES_COLUMNS, PLAYER_STATS_COLUMNS, PLAYERS_COLUMNS,
  STAT_TRACKED_FROM_SEASON, tallyRawCells, type RawCellTally,
} from './kaggle.js';

const FX = path.join(__dirname, '..', '__fixtures__', 'kaggle');

async function load(file: string) {
  const rows: Record<string, string>[] = [];
  for await (const r of streamCsv(path.join(FX, file))) rows.push(r);
  return rows;
}

describe('kaggle readers', () => {
  it('keeps blank cells null and real zeros zero', async () => {
    const [p, nash] = (await load('PlayerStatistics.csv')).map(parsePlayerGame);
    expect(p.steals).toBeNull();
    expect(p.turnovers).toBeNull();
    expect(p.rebounds).toBe(10);
    expect(p.isHome).toBe(true);
    expect(p.starter).toBeNull();
    expect(p.minutes).toBe('34:30');
    expect(nash.blocks).toBe(0);
    expect(nash.fgMade).toBe(7);
  });

  it('nulls untracked 1972 stats even when the cell says 0', async () => {
    // The 1972 fixture row has 0 for blocks, 3-pointers and the rebound split.
    const [p] = (await load('PlayerStatistics.csv')).map(parsePlayerGame);
    expect(p).toMatchObject({ blocks: null, fg3Made: null, fg3Attempted: null, offReb: null, defReb: null, plusMinus: null });
    // Never masked: total rebounds, points, FG, FT.
    expect(p).toMatchObject({ rebounds: 10, points: 25, fgMade: 10, fgAttempted: 20, ftMade: 5, ftAttempted: 6 });
  });

  it('accepts 1.0/0.0 for home and rejects unreadable values', () => {
    const r = { gameId: '1', personId: '2' };
    expect(parsePlayerGame({ ...r, home: '1.0' }).isHome).toBe(true);
    expect(parsePlayerGame({ ...r, home: ' 0.0 ' }).isHome).toBe(false);
    expect(() => parsePlayerGame({ ...r, home: '' })).toThrow(KaggleRowError);
    expect(() => parsePlayerGame({ ...r, home: 'x' })).toThrow(KaggleRowError);
  });

  it('throws KaggleRowError on a blank score but returns null for preseason', async () => {
    const rows = await load('Games.csv');
    expect(() => parseGame({ ...rows[0], homeScore: '' })).toThrow(KaggleRowError);
    expect(parseGame({ ...rows[3], homeScore: '' })).toBeNull();
    expect(parseGame(rows[3])).toBeNull();
    try { parseGame({ ...rows[0], homeScore: '' }); } catch (e) {
      expect(e).toMatchObject({ file: 'Games.csv', field: 'homeScore', value: '' });
    }
  });

  it('throws on unknown or malformed game-id prefixes', async () => {
    const base = (await load('Games.csv'))[0];
    expect(() => parseGame({ ...base, gameId: '1234' })).toThrow(KaggleRowError);
    expect(() => parseGame({ ...base, gameId: '90500001' })).toThrow(KaggleRowError);
    expect(() => parseGame({ ...base, gameId: '7050000' })).toThrow(KaggleRowError);
  });

  it('accepts True/False for home', () => {
    expect(parsePlayerGame({ gameId: '1', personId: '2', home: 'False' }).isHome).toBe(false);
    expect(parsePlayerGame({ gameId: '1', personId: '2', home: 'True' }).isHome).toBe(true);
  });

  it('converts decimal minutes to MM:SS and blank to null', () => {
    expect(minutesToClock('34.5')).toBe('34:30');
    expect(minutesToClock('36.25')).toBe('36:15');
    expect(minutesToClock('')).toBeNull();
  });

  it('derives the season from the game id', () => {
    expect(seasonIdOfGame(27200123)).toBe(1972);
    expect(seasonIdOfGame(22501199)).toBe(2025);
    expect(seasonIdOfGame(29900001)).toBe(1999);
    expect(seasonIdOfGame(20000001)).toBe(2000);
  });

  it('parses games and skips preseason and All-Star', async () => {
    const rows = await load('Games.csv');
    const games = rows.map(parseGame);
    expect(games[0]).toMatchObject({
      nbaGameId: 27200123, seasonId: 1972, gameDate: '1972-12-05',
      homeFranchiseId: 1610612746, awayFranchiseId: 1610612738,
      homeScore: 101, awayScore: 99, isPlayoffs: false, homeCity: 'Buffalo', homeName: 'Braves',
    });
    expect(games[1]?.seasonId).toBe(2005);
    expect(games[2]).toBeNull();
    expect(games[3]).toBeNull();
    expect(games[4]?.isPlayoffs).toBe(true);
  });

  it('keeps play-in as non-playoffs and skips the Cup final', async () => {
    const base = (await load('Games.csv'))[1];
    const playIn = parseGame({ ...base, gameId: '52500001', gameType: 'Play-In Tournament' });
    expect(playIn).not.toBeNull();
    expect(playIn?.isPlayoffs).toBe(false);
    expect(parseGame({ ...base, gameId: '62500001', gameType: 'NBA Cup' })).toBeNull();
  });

  it('warns once when the type column disagrees with the id', async () => {
    const base = (await load('Games.csv'))[1];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    parseGame({ ...base, gameType: 'Playoffs' });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('parses people with date-only birthdates', async () => {
    const people = (await load('Players.csv')).map(parsePerson);
    expect(people[0]).toEqual({ personId: 76001, firstName: 'Bob', lastName: 'McAdoo', birthdate: '1951-09-25' });
    expect(people[1].birthdate).toBe('1974-02-07');
    expect(people[2].birthdate).toBeNull();
  });

  it('rejects a blank, malformed or impossible game date', async () => {
    const base = (await load('Games.csv'))[0];
    for (const bad of ['', '   ', '12/05/1972', '1972-13-05', '1972-02-30', 'not a date']) {
      expect(() => parseGame({ ...base, gameDateTimeEst: bad })).toThrow(KaggleRowError);
    }
    try { parseGame({ ...base, gameDateTimeEst: '' }); expect.unreachable(); } catch (e) {
      expect(e).toMatchObject({ file: 'Games.csv', field: 'gameDateTimeEst', value: '' });
    }
    expect(parseGame({ ...base, gameDateTimeEst: '1972-12-05' })?.gameDate).toBe('1972-12-05');
    expect(parseGame({ ...base, gameDateTimeEst: ' 1972-12-05 20:00:00 ' })?.gameDate).toBe('1972-12-05');
  });

  it('names missing columns', () => {
    expect(() => assertHeaders('Games.csv', ['gameId'], ['gameId', 'gameDate']))
      .toThrow('Missing columns in Games.csv: gameDate');
  });

  it('fixture headers satisfy the configured columns', async () => {
    for (const [file, cols] of [['Games.csv', GAMES_COLUMNS], ['PlayerStatistics.csv', PLAYER_STATS_COLUMNS], ['Players.csv', PLAYERS_COLUMNS]] as const) {
      const [r] = await load(file);
      const required = Object.values(cols).filter((v): v is string => !!v);
      expect(() => assertHeaders(file, Object.keys(r), required)).not.toThrow();
    }
  });
});

describe('era mask (STAT_TRACKED_FROM_SEASON)', () => {
  // Every masked cell is 0 in the CSV: the mask must turn "0" into null before the stat existed.
  const zeros = {
    home: '1', points: '10', reboundsTotal: '5', steals: '0', blocks: '0', reboundsOffensive: '0',
    reboundsDefensive: '0', turnovers: '0', threePointersMade: '0', threePointersAttempted: '0', plusMinusPoints: '0',
  };
  // Regular-season id for a season start year: 2YYNNNNN.
  const idFor = (season: number) => String(20000000 + (season % 100) * 100000 + 1);
  const parse = (season: number) => parsePlayerGame({ ...zeros, gameId: idFor(season), personId: '1' });

  it('has the agreed boundaries', () => {
    expect(STAT_TRACKED_FROM_SEASON).toEqual({
      steals: 1973, blocks: 1973, offReb: 1973, defReb: 1973, turnovers: 1977,
      fg3Made: 1979, fg3Attempted: 1979, plusMinus: 1996,
    });
  });

  it('steals, blocks and the rebound split: null in 1972, recorded from 1973', () => {
    expect(parse(1972)).toMatchObject({ steals: null, blocks: null, offReb: null, defReb: null });
    expect(parse(1973)).toMatchObject({ steals: 0, blocks: 0, offReb: 0, defReb: 0 });
  });

  it('turnovers: null in 1976, recorded from 1977', () => {
    expect(parse(1976).turnovers).toBeNull();
    expect(parse(1977).turnovers).toBe(0);
  });

  it('3-pointers: null in 1978, recorded from 1979', () => {
    expect(parse(1978)).toMatchObject({ fg3Made: null, fg3Attempted: null });
    expect(parse(1979)).toMatchObject({ fg3Made: 0, fg3Attempted: 0 });
  });

  it('plus-minus: null in 1995, recorded from 1996', () => {
    expect(parse(1995).plusMinus).toBeNull();
    expect(parse(1996).plusMinus).toBe(0);
    expect(parse(2005).plusMinus).toBe(0);
  });

  it('never masks total rebounds or points', () => {
    expect(parse(1950)).toMatchObject({ rebounds: 5, points: 10 });
  });

  it('keeps a blank cell null after the stat existed', () => {
    expect(parsePlayerGame({ ...zeros, steals: '', gameId: idFor(1985), personId: '1' }).steals).toBeNull();
  });
});

describe('tallyRawCells', () => {
  it('counts blank, zero and non-zero raw cells per season, before the era mask', () => {
    const tally: RawCellTally = {};
    const row = (o: Record<string, string>) => ({ steals: '', blocks: '0', turnovers: '3', reboundsOffensive: '0', threePointersAttempted: '', numMinutes: '34.5', ...o });
    tallyRawCells(tally, row({}), 27200001);
    tallyRawCells(tally, row({ steals: '0', blocks: '2' }), 27200002);
    tallyRawCells(tally, row({ steals: 'x' }), 27200003);
    tallyRawCells(tally, row({}), 28600001); // 1986: outside 1970-1985
    tallyRawCells(tally, row({}), 26900001); // 1969: outside
    expect(Object.keys(tally)).toEqual(['1972']);
    expect(tally[1972].steals).toEqual({ blank: 2, zero: 1, nonZero: 0 });
    expect(tally[1972].blocks).toEqual({ blank: 0, zero: 2, nonZero: 1 });
    expect(tally[1972].turnovers).toEqual({ blank: 0, zero: 0, nonZero: 3 });
    expect(tally[1972].offReb).toEqual({ blank: 0, zero: 3, nonZero: 0 });
    expect(tally[1972].fg3Attempted).toEqual({ blank: 3, zero: 0, nonZero: 0 });
    expect(tally[1972].minutes).toEqual({ blank: 0, zero: 0, nonZero: 3 });
  });
});
