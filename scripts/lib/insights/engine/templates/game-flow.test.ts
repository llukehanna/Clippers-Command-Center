import { describe, it, expect } from 'vitest';
import { buildEvidence } from '../evidence';
import { makeCtx, makeFact } from '../__fixtures__/facts';
import { expectCleanPhrasings, fr, rcFor, say } from '../__fixtures__/sweep';
import { blockedFrames, frameFact, PBP_RECORD_FRAMES, type Question } from '../framer';
import { pbpRecordsComplete, PBP_MISSING_SQL } from '../pbp-coverage';
import { seasonStartDate } from '../records';
import { FLOW_SQL, FLOW_STATS, refsFor } from '../references';
import type { Frame } from '../../../../../src/lib/insights/types';
import type { ProofQuery } from '../types';

const flow = (stat: keyof typeof FLOW_STATS, value: number, result: 'W' | 'L' = 'W', date = '2025-11-28') => makeFact({
  kind: 'game_flow', surface: 'postgame', subject: { type: 'team', id: '1', name: 'Clippers' }, stat, value,
  window: { type: 'game', game_id: '500', season_id: 2025 }, gameId: '500',
  context: { date, opponent_id: '2', home: true, result },
  data: { thing: FLOW_STATS[stat].thing(value), best: FLOW_STATS[stat].best, by: FLOW_STATS[stat].by, lead: 8, deficit: 22, margin_series: [[0, 0], [1440, -22], [2880, 4]] },
});

describe('game flow templates', () => {
  const post = rcFor('postgame');
  it('words a comeback against play-by-play records', () => {
    expect(say(flow('comeback', 22), fr('records_best', { records_label: '2019-20', records_seasons: 7 }), post)).toEqual({
      headline: 'Clippers erased a 22-point deficit to beat the Warriors', context: 'Largest comeback win by the Clippers since 2019-20',
    });
    expect(say(flow('comeback', 22), fr('records_best', { records_label: '2019-20', records_seasons: 7 }), post, 1).context)
      .toBe('Largest comeback win by the Clippers in 7 seasons of records');
    expect(say(flow('blown_lead', 18, 'L'), fr('none'), post).headline).toBe('Clippers lost to the Warriors after leading by 18');
    expect(say(flow('best_run', 16), fr('first_since', { since_date: '2022-01-05' }), post).context)
      .toBe('First 16-0 run by the Clippers since Jan 2022');
  });
  it('names the condition each stat\'s reference set filters on', () => {
    const records = fr('records_best', { records_label: '2019-20' });
    const since = fr('first_since', { since_date: '2025-03-05' });
    expect(say(flow('largest_lead', 22), since, post).context).toBe('First 22-point lead in a win by the Clippers since Mar 2025');
    expect(say(flow('largest_lead', 22), records, post).context).toBe('Largest lead in a win by the Clippers since 2019-20');
    expect(say(flow('blown_lead', 18, 'L'), since, post).context).toBe('First blown 18-point lead by the Clippers since Mar 2025');
    expect(say(flow('comeback', 22), since, post).context).toBe('First 22-point comeback by the Clippers since Mar 2025');
  });
  it('does not credit a both-teams stat to the Clippers alone', () => {
    expect(say(flow('lead_changes', 24), fr('records_best', { records_label: '2019-20' }), post).context).toBe('Most lead changes in a Clippers game since 2019-20');
    expect(say(flow('lead_changes', 24), fr('first_since', { since_date: '2025-03-05' }), post).context).toBe('First 24 lead changes in a Clippers game since Mar 2025');
  });
  it('words the season through the frozen postgame phrase, never "this season"', () => {
    expect(say(flow('comeback', 22), fr('season_high'), post).context).toBe('The largest comeback win by the Clippers so far in 2025-26');
  });
  it('draws the margin', () => {
    expect(buildEvidence(flow('comeback', 22), fr('records_best'))).toEqual({ type: 'margin_spark', series: [[0, 0], [1440, -22], [2880, 4]] });
  });
  it('renders clean for every stat and frame', () => {
    for (const [stat, def] of Object.entries(FLOW_STATS)) {
      expectCleanPhrasings(flow(stat as keyof typeof FLOW_STATS, def.floor + 2, def.when === 'L' ? 'L' : 'W'));
    }
  });
});

