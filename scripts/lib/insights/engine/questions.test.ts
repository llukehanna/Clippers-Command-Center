import { describe, it, expect } from 'vitest';
import { COMBOS, DOUBLE_DOUBLE, TEAM_GAME_STATS, TEAM_LINE_SQL, TENS, refAsOf, refsFor } from './references';
import { FACT_KINDS } from './types';
import {
  careerHigh, clippersRank, groupCompany, groupFirstSince, groupSeasonHigh, leagueRank, milestoneFirstSince,
  nthTime, QUESTIONS_BY_KIND, questionsFor, subjectFirstSince, streakLongestSince, streakSeasonHigh, subjectSeasonHigh, yoyPlayerBest, yoyRecordBest,
} from './questions';
import { makeCtx, makeFact } from './__fixtures__/facts';

const ctx = makeCtx();
const night = makeFact({
  kind: 'player_game_stat', surface: 'postgame', stat: 'pts', value: 55,
  window: { type: 'game', game_id: '500', season_id: 2025 },
  context: { date: '2025-11-28', opponent_id: '2', opponent_name: 'Golden State Warriors', home: true, result: 'W' },
  gameId: '500',
  data: { thing: '55-point game', best: 'most points in a game', by: 'by a Clipper', label: 'scoring', unit: 'points', rank: 1, total: 18000 },
});

describe('refsFor', () => {
  it('builds Clippers, career and league reference sets for a big night', () => {
    const refs = refsFor(night, ctx)!;
    expect(refs.group!.sql).toContain('pb.team_id = $1::bigint');
    expect(refs.group!.sql).toContain('pb.points');
    // R2: a postgame fact older than the as-of reads its references as of the game's date.
    expect(refs.group!.params).toEqual(['1', 2020, '2025-11-28']);
    expect(refs.subject!.params).toEqual(['1', '2025-11-28']);
    expect(refs.league!.params).toEqual([2025, '2025-11-28']);
    expect(refs).toMatchObject({ betterIsHigher: true, ordinal: true, start: { season_id: 2020 } });
  });
  it('drops league refs without complete league data and group refs without records', () => {
    expect(refsFor(night, makeCtx({ league: { complete: false, reason: 'x' } }))!.league).toBeNull();
    expect(refsFor(night, makeCtx({ recordsStart: null }))!.group).toBeNull();
    expect(refsFor(makeFact(), ctx)).toBeNull();
  });
});

