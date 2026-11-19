// Frames that stay true: ties (FW-1), league ranks at the buzzer (FW-2), late joiners' own frames (FW-6).
import { describe, it, expect } from 'vitest';
import { LATE_JOINERS_SQL, lateJoinerGuard, refsFor } from './references';
import {
  careerHigh, clippersRank, groupFirstSince, groupSeasonHigh, leagueRank, nthTime, subjectFirstSince, subjectSeasonHigh,
} from './questions';
import { makeCtx, makeFact } from './__fixtures__/facts';
import type { EngineContext } from './types';

const ctx = makeCtx();
const night = makeFact({
  kind: 'player_game_stat', surface: 'postgame', stat: 'pts', value: 55,
  window: { type: 'game', game_id: '500', season_id: 2025 },
  context: { date: '2025-11-28', opponent_id: '2', opponent_name: 'Golden State Warriors', home: true, result: 'W' },
  gameId: '500',
  data: { thing: '55-point game', best: 'most points in a game', by: 'by a Clipper', label: 'scoring', unit: 'points' },
});
const team = {
  ...night, kind: 'team_game_stat' as const, stat: 'team_pts', value: 132, subject: { type: 'team' as const, id: '1', name: 'Clippers' },
};
const combo = { ...night, kind: 'player_combo' as const, stat: 'triple_double', value: 1 };

describe('ties never read as a sole rank or best (FW-1)', () => {
  const nextDay = makeCtx({ asOf: '2025-11-29' });

  it('clippers_rank counts equal values other than the subject\'s own row, and drops the frame on a tie', () => {
    const q = clippersRank.build(night, ctx)!;
    expect(q.sql).toContain('(COUNT(*) FILTER (WHERE value = $4::float8))::int AS ties');
    expect(q.sql).toContain('WHERE NOT (game_id = $5::text AND subject_id = $6::text)');
    expect(q.params.slice(3)).toEqual([55, '500', night.subject.id]);
    expect(clippersRank.interpret([{ rank: 4, ties: 0, total: 1199 }], night, ctx)).toMatchObject({ type: 'clippers_rank', rank: 4 });
    expect(clippersRank.interpret([{ rank: 4, ties: 2, total: 1199 }], night, ctx)).toBeNull();
    // a result without the ties column never claims a rank
    expect(clippersRank.interpret([{ rank: 4, total: 1199 }], night, ctx)).toBeNull();
  });

  it('league_rank excludes the fact\'s own row from the ties (it is in the league set), and drops the frame on a tie', () => {
    const q = leagueRank.build(night, nextDay)!;
    expect(q.sql).toContain('(COUNT(*) FILTER (WHERE value = $3::float8 AND NOT (game_id = $4::text AND subject_id = $5::text)))::int AS ties');
    expect(q.sql).toContain('COUNT(*)::int AS total');
    expect(q.params.slice(2)).toEqual([55, '500', night.subject.id]);
    expect(leagueRank.interpret([{ rank: 1, ties: 0, total: 18000 }], night, nextDay)).toMatchObject({ type: 'league_rank', rank: 1 });
    expect(leagueRank.interpret([{ rank: 1, ties: 1, total: 18000 }], night, nextDay)).toBeNull();
    expect(leagueRank.interpret([{ rank: 4, ties: 8, total: 18000 }], night, nextDay)).toBeNull();
    expect(leagueRank.interpret([{ rank: 1, total: 18000 }], night, nextDay)).toBeNull();
    // no game row to exclude: no league rank
    expect(leagueRank.build({ ...night, window: { type: 'game' } }, nextDay)).toBeNull();
  });

  it('group and subject season highs are strict: a tie with another game keeps no frame', () => {
    expect(groupSeasonHigh.interpret([{ best: 55, games: 59 }], night, ctx)).toBeNull();
    expect(groupSeasonHigh.interpret([{ best: 54, games: 59 }], night, ctx)).toMatchObject({ type: 'season_high', who: 'group' });
    expect(subjectSeasonHigh.interpret([{ best: 55, games: 20 }], night, ctx)).toBeNull();
    expect(subjectSeasonHigh.interpret([{ best: 54, games: 20 }], night, ctx)).toMatchObject({ type: 'season_high', who: 'subject' });
    // lower is better: a tie at the minimum is not "the fewest"
    const low = { ...team, stat: 'opp_pts_low', value: 88 };
    expect(groupSeasonHigh.interpret([{ best: 88, games: 10 }], low, ctx)).toBeNull();
    expect(groupSeasonHigh.interpret([{ best: 90, games: 10 }], low, ctx)).toMatchObject({ type: 'season_high' });
  });

  it('records_best never fires on a tie: an earlier equal game makes it first_since (the query is >=)', () => {
    expect(groupFirstSince.build(night, ctx)!.sql).toContain('value >= $4::float8');
    expect(groupFirstSince.interpret([{ subject_id: '7', subject_name: 'Paul George', value: 55, game_id: '400', game_date: '2023-01-05', games_since: 300 }], night, ctx))
      .toMatchObject({ type: 'first_since', since_date: '2023-01-05' });
    // a same-game teammate tying it: no frame at all
    expect(groupFirstSince.interpret([{ subject_id: '2', subject_name: 'Big Clipper', value: 55, game_id: '500', game_date: '2025-11-28' }], night, ctx)).toBeNull();
    expect(groupFirstSince.interpret([], night, ctx)).toMatchObject({ type: 'records_best' });
  });
});

