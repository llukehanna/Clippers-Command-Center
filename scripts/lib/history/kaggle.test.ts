import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import {
  streamCsv, assertHeaders, parseGame, parsePlayerGame, parsePerson, KaggleRowError,
  seasonIdOfGame, minutesToClock, GAMES_COLUMNS, PLAYER_STATS_COLUMNS, PLAYERS_COLUMNS,
} from './kaggle.js';

const FX = path.join(__dirname, '..', '__fixtures__', 'kaggle');

async function load(file: string) {
  const rows: Record<string, string>[] = [];
  for await (const r of streamCsv(path.join(FX, file))) rows.push(r);
  return rows;
}

describe('kaggle readers', () => {
  it('keeps blank cells null and real zeros zero', async () => {
    const [p] = (await load('PlayerStatistics.csv')).map(parsePlayerGame);
    expect(p.steals).toBeNull();
    expect(p.blocks).toBe(0);
    expect(p.turnovers).toBeNull();
    expect(p.rebounds).toBe(10);
    expect(p.isHome).toBe(true);
    expect(p.starter).toBeNull();
    expect(p.minutes).toBe('34:30');
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