describe('game questions', () => {
  it('first_since searches the Clippers before the fact date', () => {
    const q = groupFirstSince.build(night, ctx)!;
    expect(q.sql.startsWith('WITH ref AS (')).toBe(true);
    expect(q.sql).toContain('value >= $4::float8');
    expect(q.sql).toContain('game_date < $5::text');
    expect(q.sql).toContain('game_id = $6::text');
    expect(q.sql).toContain('NOT (game_id = $7::text AND subject_id = $8::text)');
    expect(q.params.slice(3)).toEqual([55, '2025-11-28', '500', '500', night.subject.id]);
    expect(groupFirstSince.interpret([{ game_date: '2021-03-01', subject_name: 'Paul George', value: 56 }], night, ctx))
      .toMatchObject({ type: 'first_since', strength: 0.65, who: 'group', since_date: '2021-03-01', records_label: '2020-21' });
    // a same-game teammate (game_date = fact date) who matched or beat it vetoes the frame
    expect(groupFirstSince.interpret([{ game_date: '2025-11-28', subject_name: 'Teammate', value: 60 }], night, ctx)).toBeNull();
    expect(groupFirstSince.interpret([], night, ctx))
      .toMatchObject({ type: 'records_best', strength: 0.9, records_seasons: 6 });
  });
  it('never frames a fact from before records start', () => {
    const old = { ...night, seasonId: 2019, window: { ...night.window, season_id: 2019 } };
    expect(groupFirstSince.build(old, ctx)).toBeNull();
    expect(groupCompany.build(old, ctx)).toBeNull();
    expect(subjectFirstSince.build(old, ctx)).toBeNull();
    expect(subjectSeasonHigh.build(old, ctx)).toBeNull();
    expect(nthTime.build(old, ctx)).toBeNull();
    expect(groupSeasonHigh.build(old, ctx)).toBeNull();
    const oldStreak = makeFact({ seasonId: 2019 });
    expect(streakSeasonHigh.build(oldStreak, ctx)).toBeNull();
  });
  it('group comparisons exclude only the subject\'s own row, so same-game teammates still count', () => {
    for (const q of [groupSeasonHigh, clippersRank, groupCompany]) {
      const built = q.build(night, ctx)!;
      expect(built.sql).toMatch(/NOT \(game_id = \$\d+::text AND subject_id = \$\d+::text\)/);
      expect(built.sql).not.toContain('game_id <>');
      expect(built.params).toContain(night.subject.id);
    }
    // a teammate's 45 in the same game beats this 40: not a season high
    const forty = { ...night, value: 40 };
    expect(groupSeasonHigh.interpret([{ best: 45, games: 60 }], forty, ctx)).toBeNull();
  });
  it('career_high and group_company only count games strictly before the fact', () => {
    const ch = careerHigh.build(night, ctx)!;
    expect(ch.sql).toContain('FILTER (WHERE game_date < $3::text)');
    expect(ch.sql).not.toContain('game_id <>');
    expect(ch.params).toEqual(['1', '2025-11-28', '2025-11-28']);
    const gc = groupCompany.build(night, ctx)!;
    expect(gc.sql).toContain('game_date < $5::text OR game_id = $6::text');
  });
  it('only_one is for non-ordinal facts; joins_company names the others', () => {
    expect(groupCompany.interpret([], night, ctx)).toBeNull();
    const others = [{ subject_id: '7', subject_name: 'Paul George', value: 56, game_date: '2021-03-01' }];
    expect(groupCompany.interpret(others, night, ctx))
      .toMatchObject({ type: 'joins_company', strength: 0.7, names: ['Paul George'], count: 1 });
    expect(groupCompany.interpret([{ subject_id: '1', subject_name: 'Star Clipper', value: 55, game_date: '2025-01-01' }], night, ctx)).toBeNull();
    expect(groupCompany.interpret([...others, ...others, ...others, ...others], night, ctx)).toBeNull();
  });
  it('career_high needs a career inside the records', () => {
    expect(careerHigh.interpret([{ prev_best: 48, first_season: 2021, games: 300 }], night, ctx))
      .toMatchObject({ type: 'career_high', strength: 1, who: 'subject', prior_value: 48 });
    expect(careerHigh.interpret([{ prev_best: 48, first_season: 2020, games: 300 }], night, ctx)).toBeNull();
    expect(careerHigh.interpret([{ prev_best: 56, first_season: 2021, games: 300 }], night, ctx)).toBeNull();
    expect(careerHigh.interpret([{ prev_best: 20, first_season: 2021, games: 5 }], night, ctx)).toBeNull();
  });
  it('ranks among Clippers, the season and the league', () => {
    expect(clippersRank.interpret([{ rank: 3, total: 1199 }], night, ctx)).toMatchObject({ type: 'clippers_rank', strength: 0.7, rank: 3, total: 1200 });
    expect(clippersRank.interpret([{ rank: 1, total: 1199 }], night, ctx)).toBeNull();
    expect(clippersRank.interpret([{ rank: 11, total: 1199 }], night, ctx)).toBeNull();
    expect(groupSeasonHigh.interpret([{ best: 41, games: 59 }], night, ctx)).toMatchObject({ type: 'season_high', who: 'group' });
    expect(groupSeasonHigh.interpret([{ best: 60, games: 59 }], night, ctx)).toBeNull();
    expect(subjectSeasonHigh.interpret([{ best: 30, games: 2 }], night, ctx)).toBeNull();
    expect(leagueRank.interpret([{ rank: 1, total: 18000 }], night, ctx)).toMatchObject({ type: 'league_rank', strength: 0.85, who: 'league' });
    expect(leagueRank.interpret([{ rank: 1, total: 1500 }], night, ctx)).toBeNull();
    expect(leagueRank.build(night, makeCtx({ league: { complete: false, reason: 'x' } }))).toBeNull();
    expect(nthTime.interpret([{ n: 3 }], night, ctx)).toMatchObject({ type: 'nth_time', strength: 0.4, count: 3 });
    expect(nthTime.interpret([{ n: 1 }], night, ctx)).toBeNull();
  });
  it('subject_first_since: the subject\'s last game at or above the value, floored at records start', () => {
    const q = subjectFirstSince.build(night, ctx)!;
    expect(q.sql.startsWith('WITH ref AS (')).toBe(true);
    expect(q.sql).toContain('value >= $3::float8');
    expect(q.sql).toContain('game_date < $4::text');
    expect(q.sql).toContain('season_id >= $5::int');
    expect(q.params).toEqual(['1', '2025-11-28', 55, '2025-11-28', 2020]);
    expect(subjectFirstSince.interpret([{ game_date: '2021-03-01', value: 56 }], night, ctx))
      .toMatchObject({ type: 'first_since', strength: 0.65, who: 'subject', since_date: '2021-03-01' });
    expect(subjectFirstSince.interpret([{ game_date: '2021-03-01', value: 56 }], night, ctx)!.years).toBeCloseTo(4.7, 1);
    expect(subjectFirstSince.interpret([{ game_date: '2020-10-01', value: 56 }], night, ctx))
      .toMatchObject({ type: 'first_since', strength: 0.8 });
    expect(subjectFirstSince.interpret([], night, ctx)).toBeNull();
  });
});

