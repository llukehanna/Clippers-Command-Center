import { describe, it, expect, vi } from 'vitest';
import summary from './__fixtures__/espn-summary-401909920.json';
import scoreboard from './__fixtures__/espn-scoreboard-20261102.json';
import {
  athleteNames,
  isoClock,
  nameResolver,
  normalizeName,
  toActions,
  toBoxscore,
  toScoreboard,
  type EspnSummaryJson,
} from './espn-live-client';
import { fallbackFeeds } from './live-deps';
import { fetchBoxscoreConditional, fetchPlayByPlayConditional, fetchScoreboard, NbaHttpError } from './nba-live-client';
import { LAC_TEAM_ID, matchScoreboardGame } from './poll-live-logic';

// TOR 125 @ LAC 118, 2026-11-02 (ESPN 401909920, NBA 0022600171), trimmed.
const NBA_ID = '22600171';
const json = summary as EspnSummaryJson;
const resolve = nameResolver(new Map([
  [normalizeName('Kris Dunn'), 1627739],
  [normalizeName('Brook Lopez'), 201572],
]));

describe('isoClock', () => {
  it('converts ESPN display clocks to the CDN format', () => {
    expect(isoClock('4:32')).toBe('PT04M32.00S');
    expect(isoClock('12:00')).toBe('PT12M00.00S');
    expect(isoClock('45.2')).toBe('PT00M45.20S');
    expect(isoClock('0.0')).toBe('PT00M00.00S');
    expect(isoClock('')).toBe('');
  });
});

describe('normalizeName', () => {
  it('ignores accents, punctuation and suffixes', () => {
    expect(normalizeName('Nikola Jokić')).toBe('nikola jokic');
    expect(normalizeName('Jaren Jackson Jr.')).toBe('jaren jackson');
    expect(normalizeName("De'Aaron Fox")).toBe('de aaron fox');
  });
});

describe('toScoreboard', () => {
  it('gives our game the NBA id and maps ESPN abbreviations to tricodes', () => {
    const { scoreboard: sb, match } = toScoreboard(scoreboard, { nbaGameId: NBA_ID, homeTricode: 'LAC', awayTricode: 'TOR' });
    expect(match).toEqual({ espnEventId: '401909920' });
    const ours = matchScoreboardGame(sb.scoreboard.games, NBA_ID)!;
    expect(ours.gameId).toBe('0022600171');
    expect(ours.gameStatus).toBe(3);
    expect(ours.homeTeam).toMatchObject({ teamId: LAC_TEAM_ID, teamTricode: 'LAC', score: 118, wins: 1, losses: 6 });
    expect(ours.homeTeam.periods.map((p) => p.score)).toEqual([33, 30, 28, 27]);
    const other = sb.scoreboard.games.find((g) => g !== ours)!;
    expect(other.homeTeam.teamTricode).toBe('NYK');
    expect(Number(other.gameId)).toBeNaN(); // never matches an NBA id
  });

  it('reports no match when our game is not on the date', () => {
    expect(toScoreboard(scoreboard, { nbaGameId: NBA_ID, homeTricode: 'LAC', awayTricode: 'DEN' }).match).toBeNull();
  });
});

describe('toActions', () => {
  const actions = toActions(json, resolve, athleteNames(json));

  it('splits a substitution into out + in with unique, ordered action numbers', () => {
    const subs = actions.filter((a) => a.actionType === 'substitution');
    // Strus isn't in the trimmed box score, so his name (and NBA id) is unknown.
    expect(subs.map((a) => [a.subType, a.personId])).toEqual([['out', 1627739], ['in', -4065778]]);
    const nums = actions.map((a) => a.actionNumber);
    expect(new Set(nums).size).toBe(nums.length);
    expect([...nums].sort((x, y) => x - y)).toEqual(nums);
  });

  it('classifies shots, timeouts and period/game ends like the CDN', () => {
    const three = actions.find((a) => a.description.includes('three point'))!;
    expect(three).toMatchObject({ actionType: '3pt', shotResult: 'Made', teamTricode: 'LAC', teamId: LAC_TEAM_ID });
    expect(actions.find((a) => a.description.includes('free throw 1 of 2'))).toMatchObject({ actionType: 'freethrow', shotResult: 'Made' });
    expect(actions.find((a) => a.description.includes('timeout'))).toMatchObject({ actionType: 'timeout', teamId: LAC_TEAM_ID });
    expect(actions.filter((a) => a.actionType === 'period' && a.subType === 'end')).toHaveLength(4);
    expect(actions.at(-1)).toMatchObject({ actionType: 'game', subType: 'end', scoreHome: '118', scoreAway: '125' });
    expect(actions.at(-1)!.timeActual).toBe('2026-11-03T05:56:50Z');
  });

  it('gives an unmatched player a negative id', () => {
    const shooter = actions.find((a) => a.description.includes('three point'))!;
    expect(shooter.personId).toBeLessThan(0); // Kobe Sanders isn't in this test's name map
  });
});

