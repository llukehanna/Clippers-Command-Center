import { describe, it, expect } from 'vitest';
import { makeInsightKey, isReportableLeagueRank, MIN_LEAGUE_TEAMS } from './proof-utils';

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