describe('kind questions', () => {
  const streak = makeFact();
  it('longest_since reads rb_streaks inside the records', () => {
    expect(streakLongestSince.build(streak, ctx)!.params).toEqual(['player', 'scoring_30', '1', 5, '2026-02-13', '2020-08-01', '2026-02-25', streak.subject.id]);
    expect(streakLongestSince.build(streak, ctx)!.sql).toContain('s.end_date <= $7::date');
    // overlapping longer-or-equal streak by another Clipper ends after this one started: no frame
    expect(streakLongestSince.interpret([{ end_date: '2026-02-20' }], streak, ctx)).toBeNull();
    expect(streakLongestSince.interpret([{ end_date: '2021-01-10' }], streak, ctx))
      .toMatchObject({ type: 'longest_since', strength: 0.8, since_date: '2021-01-10' });
    expect(streakLongestSince.interpret([], streak, ctx)).toMatchObject({ type: 'records_best', records_seasons: 6 });
    expect(streakLongestSince.build(streak, makeCtx({ recordsStart: null }))).toBeNull();
  });
  it('season_high for streaks', () => {
    expect(streakSeasonHigh.interpret([{ best: 4, streaks: 2 }], streak, ctx)).toMatchObject({ type: 'season_high', who: 'group' });
    expect(streakSeasonHigh.interpret([{ best: 0, streaks: 0 }], streak, ctx)).toBeNull();
  });
  it('milestone first_since compares completed Clippers seasons', () => {
    const m = makeFact({ kind: 'milestone', stat: 'season_points', value: 1500, keyExtra: '1500', data: { threshold: 1500, step: 2, expr: 'SUM(pb.points)' } });
    expect(milestoneFirstSince.build(m, ctx)!.params).toEqual(['1', 2020, 2025, 1500]);
    expect(milestoneFirstSince.interpret([{ season_id: 2021 }], m, ctx))
      .toMatchObject({ type: 'first_since', since_label: '2021-22', years: 4, strength: 0.65 });
    expect(milestoneFirstSince.interpret([], m, ctx)).toMatchObject({ type: 'records_best', records_seasons: 6 });
  });
  it('YoY: career-best season, or best since a season', () => {
    const rise = makeFact({ kind: 'yoy_change', stat: 'player_ppg', value: 27.5, data: { yoy: 'player', expr: 'AVG(pb.points)' } });
    expect(yoyPlayerBest.interpret([{ season_id: 2021, value: 20.1, first_season: 2021 }, { season_id: 2024, value: 24.3, first_season: 2021 }], rise, ctx))
      .toMatchObject({ type: 'career_high', prior_value: 24.3 });
    expect(yoyPlayerBest.interpret([{ season_id: 2023, value: 28, first_season: 2015 }, { season_id: 2024, value: 21, first_season: 2015 }], rise, ctx))
      .toMatchObject({ type: 'first_since', who: 'subject', since_label: '2023-24', years: 2 });
    expect(yoyPlayerBest.interpret([{ season_id: 2024, value: 21, first_season: 2015 }], rise, ctx)).toBeNull();
    const rec = makeFact({ kind: 'yoy_change', stat: 'record', value: 0.6, data: { yoy: 'record' } });
    const seasons = [{ season_id: 2021, win_pct: 0.55 }, { season_id: 2023, win_pct: 0.62 }];
    expect(yoyRecordBest.interpret(seasons, rec, ctx)).toMatchObject({ type: 'first_since', since_label: '2023-24' });
    expect(yoyRecordBest.interpret(seasons, { ...rec, value: 0.7 }, ctx)).toMatchObject({ type: 'records_best', records_seasons: 6 });
    expect(yoyRecordBest.build({ ...rec, polarity: 'negative' }, ctx)).toBeNull();
  });
  it('maps kinds to their questions', () => {
    expect(questionsFor(night)).toContain(groupFirstSince);
    expect(questionsFor(streak)).toEqual([streakLongestSince, streakSeasonHigh]);
    expect(questionsFor(makeFact({ kind: 'h2h', data: {} }))).toEqual([]);
  });
});

