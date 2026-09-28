import { describe, it, expect } from 'vitest';
import {
  boxscoreFromV3,
  boxscoresFromSeasonLogs,
  normalizeTricode,
  toIsoMinutes,
  type V3Summary,
  type V3Traditional,
} from './stats-nba';

describe('toIsoMinutes', () => {
  it('converts mm:ss and decimal minutes to the CDN ISO format', () => {
    expect(toIsoMinutes('38:27')).toBe('PT38M27.00S');
    expect(toIsoMinutes('5:03')).toBe('PT05M03.00S');
    expect(toIsoMinutes(38.45)).toBe('PT38M27.00S');
    expect(toIsoMinutes(12)).toBe('PT12M00.00S');
    expect(toIsoMinutes('')).toBe('PT00M00.00S');
    expect(toIsoMinutes(null)).toBe('PT00M00.00S');
  });
});

describe('normalizeTricode', () => {
  it('maps old franchise codes to the current abbreviation', () => {
    expect(normalizeTricode('NJN')).toBe('BKN');
    expect(normalizeTricode('NOH')).toBe('NOP');
    expect(normalizeTricode('LAC')).toBe('LAC');
  });

  it('maps pre-2010 franchises to their current teams', () => {
    expect(normalizeTricode('SEA')).toBe('OKC');
    expect(normalizeTricode('VAN')).toBe('MEM');
    expect(normalizeTricode('CHH')).toBe('CHA');
  });
});

const TEAM_HEADERS = ['TEAM_ID', 'TEAM_ABBREVIATION', 'TEAM_NAME', 'GAME_ID', 'GAME_DATE', 'MATCHUP', 'WL', 'MIN',
  'FGM', 'FGA', 'FG_PCT', 'FG3M', 'FG3A', 'FG3_PCT', 'FTM', 'FTA', 'FT_PCT', 'OREB', 'DREB', 'REB', 'AST', 'STL',
  'BLK', 'TOV', 'PF', 'PTS', 'PLUS_MINUS'];
const PLAYER_HEADERS = ['PLAYER_ID', 'PLAYER_NAME', 'TEAM_ID', 'TEAM_ABBREVIATION', 'TEAM_NAME', 'GAME_ID', 'GAME_DATE',
  'MATCHUP', 'WL', 'MIN', 'FGM', 'FGA', 'FG_PCT', 'FG3M', 'FG3A', 'FG3_PCT', 'FTM', 'FTA', 'FT_PCT', 'OREB', 'DREB',
  'REB', 'AST', 'STL', 'BLK', 'TOV', 'PF', 'PTS', 'PLUS_MINUS'];
const rows = (headers: string[], data: unknown[][]) =>
  data.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] as string | number | null])));

describe('boxscoresFromSeasonLogs', () => {
  const teamRows = rows(TEAM_HEADERS, [
    [1610612746, 'LAC', 'Los Angeles Clippers', '0021000010', '2010-10-27', 'LAC vs. POR', 'L', 240,
      36, 80, 0.45, 5, 15, 0.333, 21, 28, 0.75, 12, 30, 42, 20, 7, 5, 16, 22, 98, -8],
    [1610612757, 'POR', 'Portland Trail Blazers', '0021000010', '2010-10-27', 'POR @ LAC', 'W', 240,
      40, 82, 0.488, 8, 20, 0.4, 18, 22, 0.818, 10, 32, 42, 24, 9, 4, 12, 25, 106, 8],
    [1610612751, 'NJN', 'New Jersey Nets', '0021000011', '2010-10-27', 'NJN @ DET', 'W', 240,
      38, 81, 0.469, 4, 12, 0.333, 21, 25, 0.84, 11, 31, 42, 18, 8, 6, 14, 20, 101, 3],
    [1610612765, 'DET', 'Detroit Pistons', '0021000011', '2010-10-27', 'DET vs. NJN', 'L', 240,
      37, 84, 0.44, 6, 18, 0.333, 18, 24, 0.75, 13, 28, 41, 19, 7, 3, 15, 22, 98, -3],
  ]);
  const playerRows = rows(PLAYER_HEADERS, [
    [201933, 'Blake Griffin', 1610612746, 'LAC', 'Los Angeles Clippers', '0021000010', '2010-10-27', 'LAC vs. POR', 'L',
      37, 8, 14, 0.571, 0, 0, 0, 4, 7, 0.571, 4, 10, 14, 1, 1, 0, 3, 3, 20, -5],
  ]);

  it('builds one final box score per game with home/away from MATCHUP', () => {
    const games = boxscoresFromSeasonLogs(teamRows, playerRows);
    expect(games.map((g) => g.gameId)).toEqual(['0021000010', '0021000011']);

    const lac = games[0];
    expect(lac.gameDate).toBe('2010-10-27');
    expect(lac.homeTricode).toBe('LAC');
    expect(lac.awayTricode).toBe('POR');
    expect(lac.box.game.gameStatus).toBe(3);
    expect(lac.box.game.homeTeam.score).toBe(98);
    expect(lac.box.game.awayTeam.score).toBe(106);
    expect(lac.box.game.homeTeam.statistics.turnovers).toBe(16);
    expect(lac.box.game.homeTeam.statistics.fieldGoalsPercentage).toBe(0.45);

    const [blake] = lac.box.game.homeTeam.players;
    expect(blake).toMatchObject({ personId: 201933, name: 'Blake Griffin', played: '1', starter: '0' });
    expect(blake.statistics).toMatchObject({ minutes: 'PT37M00.00S', points: 20, reboundsTotal: 14, plusMinusPoints: -5 });
    expect(lac.box.game.awayTeam.players).toEqual([]);
  });

  it('normalizes old franchise tricodes', () => {
    const [, nets] = boxscoresFromSeasonLogs(teamRows, playerRows);
    expect(nets.awayTricode).toBe('BKN');
    expect(nets.box.game.awayTeam.teamTricode).toBe('BKN');
  });

  it('rejects a game without exactly one home and one away row', () => {
    expect(() => boxscoresFromSeasonLogs(teamRows.slice(0, 1), [])).toThrow(/unexpected team rows/);
  });
});

