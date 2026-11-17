import { describe, it, expect } from 'vitest';
import { writeSeasonGames, type Db } from './write.js';
import type { KaggleGame } from './kaggle.js';

const game = (seasonId: number): KaggleGame => ({
  nbaGameId: 22000100, seasonId, gameDate: '2020-12-30',
  homeFranchiseId: 1610612746, awayFranchiseId: 1610612756, homeScore: 120, awayScore: 110,
  isPlayoffs: false, homeCity: 'Los Angeles', homeName: 'Clippers', awayCity: 'Phoenix', awayName: 'Suns',
});

describe('writeSeasonGames guard', () => {
  it('throws for a 2020 game before touching the database', async () => {
    const db = (() => { throw new Error('database touched'); }) as unknown as Db;
    const ids = { teamIdByFranchise: new Map<number, string>(), playerIdByPerson: new Map<number, string>() };
    await expect(writeSeasonGames(db, [game(2020)], [], ids)).rejects.toThrow(/belong to the live pipeline/);
  });
});
