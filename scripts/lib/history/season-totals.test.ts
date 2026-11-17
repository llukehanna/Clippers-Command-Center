import { describe, it, expect } from 'vitest';
import type { KaggleGame, KagglePlayerGame } from './kaggle.js';
import {
  aggregatePlayerSeasons, aggregateTeamSeasons, leagueAverages, compareFranchiseRecords,
} from './season-totals.js';
import { FRANCHISE_RECORDS } from './franchise-records.js';

const LAC = 1610612746;
const LAL = 1610612747;
const BOS = 1610612738;
const DEN = 1610612743;

const game = (id: number, o: Partial<KaggleGame> = {}): KaggleGame => ({
  nbaGameId: id, seasonId: 1990, gameDate: `1990-11-${String((id % 28) + 1).padStart(2, '0')}`,
  homeFranchiseId: LAC, awayFranchiseId: LAL, homeScore: 100, awayScore: 90, isPlayoffs: false,
  homeCity: 'Los Angeles', homeName: 'Clippers', awayCity: 'Los Angeles', awayName: 'Lakers', ...o,
});

const row = (gameId: number, personId: number, o: Partial<KagglePlayerGame> = {}): KagglePlayerGame => ({
  nbaGameId: gameId, personId, firstName: 'P', lastName: String(personId), isHome: true,
  starter: true, minutes: '30:00', points: 10, rebounds: 5, assists: 2, steals: 1, blocks: 1,
  turnovers: 2, fouls: 3, plusMinus: 0, fgMade: 4, fgAttempted: 8, fg3Made: 1, fg3Attempted: 3,
  ftMade: 1, ftAttempted: 2, offReb: 1, defReb: 4, ...o,
});

describe('aggregatePlayerSeasons', () => {
  it('nulls a season total when any game lacks the stat', () => {
    const games = [game(1), game(2)];
    const rows = [row(1, 7, { steals: 2 }), row(2, 7, { steals: null })];
    const [p] = aggregatePlayerSeasons(games, rows);
    expect(p.steals).toBeNull();
    expect(p.points).toBe(20);
    expect(p.games).toBe(2);
    expect(p.minutes).toBe(60);
  });

  it('nulls gamesStarted when starter is unknown, counts it otherwise', () => {
    const games = [game(1), game(2)];
    expect(aggregatePlayerSeasons(games, [row(1, 7), row(2, 7, { starter: false })])[0].gamesStarted).toBe(1);
    expect(aggregatePlayerSeasons(games, [row(1, 7), row(2, 7, { starter: null })])[0].gamesStarted).toBeNull();
  });

  it('splits a traded player into per-team rows plus TOT', () => {
    const games = [game(1), game(2, { homeFranchiseId: BOS, homeCity: 'Boston', homeName: 'Celtics' })];
    const rows = [row(1, 7), row(2, 7)];
    const out = aggregatePlayerSeasons(games, rows);
    expect(out).toHaveLength(3);
    const tot = out.find((r) => r.nbaFranchiseId === 0)!;
    expect(tot.teamAbbreviation).toBe('TOT');
    expect(tot.games).toBe(2);
    expect(tot.points).toBe(20);
    expect(out.find((r) => r.nbaFranchiseId === LAC)!.teamAbbreviation).toBe('LAC');
    expect(out.find((r) => r.nbaFranchiseId === BOS)!.teamName).toBe('Celtics');
  });

  it('emits no TOT row for a single-team player', () => {
    const out = aggregatePlayerSeasons([game(1)], [row(1, 7)]);
    expect(out.map((r) => r.nbaFranchiseId)).toEqual([LAC]);
  });

  it('leaves DNP rows out of games and totals', () => {
    const games = [game(1), game(2)];
    const rows = [row(1, 7), row(2, 7, { minutes: '0:00', points: 0 })];
    const [p] = aggregatePlayerSeasons(games, rows);
    expect(p.games).toBe(1);
    expect(p.points).toBe(10);
  });

  it('counts a null-minutes row with points as played, with null minutes', () => {
    const [p] = aggregatePlayerSeasons([game(1)], [row(1, 7, { minutes: null })]);
    expect(p.games).toBe(1);
    expect(p.minutes).toBeNull();
  });

  it('separates regular and playoff rows and leaves out play-ins', () => {
    const games = [game(1), game(2, { isPlayoffs: true }), game(52000001)];
    const out = aggregatePlayerSeasons(games, [row(1, 7), row(2, 7), row(52000001, 7)]);
    expect(out.map((r) => r.seasonType).sort()).toEqual(['playoffs', 'regular']);
    expect(out.find((r) => r.seasonType === 'regular')!.games).toBe(1);
  });
});