describe('league references wait for the night\'s other games (FW-2)', () => {
  const at = (asOf: string) => makeCtx({ asOf });

  it('a postgame fact gets league refs only on a later LA day than its game', () => {
    expect(refsFor(night, at('2025-11-28'))!.league).toBeNull();
    expect(leagueRank.build(night, at('2025-11-28'))).toBeNull();
    expect(refsFor(night, at('2025-11-29'))!.league).not.toBeNull();
    expect(refsFor(team, at('2025-11-28'))!.league).toBeNull();
    expect(refsFor(team, at('2025-11-29'))!.league).not.toBeNull();
  });

  it('other surfaces keep league refs on the day itself', () => {
    const best = { ...night, kind: 'season_best' as const, surface: 'player' as const };
    expect(refsFor(best, at('2025-11-28'))!.league).not.toBeNull();
  });
});

describe('late joiners lose their own (subject) frames while league data may be incomplete (FW-6)', () => {
  const incomplete = (over: Partial<EngineContext> = {}) => makeCtx({ league: { complete: false, reason: 'x' }, ...over });

  it('no guard while the league is complete and the fact is in the stats season', () => {
    expect(lateJoinerGuard(night, ctx)).toBeNull();
    expect(refsFor(night, ctx)!.subject).not.toBeNull();
  });

  it('guards player stat, combo and season-best facts by season and date; never team facts', () => {
    expect(lateJoinerGuard(night, incomplete())).toEqual({ key: '2025:2025-11-28', seasonId: 2025, date: '2025-11-28' });
    // complete league, but outside the stats season: coverage unknown, so guarded
    expect(lateJoinerGuard({ ...night, seasonId: 2024 }, ctx)).toEqual({ key: '2024:2025-11-28', seasonId: 2024, date: '2025-11-28' });
    expect(lateJoinerGuard(combo, incomplete())).not.toBeNull();
    expect(lateJoinerGuard({ ...night, kind: 'season_best', surface: 'player' }, incomplete())).not.toBeNull();
    expect(lateJoinerGuard(team, incomplete())).toBeNull();
  });

  it('drops the subject set for a late joiner, keeps it for others, and drops it while the set is unloaded', () => {
    const late = incomplete({ lateJoiners: new Map([['2025:2025-11-28', new Set([night.subject.id])]]) });
    expect(refsFor(night, late)!.subject).toBeNull();
    for (const q of [careerHigh, subjectFirstSince, subjectSeasonHigh, nthTime]) expect(q.build(night, late), q.name).toBeNull();
    expect(refsFor(night, late)!.group).not.toBeNull();
    expect(refsFor(combo, late)!.subject).toBeNull();
    const others = incomplete({ lateJoiners: new Map([['2025:2025-11-28', new Set(['77'])]]) });
    expect(refsFor(night, others)!.subject).not.toBeNull();
    expect(refsFor(combo, others)!.subject).not.toBeNull();
    expect(careerHigh.build(night, others)).not.toBeNull();
    // not loaded: the safe default is no subject frames
    expect(refsFor(night, incomplete())!.subject).toBeNull();
  });

  it('the late-joiner query binds and uses LAC, the season and the date', () => {
    for (const n of [1, 2, 3]) expect(LATE_JOINERS_SQL).toContain(`$${n}::`);
    expect(LATE_JOINERS_SQL).not.toContain('$4');
    expect(LATE_JOINERS_SQL).toContain('g2.game_date <= $3::date');
  });
});