describe('registry', () => {
  it('has questions (possibly none) for every fact kind', () => {
    expect(Object.keys(QUESTIONS_BY_KIND).sort()).toEqual([...FACT_KINDS].sort());
  });
});

describe('refAsOf (R2: postgame references are bounded by the game date)', () => {
  it('uses the fact date for a postgame fact older than the as-of, the as-of otherwise', () => {
    expect(refAsOf(night, ctx)).toBe('2025-11-28');
    expect(refAsOf({ ...night, context: { ...night.context, date: '2026-02-25' } }, ctx)).toBe('2026-02-25');
    expect(refAsOf({ ...night, surface: 'season' }, ctx)).toBe('2026-02-25');
  });
});

describe('postgame references are bounded at the fact date (R2)', () => {
  const combo = {
    ...night, kind: 'player_combo' as const, stat: 'triple_double', value: 1,
    data: { thing: 'triple-double', best: 'triple-double', by: 'by a Clipper', line: '24-12-11' },
  };
  it('player stat refs: older postgame facts stop at their date, a same-day or non-postgame fact at the as-of', () => {
    const same = { ...night, context: { ...night.context, date: '2026-02-25' } };
    expect(refsFor(same, ctx)!.group!.params).toEqual(['1', 2020, '2026-02-25']);
    const live = refsFor({ ...night, surface: 'season' }, ctx)!;
    expect(live.subject!.params).toEqual(['1', '2026-02-25']);
  });
  it('combo refs are non-ordinal 0/1 sets bounded at the fact date', () => {
    const refs = refsFor(combo, ctx)!;
    expect(refs).toMatchObject({ ordinal: false, betterIsHigher: true, league: null, start: { season_id: 2020 } });
    expect(refs.group!.sql).toContain('CASE WHEN');
    expect(refs.group!.params).toEqual(['1', 2020, '2025-11-28']);
    expect(refs.subject!.params).toEqual(['1', '2025-11-28']);
    expect(refsFor({ ...combo, stat: 'nope' }, ctx)).toBeNull();
    expect(refsFor(combo, makeCtx({ recordsStart: null }))!.group).toBeNull();
  });
  it('combo predicates are NULL-safe: a missing steals or blocks cannot void a triple-double', () => {
    expect(TENS.match(/COALESCE\(pb\.\w+ >= 10, FALSE\)::int/g)).toHaveLength(5);
    expect(TENS).not.toMatch(/\(pb\.\w+ >= 10\)::int/);
    for (const c of COMBOS.filter((x) => x.key !== 'triple_double')) expect(c.cond, c.key).toMatch(/^COALESCE\(.*\) AND COALESCE\(.*\)$/);
  });
  it('team stat refs: Clippers group and league sets bounded at the game date (R2); loss margin gets no league set', () => {
    const teamFact = {
      ...night, kind: 'team_game_stat' as const, stat: 'team_pts', value: 132, subject: { type: 'team' as const, id: '1', name: 'Clippers' },
      data: { thing: '132-point game', best: 'most points in a game', by: 'by the Clippers', formatted: '132' },
    };
    const refs = refsFor(teamFact, ctx)!;
    expect(refs).toMatchObject({ subject: null, betterIsHigher: true, ordinal: true, leagueMin: 500, start: { season_id: 2020 } });
    expect(refs.group!.params).toEqual(['1', 2020, '2025-11-28']);
    expect(refs.league!.params).toEqual([2025, '2025-11-28']);
    const same = { ...teamFact, context: { ...teamFact.context, date: '2026-02-25' } };
    expect(refsFor(same, ctx)!.group!.params).toEqual(['1', 2020, '2026-02-25']);
    expect(refsFor({ ...teamFact, stat: 'loss_margin' }, ctx)!.league).toBeNull();
    expect(refsFor({ ...teamFact, stat: 'opp_pts_low' }, ctx)!.betterIsHigher).toBe(false);
    expect(refsFor({ ...teamFact, stat: 'nope' }, ctx)).toBeNull();
    expect(refsFor(teamFact, makeCtx({ league: { complete: false, reason: 'x' } }))!.league).toBeNull();
    expect(Object.keys(TEAM_GAME_STATS).sort()).toEqual(['loss_margin', 'margin', 'opp_pts_low', 'team_fg3m', 'team_fg_pct', 'team_pts']);
  });
  it('the FG% fact column and its reference sets use one display-precision expression', () => {
    const expr = TEAM_GAME_STATS.team_fg_pct.expr;
    expect(expr).toContain('ROUND(');
    expect(TEAM_LINE_SQL).toContain(`${expr} AS team_fg_pct`);
    const teamFact = { ...night, kind: 'team_game_stat' as const, stat: 'team_fg_pct', value: 0.584, subject: { type: 'team' as const, id: '1', name: 'Clippers' } };
    const refs = refsFor(teamFact, ctx)!;
    expect(refs.group!.sql).toContain(expr);
    expect(refs.league!.sql).toContain(expr);
    expect(TEAM_GAME_STATS.team_fg_pct.fmt(0.584)).toBe('58.4%');
  });
  it('a game tied at display precision is first since the tie, not a record; ties do not inflate a rank', () => {
    const tf = { ...night, kind: 'team_game_stat' as const, stat: 'team_fg_pct', value: 0.584, subject: { type: 'team' as const, id: '1', name: 'Clippers' } };
    expect(groupFirstSince.interpret([{ subject_id: '1', subject_name: 'Clippers', value: 0.584, game_id: '400', game_date: '2025-11-01' }], tf, ctx))
      .toMatchObject({ type: 'first_since' });
    expect(groupFirstSince.build(tf, ctx)!.sql).toContain('>=');
    expect(groupSeasonHigh.build(tf, ctx)!.sql).toContain('NOT (game_id =');
    const lr = leagueRank.build(tf, ctx)!.sql;
    expect(lr).toMatch(/value > /);
    expect(lr).not.toMatch(/value >= /);
  });
  it('a team league rank needs its own 500-game sample, not the player 2000', () => {
    const teamFact = { ...night, kind: 'team_game_stat' as const, stat: 'team_pts', value: 132, subject: { type: 'team' as const, id: '1', name: 'Clippers' } };
    expect(leagueRank.interpret([{ rank: 1, total: 600 }], teamFact, ctx)).toMatchObject({ type: 'league_rank', who: 'league' });
    expect(leagueRank.interpret([{ rank: 1, total: 400 }], teamFact, ctx)).toBeNull();
    expect(leagueRank.interpret([{ rank: 1, total: 600 }], night, ctx)).toBeNull();
  });
  it('the double-double predicate is NULL-safe like the combos', () => {
    expect(DOUBLE_DOUBLE.match(/COALESCE\(pb\.\w+ >= 10, FALSE\)::int/g)).toHaveLength(5);
    expect(DOUBLE_DOUBLE).not.toMatch(/\(pb\.\w+ >= 10\)::int/);
    expect(DOUBLE_DOUBLE).toMatch(/>= 2$/);
  });
  it('a combo with nobody earlier is not "the most" (only_one comes from the company question)', () => {
    expect(groupFirstSince.interpret([], combo, ctx)).toBeNull();
  });
  it('every combo key has a definition', () => {
    for (const key of ['pts30_reb10', 'pts30_ast10', 'triple_double']) {
      expect(COMBOS.some((c) => c.key === key), key).toBe(true);
    }
  });
});

describe('league refs only for the checked season (R6)', () => {
  it('suppresses league refs for a fact outside the stats season', () => {
    expect(refsFor(night, ctx)!.league).not.toBeNull();
    expect(refsFor({ ...night, seasonId: 2026 }, ctx)!.league).toBeNull();
    expect(refsFor({ ...night, seasonId: null }, ctx)!.league).not.toBeNull();
  });
});