describe('boxscoreFromV3', () => {
  const stats = {
    minutes: '38:27', fieldGoalsMade: 3, fieldGoalsAttempted: 9, fieldGoalsPercentage: 0.333, threePointersMade: 1,
    threePointersAttempted: 3, threePointersPercentage: 0.333, freeThrowsMade: 3, freeThrowsAttempted: 4,
    freeThrowsPercentage: 0.75, reboundsOffensive: 1, reboundsDefensive: 13, reboundsTotal: 14, assists: 10, steals: 5,
    blocks: 0, turnovers: 2, foulsPersonal: 3, points: 10, plusMinusPoints: 15,
  };
  const teamStats = { ...stats, minutes: '240:00', points: 110 };
  const summaryTeam = (teamId: number, tricode: string, score: number) => ({
    teamId, teamCity: 'City', teamName: 'Name', teamTricode: tricode, score,
    periods: [{ period: 1, periodType: 'REGULAR', score: 24 }],
    inactives: [{ personId: 999, firstName: 'Hurt', familyName: 'Guy', jerseyNum: '9' }],
  });
  const summary: V3Summary = {
    boxScoreSummary: {
      gameId: '0021000500', gameStatus: 3, gameStatusText: 'Final', period: 4, gameTimeUTC: '2011-01-04T00:00:00Z',
      homeTeam: summaryTeam(1610612753, 'ORL', 110), awayTeam: summaryTeam(1610612740, 'NOH', 90),
    },
  };
  const tradTeam = (teamId: number, tricode: string) => ({
    teamId, teamCity: 'City', teamName: 'Name', teamTricode: tricode, statistics: teamStats,
    players: [
      { personId: 2045, firstName: 'Hedo', familyName: 'Turkoglu', nameI: 'H. Turkoglu', position: 'G', comment: '', jerseyNum: '15', statistics: stats },
      { personId: 3000, firstName: 'Bench', familyName: 'Guy', nameI: 'B. Guy', position: '', comment: 'DNP - Coach', jerseyNum: '', statistics: { ...stats, minutes: '' } },
    ],
  });
  const traditional: V3Traditional = {
    boxScoreTraditional: { gameId: '0021000500', homeTeam: tradTeam(1610612753, 'ORL'), awayTeam: tradTeam(1610612740, 'NOH') },
  };

  it('maps v3 endpoints to the CDN box score shape', () => {
    const { game } = boxscoreFromV3(summary, traditional);
    expect(game).toMatchObject({ gameId: '0021000500', gameStatus: 3, gameTimeUTC: '2011-01-04T00:00:00Z' });
    expect(game.homeTeam).toMatchObject({ teamTricode: 'ORL', score: 110, periods: [{ period: 1, score: 24 }] });
    expect(game.awayTeam.teamTricode).toBe('NOP');
    expect(game.homeTeam.statistics).not.toHaveProperty('minutes');

    const [starter, dnp, inactive] = game.homeTeam.players;
    expect(starter).toMatchObject({ name: 'Hedo Turkoglu', starter: '1', played: '1', jerseyNum: '15' });
    expect(starter.statistics.minutes).toBe('PT38M27.00S');
    expect(dnp).toMatchObject({ starter: '0', played: '0' });
    expect(inactive).toMatchObject({ personId: 999, status: 'INACTIVE', played: '0' });
  });
});
