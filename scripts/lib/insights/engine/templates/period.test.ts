import { describe, it, expect } from 'vitest';
import { makeCtx, makeFact } from '../__fixtures__/facts';
import { expectCleanPhrasings, fr, rcFor, say } from '../__fixtures__/sweep';
import { blockedFrames, PBP_KINDS, PBP_RECORD_FRAMES } from '../framer';
import {
  CLUTCH_SQL, clippersClutchRef, clippersHalfRef, clippersQuarterRef, clippersTeamQuarterRef, PLAYER_PERIODS_SQL, refsFor, TEAM_PERIODS_SQL,
} from '../references';
import { QUESTIONS_BY_KIND } from '../questions';
import { TEMPLATES } from './index';

const base = { surface: 'postgame' as const, gameId: '500', context: { date: '2025-11-28', opponent_id: '2', home: true, result: 'W' as const } };
const quarter = makeFact({ ...base, kind: 'player_period_stat', stat: 'q_pts', value: 18,
  window: { type: 'period', game_id: '500', season_id: 2025, period: 4 },
  data: { thing: '18-point quarter', best: 'most points in a quarter', by: 'by a Clipper', unit: 'points' } });
const half = makeFact({ ...base, kind: 'player_period_stat', stat: 'half_pts', value: 27, window: { type: 'half', game_id: '500', season_id: 2025, period: 2 },
  data: { thing: '27-point half', best: 'most points in a half', by: 'by a Clipper', unit: 'points' } });
const teamQ = makeFact({ ...base, kind: 'team_period_stat', subject: { type: 'team', id: '1', name: 'Clippers' }, stat: 'team_q_pts', value: 44,
  window: { type: 'period', game_id: '500', season_id: 2025, period: 3 },
  data: { thing: '44-point quarter', best: 'most points in a quarter', by: 'by the Clippers' } });
const clutch = makeFact({ ...base, kind: 'clutch', stat: 'clutch_pts', value: 11, window: { type: 'game', game_id: '500', season_id: 2025 },
  data: { thing: '11-point clutch performance', best: 'most clutch points in a game', by: 'by a Clipper', fgm: 4, fga: 6, ftm: 2, fta: 2 } });
const facts = [quarter, half, teamQ, clutch];

describe('period and clutch templates', () => {
  const post = rcFor('postgame');
  it('words quarters, halves and clutch time', () => {
    expect(say(quarter, fr('records_best', { records_label: '2019-20', records_seasons: 7 }), post)).toEqual({
      headline: 'Star Clipper scored 18 in the 4th quarter vs the Warriors', context: 'Most points in a quarter by a Clipper since 2019-20',
    });
    expect(say(half, fr('none'), post).headline).toBe('Star Clipper scored 27 in the second half vs the Warriors');
    expect(say(teamQ, fr('none'), post, 1).headline).toBe('A 44-point 3rd quarter for the Clippers vs the Warriors');
    expect(say(clutch, fr('none'), post)).toEqual({
      headline: 'Star Clipper scored 11 in clutch time vs the Warriors',
      context: '4-of-6 from the field, 2-of-2 at the line in clutch time',
    });
  });
  it('names the condition each reference set filters on', () => {
    expect(say(clutch, fr('records_best', { records_label: '2019-20' }), post).context).toBe('Most clutch points in a game by a Clipper since 2019-20');
    expect(say(clutch, fr('first_since', { since_date: '2025-03-05' }), post).context).toBe('First 11-point clutch performance by a Clipper since Mar 2025');
    expect(say(half, fr('records_best', { records_label: '2019-20' }), post).context).toBe('Most points in a half by a Clipper since 2019-20');
    expect(say(teamQ, fr('records_best', { records_label: '2019-20' }), post).context).toBe('Most points in a quarter by the Clippers since 2019-20');
  });
  it('words the season through the frozen postgame phrase, never "this season"', () => {
    for (const f of facts) {
      const out = say(f, fr('season_high'), post);
      expect(out.context).toContain('so far in 2025-26');
      expect(out.context).not.toContain('this season');
    }
  });
  it('leaves out clutch shooting parts with no attempts', () => {
    const noFt = makeFact({ ...clutch, data: { ...clutch.data, ftm: 0, fta: 0 } });
    const noFg = makeFact({ ...clutch, data: { ...clutch.data, fgm: 0, fga: 0 } });
    const none = makeFact({ ...clutch, data: { ...clutch.data, fgm: 0, fga: 0, ftm: 0, fta: 0 } });
    expect(say(noFt, fr('none'), post).context).toBe('4-of-6 from the field in clutch time');
    expect(say(noFg, fr('none'), post).context).toBe('2-of-2 at the line in clutch time');
    expect(say(none, fr('none'), post).context).not.toMatch(/0-of-0/);
  });
  it('never calls clutch "the last five minutes" (it includes overtime)', () => {
    for (const frame of [fr('none'), fr('season_high'), fr('records_best', { records_label: '2019-20' })]) {
      const out = say(clutch, frame, post);
      expect(`${out.headline} ${out.context}`).not.toMatch(/last five minutes/i);
    }
  });
  it('renders clean for every frame', () => {
    for (const f of facts) expectCleanPhrasings(f);
  });
  it('is registered: templates, questions and the play-by-play gate', () => {
    for (const k of ['player_period_stat', 'team_period_stat', 'clutch'] as const) {
      expect(TEMPLATES[k]).toBeDefined();
      expect(QUESTIONS_BY_KIND[k].length).toBeGreaterThan(0);
      expect(PBP_KINDS.has(k)).toBe(true);
      expect(blockedFrames(makeFact({ kind: k }), false)).toBe(PBP_RECORD_FRAMES);
      expect(blockedFrames(makeFact({ kind: k }), true)).toBeUndefined();
    }
  });
});