describe('aggregateTeamSeasons', () => {
  it('counts wins and losses from final scores and excludes play-ins', () => {
    const games = [game(1), game(2, { homeScore: 80 }), game(52000001)];
    const t = aggregateTeamSeasons(games, []);
    const lac = t.find((x) => x.nbaFranchiseId === LAC)!;
    expect(lac).toMatchObject({ wins: 1, losses: 1, games: 2, abbreviation: 'LAC', city: 'Los Angeles', name: 'Clippers' });
    expect(t.find((x) => x.nbaFranchiseId === LAL)).toMatchObject({ wins: 1, losses: 1 });
  });

  it('sums own and opponent player rows', () => {
    const games = [game(1)];
    const rows = [
      row(1, 1, { points: 60 }), row(1, 2, { points: 40 }),
      row(1, 3, { isHome: false, points: 90 }),
    ];
    const lac = aggregateTeamSeasons(games, rows).find((x) => x.nbaFranchiseId === LAC)!;
    expect(lac.points).toBe(100);
    expect(lac.oppPoints).toBe(90);
    expect(lac.offensiveReb).toBe(2);
  });

  it('nulls totals when a game has no player rows or a stat is null', () => {
    const games = [game(1), game(2)];
    const rows = [row(1, 1), row(1, 3, { isHome: false }), row(2, 1, { steals: null }), row(2, 3, { isHome: false })];
    const lac = aggregateTeamSeasons(games, rows).find((x) => x.nbaFranchiseId === LAC)!;
    expect(lac.steals).toBeNull();
    expect(lac.rebounds).toBe(10);
    const sparse = aggregateTeamSeasons(games, [row(1, 1)]).find((x) => x.nbaFranchiseId === LAC)!;
    expect(sparse.rebounds).toBeNull();
    expect(sparse.oppRebounds).toBeNull();
  });

  it('takes team and opponent points from the final scores, not player rows', () => {
    const games = [game(1, { homeScore: 101, awayScore: 99 }), game(2, { homeScore: 90, awayScore: 95 })];
    // Game 1 is a player row short (45 of 101); game 2 has no rows at all.
    const rows = [row(1, 1, { points: 45 }), row(1, 3, { isHome: false, points: 99 })];
    const t = aggregateTeamSeasons(games, rows);
    expect(t.find((x) => x.nbaFranchiseId === LAC)).toMatchObject({ points: 191, oppPoints: 194, rebounds: null });
    expect(t.find((x) => x.nbaFranchiseId === LAL)).toMatchObject({ points: 194, oppPoints: 191 });
  });

  it('sets playoffRound from distinct opponents and wonTitle from the last game', () => {
    const p = (id: number, date: string, away: number, homeScore: number, awayScore: number) =>
      game(id, { isPlayoffs: true, gameDate: date, awayFranchiseId: away, homeScore, awayScore });
    const games = [
      game(1),
      p(10, '1991-04-20', LAL, 100, 90), p(11, '1991-04-22', LAL, 100, 90),
      p(20, '1991-05-10', BOS, 100, 90),
      p(30, '1991-06-01', DEN, 100, 90),
      p(31, '1991-06-03', DEN, 80, 90),
    ];
    const t = aggregateTeamSeasons(games, []);
    const lac = t.find((x) => x.nbaFranchiseId === LAC)!;
    expect(lac.playoffRound).toBe(3);
    expect(lac.wonTitle).toBe(false);
    expect(t.find((x) => x.nbaFranchiseId === DEN)).toMatchObject({ playoffRound: 1, wonTitle: true });
    expect(t.find((x) => x.nbaFranchiseId === BOS)!.wonTitle).toBe(false);
  });

  it('gives playoffRound 0 to a team with no playoff games', () => {
    expect(aggregateTeamSeasons([game(1)], [])[0]).toMatchObject({ playoffRound: 0, wonTitle: false });
  });
});

describe('leagueAverages', () => {
  const twoTeamGame = () => {
    const rows = [
      row(1, 1, { points: 100, turnovers: 10, fgAttempted: 80, ftAttempted: 25, offReb: 10, fgMade: 40, fg3Made: 5, fg3Attempted: 10, ftMade: 15 }),
      row(1, 2, { isHome: false, points: 90, turnovers: 10, fgAttempted: 80, ftAttempted: 25, offReb: 10, fgMade: 40, fg3Made: 5, fg3Attempted: 10, ftMade: 15 }),
    ];
    return aggregateTeamSeasons([game(1)], rows);
  };

  it('computes per-team-game averages, pace and ortg', () => {
    const [l] = leagueAverages(twoTeamGame());
    expect(l).toMatchObject({ seasonId: 1990, teams: 2, games: 1, ppg: 95, tpg: 10, fg3aPerGame: 10 });
    expect(l.fgPct).toBeCloseTo(0.5);
    const poss = 80 + 0.44 * 25 - 10 + 10;
    expect(l.pace).toBeCloseTo(poss);
    expect(l.ortg).toBeCloseTo((100 * 95) / poss);
  });

  it('nulls pace and ortg when turnovers are null', () => {
    const rows = [row(1, 1, { turnovers: null }), row(1, 2, { isHome: false })];
    const [l] = leagueAverages(aggregateTeamSeasons([game(1)], rows));
    expect(l.pace).toBeNull();
    expect(l.ortg).toBeNull();
    expect(l.tpg).toBeNull();
    expect(l.ppg).toBe(95); // from the 100-90 final score
  });
});

describe('compareFranchiseRecords', () => {
  it('reports a W-L mismatch against the official record', () => {
    const rec = FRANCHISE_RECORDS[0];
    const mk = (wins: number, losses: number) => ({ seasonId: rec.seasonId, nbaFranchiseId: LAC, wins, losses }) as never;
    expect(compareFranchiseRecords([mk(rec.wins, rec.losses)]).find((m) => m.seasonId === rec.seasonId)).toBeUndefined();
    expect(compareFranchiseRecords([mk(rec.wins + 1, rec.losses)]).find((m) => m.seasonId === rec.seasonId))
      .toEqual({ seasonId: rec.seasonId, computed: `${rec.wins + 1}-${rec.losses}`, official: `${rec.wins}-${rec.losses}` });
  });

  it('has an official record for every Clippers season 1970-2025', () => {
    expect(FRANCHISE_RECORDS).toHaveLength(56);
    FRANCHISE_RECORDS.forEach((r, i) => expect(r.seasonId).toBe(1970 + i));
    const short = new Map([[1998, 50], [2011, 66], [2019, 72], [2020, 72]]);
    for (const r of FRANCHISE_RECORDS) expect(r.wins + r.losses).toBe(short.get(r.seasonId) ?? 82);
  });
});
