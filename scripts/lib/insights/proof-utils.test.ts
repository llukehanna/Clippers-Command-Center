import { describe, it, expect } from 'vitest';
import {
  makeInsightKey,
  isReportableLeagueRank,
  MIN_LEAGUE_TEAMS,
  paramsRecord,
  positionalParams,
  proofStillHolds,
  ordinal,
  rankPercentile,
  highestThreshold,
} from './proof-utils';

const base = {
  category: 'streak' as const,
  team_id: '13',
  player_id: '42',
  game_id: null,
  season_id: 2026,
};

describe('makeInsightKey', () => {
  it('is stable for the same identity', () => {
    expect(makeInsightKey(base, 'scoring_streak_20')).toBe(makeInsightKey({ ...base }, 'scoring_streak_20'));
  });

  it('differs by category, entity, season and metric', () => {
    const k = makeInsightKey(base, 'scoring_streak_20');
    expect(makeInsightKey({ ...base, category: 'milestone' }, 'scoring_streak_20')).not.toBe(k);
    expect(makeInsightKey({ ...base, player_id: '43' }, 'scoring_streak_20')).not.toBe(k);
    expect(makeInsightKey({ ...base, season_id: 2025 }, 'scoring_streak_20')).not.toBe(k);
    expect(makeInsightKey(base, 'hot_shooting_streak')).not.toBe(k);
  });
});

describe('isReportableLeagueRank', () => {
  it('requires enough teams', () => {
    expect(isReportableLeagueRank(1, MIN_LEAGUE_TEAMS - 1)).toBe(false);
    expect(isReportableLeagueRank(1, MIN_LEAGUE_TEAMS)).toBe(true);
  });

  it('rejects out-of-range ranks and respects topN', () => {
    expect(isReportableLeagueRank(0, 30)).toBe(false);
    expect(isReportableLeagueRank(31, 30)).toBe(false);
    expect(isReportableLeagueRank(NaN, 30)).toBe(false);
    expect(isReportableLeagueRank(5, 30, 5)).toBe(true);
    expect(isReportableLeagueRank(6, 30, 5)).toBe(false);
  });
});

describe('proof params', () => {
  it('round-trips positional params', () => {
    const rec = paramsRecord([2025, '13', 5]);
    expect(rec).toEqual({ $1: 2025, $2: '13', $3: 5 });
    expect(positionalParams(rec)).toEqual([2025, '13', 5]);
  });

  it('treats named (legacy) params as unverifiable', () => {
    expect(positionalParams({ player_id: '1' })).toBeNull();
    expect(positionalParams([1, 2])).toBeNull();
    expect(positionalParams({ $1: 1, $3: 3 })).toBeNull(); // gap
  });
});

describe('proofStillHolds', () => {
  it('matches stored rows regardless of key order', () => {
    expect(proofStillHolds([{ a: 1, b: 'x' }], [{ b: 'x', a: 1 }, { a: 2, b: 'y' }])).toBe(true);
  });
  it('fails when a stored row is gone or changed', () => {
    expect(proofStillHolds([{ a: 1 }], [{ a: 2 }])).toBe(false);
    expect(proofStillHolds([{ a: 1 }, { a: 3 }], [{ a: 1 }])).toBe(false);
  });
});

describe('formatting helpers', () => {
  it('ordinal', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal)).toEqual(
      ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st']
    );
  });
  it('rankPercentile', () => {
    expect(rankPercentile(1, 30)).toBe(100);
    expect(rankPercentile(30, 30)).toBe(0);
    expect(rankPercentile(1, 1)).toBe(100);
  });
  it('highestThreshold', () => {
    expect(highestThreshold(1300, [500, 1000, 1500])).toBe(1000);
    expect(highestThreshold(400, [500, 1000])).toBeNull();
  });
});