describe('rank frames', () => {
  it('never produces clippers_rank for quarters, halves or clutch (reference rows are player-games, not periods)', () => {
    for (const k of ['player_period_stat', 'team_period_stat', 'clutch'] as const) {
      const names = QUESTIONS_BY_KIND[k].map((q) => q.name);
      expect(names).not.toContain('clippers_rank');
      for (const keep of ['group_company', 'group_first_since', 'group_season_high']) expect(names, `${k} keeps ${keep}`).toContain(keep);
    }
    expect(QUESTIONS_BY_KIND.player_game_stat.map((q) => q.name)).toContain('clippers_rank');
  });
});

describe('period and clutch references', () => {
  const ctx = makeCtx({ asOf: '2026-02-25' });
  it('uses the play-by-play records start and has no subject or league sets', () => {
    for (const f of facts) {
      expect(refsFor(f, ctx)).toMatchObject({ start: { season_id: 2019 }, league: null, subject: null, ordinal: true, betterIsHigher: true });
      expect(refsFor(f, makeCtx({ pbpRecordsStart: null }))).toBeNull();
    }
  });
  it('bounds an older postgame fact at its own date, and a same-day fact at as-of (R2)', () => {
    for (const f of facts) {
      expect(refsFor(f, ctx)!.group!.params).toEqual(['1', 2019, '2025-11-28']);
      const today = makeFact({ ...f, context: { ...f.context, date: '2026-02-25' } });
      expect(refsFor(today, ctx)!.group!.params[2]).toBe('2026-02-25');
    }
  });
  it('bounds seasons by season_id, regular season only', () => {
    for (const ref of [clippersQuarterRef, clippersHalfRef, clippersTeamQuarterRef, clippersClutchRef]) {
      const { sql } = ref('1', { season_id: 2020, label: '2020-21' }, '2026-02-25');
      expect(sql).toContain('g.season_id >= $2::int');
      expect(sql).toContain('g.game_date <= $3::date');
      expect(sql).toContain('NOT g.is_playoffs');
      expect(sql).not.toMatch(/game_date >=/);
    }
  });
  it('filters regulation periods identically in the fact queries and the reference sets', () => {
    const start = { season_id: 2020, label: '2020-21' };
    expect(PLAYER_PERIODS_SQL).toContain('pp.period <= 4');
    expect(TEAM_PERIODS_SQL).toContain('pt.period <= 4');
    expect(clippersQuarterRef('1', start, 'x').sql).toContain('pp.period <= 4');
    expect(clippersHalfRef('1', start, 'x').sql).toContain('pp.period <= 4');
    expect(clippersTeamQuarterRef('1', start, 'x').sql).toContain('pt.period <= 4');
    expect(CLUTCH_SQL).toContain('c.player_id IS NOT NULL');
    expect(clippersClutchRef('1', start, 'x').sql).toContain('c.player_id IS NOT NULL');
  });
});