describe('toBoxscore', () => {
  const actions = toActions(json, resolve, athleteNames(json));
  const box = toBoxscore(json, NBA_ID, resolve, actions)!;

  it('builds both teams with header fields from the final summary', () => {
    expect(box.gameId).toBe('0022600171');
    expect(box.gameStatus).toBe(3);
    expect(box.period).toBe(4); // header omits it once final; from play-by-play
    expect(box.homeTeam).toMatchObject({ teamTricode: 'LAC', teamId: LAC_TEAM_ID, score: 118 });
    expect(box.awayTeam).toMatchObject({ teamTricode: 'TOR', score: 125 });
  });

  it('maps ESPN stat lines onto CDN player statistics', () => {
    const dunn = box.homeTeam.players.find((p) => p.name === 'Kris Dunn')!;
    expect(dunn).toMatchObject({ personId: 1627739, starter: '1', played: '1' });
    expect(dunn.statistics).toMatchObject({
      points: 12, fieldGoalsMade: 4, fieldGoalsAttempted: 11, threePointersMade: 1, freeThrowsMade: 3,
      reboundsTotal: 4, assists: 1, plusMinusPoints: -1, minus: 1, plus: 0, minutes: 'PT30M00.00S',
    });
    expect(box.homeTeam.statistics.reboundsTotal).toBe(38); // ESPN team total
  });
});

describe('fallbackFeeds', () => {
  const feeds = (tag: string) => ({
    fetchScoreboard: vi.fn(async () => tag as never),
    fetchPbp: vi.fn(async () => tag as never),
    fetchBox: vi.fn(async () => tag as never),
  });

  // The real fetchers, not mocks: on Nov 4 the fallback never fired because
  // the scoreboard fetcher threw a plain Error while every test here mocked
  // the NbaHttpError the fallback expects.
  it('switches when the real NBA fetchers get a 403 response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Access Denied', { status: 403 })));
    try {
      const espn = feeds('espn');
      const real = { fetchScoreboard, fetchPbp: fetchPlayByPlayConditional, fetchBox: fetchBoxscoreConditional };
      for (const k of ['fetchScoreboard', 'fetchPbp', 'fetchBox'] as const) {
        const f = fallbackFeeds(real, espn);
        expect(await (f[k] as (id?: string) => Promise<unknown>)('0022600186')).toBe('espn');
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('stays on the NBA CDN while it answers', async () => {
    const nba = feeds('nba');
    const espn = feeds('espn');
    const f = fallbackFeeds(nba, espn);
    expect(await f.fetchScoreboard()).toBe('nba');
    expect(espn.fetchScoreboard).not.toHaveBeenCalled();
  });

  it('switches every feed to ESPN after the first 403', async () => {
    const nba = feeds('nba');
    nba.fetchScoreboard.mockRejectedValue(new NbaHttpError(403, '/scoreboard'));
    const espn = feeds('espn');
    const f = fallbackFeeds(nba, espn);
    expect(await f.fetchScoreboard()).toBe('espn');
    expect(await f.fetchPbp('0022600171')).toBe('espn');
    expect(nba.fetchPbp).not.toHaveBeenCalled();
  });

  it('rethrows other failures without switching', async () => {
    const nba = feeds('nba');
    nba.fetchScoreboard.mockRejectedValueOnce(new NbaHttpError(503, '/scoreboard'));
    const f = fallbackFeeds(nba, feeds('espn'));
    await expect(f.fetchScoreboard()).rejects.toThrow('503');
    expect(await f.fetchScoreboard()).toBe('nba');
  });

  it('starts on ESPN when asked to', async () => {
    const nba = feeds('nba');
    const f = fallbackFeeds(nba, feeds('espn'), true);
    expect(await f.fetchBox('x')).toBe('espn');
    expect(nba.fetchBox).not.toHaveBeenCalled();
  });
});
