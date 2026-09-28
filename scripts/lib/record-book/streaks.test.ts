import { describe, it, expect } from 'vitest';
import { computeStreaks, PLAYER_STREAK_DEFS, TEAM_STREAK_DEFS, type PlayerStreakGame, type TeamStreakGame } from './streaks';

let n = 0;
const g = (entityId: string, teamId: string, pts: number, extra: Partial<PlayerStreakGame> = {}): PlayerStreakGame => ({
  entityId, teamId, gameId: String(++n), gameDate: `2026-01-${String(n).padStart(2, '0')}`,
  pts, reb: 0, ast: 0, stl: 0, blk: 0, fg3m: 0, fgm: 0, fga: 0, ...extra,
});
const scoring20 = PLAYER_STREAK_DEFS.filter((d) => d.key === 'scoring_20');

describe('computeStreaks', () => {
  it('keeps runs at or above the minimum and marks the one that reaches the last game active', () => {
    n = 0;
    const games = [g('1', 'A', 25), g('1', 'A', 22), g('1', 'A', 30), g('1', 'A', 8), g('1', 'A', 21), g('1', 'A', 20), g('1', 'A', 24)];
    const s = computeStreaks(games, scoring20);
    expect(s.map((x) => [x.length, x.isActive, x.startGameId, x.endGameId])).toEqual([[3, false, '1', '3'], [3, true, '5', '7']]);
  });
  it('breaks a streak when the player changes teams', () => {
    n = 0;
    const games = [g('1', 'A', 25), g('1', 'A', 25), g('1', 'B', 25), g('1', 'B', 25), g('1', 'B', 25)];
    const s = computeStreaks(games, scoring20);
    expect(s.map((x) => [x.teamId, x.length])).toEqual([['B', 3]]);
  });
  it('handles several entities independently', () => {
    n = 0;
    const games = [g('1', 'A', 25), g('1', 'A', 25), g('1', 'A', 25), g('2', 'A', 25), g('2', 'A', 25), g('2', 'A', 25), g('2', 'A', 25)];
    expect(computeStreaks(games, scoring20).map((x) => [x.entityId, x.length, x.isActive])).toEqual([['1', 3, true], ['2', 4, true]]);
  });
  it('recognizes double-doubles from any two categories', () => {
    n = 0;
    const dd = PLAYER_STREAK_DEFS.filter((d) => d.key === 'double_double');
    const games = [1, 2, 3, 4].map(() => g('1', 'A', 12, { reb: 11 }));
    games[2] = g('1', 'A', 10, { ast: 10 });
    expect(computeStreaks(games, dd)[0].length).toBe(4);
  });
  it('computes team win and loss streaks', () => {
    const t = (won: boolean, i: number): TeamStreakGame => ({ entityId: '13', teamId: '13', gameId: `t${i}`, gameDate: `2026-02-${String(i).padStart(2, '0')}`, won });
    const games = [true, true, true, false, false, false, false].map(t);
    expect(computeStreaks(games, TEAM_STREAK_DEFS).map((x) => [x.streakKey, x.length, x.isActive])).toEqual([['wins', 3, false], ['losses', 4, true]]);
  });
});