describe('game flow references', () => {
  it('bounds an older postgame fact at its own date, and a same-day fact at as-of (R2)', () => {
    const ctx = makeCtx({ asOf: '2026-02-25' });
    const old = refsFor(flow('comeback', 22, 'W', '2025-11-28'), ctx)!;
    expect(old.group!.params).toEqual(['1', 2019, '2025-11-28']);
    const today = refsFor(flow('comeback', 22, 'W', '2026-02-25'), ctx)!;
    expect(today.group!.params[2]).toBe('2026-02-25');
  });
  it('is framed against play-by-play records and absent without them', () => {
    const refs = refsFor(flow('best_run', 16), makeCtx())!;
    expect(refs).toMatchObject({ start: { season_id: 2019 }, league: null, subject: null, ordinal: true, betterIsHigher: true });
    expect(refsFor(flow('best_run', 16), makeCtx({ pbpRecordsStart: null }))).toBeNull();
  });
  it('uses one expression for the fact column and its reference set', () => {
    for (const [key, stat] of Object.entries(FLOW_STATS)) {
      expect(FLOW_SQL).toContain(`(${stat.expr('$2')})::int AS ${key}`);
      expect(refsFor(flow(key as keyof typeof FLOW_STATS, stat.floor), makeCtx())!.group!.sql).toContain(`(${stat.expr('$1')})::float8`);
    }
  });
});

describe('seasonStartDate', () => {
  it('starts 2020-21 after the bubble, everything else Aug 1', () => {
    expect(seasonStartDate(2020)).toBe('2020-11-01');
    expect(seasonStartDate(2019)).toBe('2019-08-01');
    expect(seasonStartDate(2021)).toBe('2021-08-01');
  });
});

describe('play-by-play record gate (R7)', () => {
  const frame = (type: Frame['type']): Frame => ({ type, strength: type === 'longest_since' ? 0.5 : 0.9, who: 'group', text: '', proof_rows: [] });
  const emits = (type: Frame['type']): Question => ({ name: type, build: () => ({ sql: 'SELECT 1', params: [] }), interpret: () => frame(type) });

  it('blocks exactly the record frames, only for play-by-play kinds, only when incomplete', () => {
    expect([...PBP_RECORD_FRAMES].sort()).toEqual(
      ['clippers_rank', 'first_since', 'joins_company', 'nth_time', 'only_one', 'records_best', 'season_high']);
    expect(blockedFrames(flow('comeback', 22), false)).toBe(PBP_RECORD_FRAMES);
    expect(blockedFrames(flow('comeback', 22), true)).toBeUndefined();
    expect(blockedFrames(makeFact({ kind: 'player_game_stat' }), false)).toBeUndefined();
  });
  it('drops a blocked record frame and keeps the strongest of the rest', async () => {
    const run = async () => [];
    const qs = [emits('records_best'), { ...emits('season_high'), name: 'sh' }, { ...emits('longest_since'), name: 'ls' }];
    const open = await frameFact(flow('comeback', 22), makeCtx(), run, qs);
    expect(open.frame.type).toBe('records_best');
    const gated = await frameFact(flow('comeback', 22), makeCtx(), run, qs, blockedFrames(flow('comeback', 22), false));
    expect(gated.frame.type).toBe('longest_since'); // a non-gated frame survives
    const gatedLow = await frameFact(flow('comeback', 22), makeCtx(), run, qs.slice(0, 2), blockedFrames(flow('comeback', 22), false));
    expect(gatedLow.frame.type).toBe('none');
    const onlyRecord = await frameFact(flow('comeback', 22), makeCtx(), run, [emits('first_since')], PBP_RECORD_FRAMES);
    expect(onlyRecord.frame.type).toBe('none');
  });
  it('asks once per date bound, per context, and counts only games before the fact date', async () => {
    const calls: ProofQuery[] = [];
    const run = async (q: ProofQuery) => { calls.push(q); return [{ missing: 0 }]; };
    const ctx = makeCtx();
    expect(await pbpRecordsComplete(ctx, '2025-11-28', run)).toBe(true);
    expect(await pbpRecordsComplete(ctx, '2025-11-28', run)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toBe(PBP_MISSING_SQL);
    expect(calls[0].params).toEqual(['1', 2019, '2025-11-28', '2026-02-25']);
    await pbpRecordsComplete(ctx, '2025-12-01', run);
    expect(calls).toHaveLength(2);
    await pbpRecordsComplete(makeCtx(), '2025-11-28', run);
    expect(calls).toHaveLength(3);
  });
  it('is incomplete when a game is missing, and without play-by-play records', async () => {
    expect(await pbpRecordsComplete(makeCtx(), '2025-11-28', async () => [{ missing: 1 }])).toBe(false);
    expect(await pbpRecordsComplete(makeCtx({ pbpRecordsStart: null }), '2025-11-28', async () => { throw new Error('no query'); })).toBe(false);
  });
});
