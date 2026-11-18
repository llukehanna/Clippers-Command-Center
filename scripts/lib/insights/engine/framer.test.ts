import { describe, it, expect, vi } from 'vitest';
import {
  clippersRankStrength, computedFrames, milestoneStrength, pickFrame, rankStrength, sinceStrength,
} from './strength';
import { frameFact, type Question } from './framer';
import { makeCtx, makeFact } from './__fixtures__/facts';
import type { Frame } from '../../../../src/lib/insights/types';

const frame = (type: Frame['type'], strength: number, who: Frame['who'] = 'group'): Frame =>
  ({ type, strength, who, text: '', proof_rows: [] });

describe('strength ladders (spec §2.3)', () => {
  it('scores first_since / longest_since by years', () => {
    expect(sinceStrength(12)).toBe(0.9);
    expect(sinceStrength(10)).toBe(0.9);
    expect(sinceStrength(5)).toBe(0.8);
    expect(sinceStrength(4.99)).toBe(0.65);
    expect(sinceStrength(2)).toBe(0.65);
    expect(sinceStrength(1.9)).toBe(0.5);
  });
  it('scores ranks and milestones', () => {
    expect(rankStrength(1)).toBe(0.85);
    expect(rankStrength(5)).toBe(0.7);
    expect(rankStrength(10)).toBe(0.55);
    expect(rankStrength(11)).toBeNull();
    expect(clippersRankStrength(1)).toBeNull();
    expect(clippersRankStrength(2)).toBe(0.7);
    expect(clippersRankStrength(10)).toBe(0.55);
    expect(clippersRankStrength(11)).toBeNull();
    expect(milestoneStrength(0)).toBe(0.7);
    expect(milestoneStrength(2)).toBe(0.8);
    expect(milestoneStrength(4)).toBe(0.9);
    expect(milestoneStrength(9)).toBe(0.9);
  });
});

describe('pickFrame', () => {
  it('falls back to none (0.20)', () => {
    expect(pickFrame([])).toMatchObject({ type: 'none', strength: 0.2 });
  });
  it('keeps the strongest; ties go to the more specific subject', () => {
    const a = frame('first_since', 0.65);
    const b = frame('season_high', 0.6);
    expect(pickFrame([b, a])).toBe(a);
    const group = frame('first_since', 0.8, 'group');
    const subject = frame('first_since', 0.8, 'subject');
    const league = frame('league_rank', 0.8, 'league');
    expect(pickFrame([league, group, subject])).toBe(subject);
  });
});

describe('computedFrames', () => {
  it('frames league ranks from either end', () => {
    expect(computedFrames(makeFact({ kind: 'league_rank', data: { rank: 3, total: 30 } })))
      .toEqual([{ type: 'league_rank', strength: 0.7, who: 'league', text: '', rank: 3, total: 30, proof_rows: [] }]);
    expect(computedFrames(makeFact({ kind: 'opp_rank', data: { rank: 28, total: 30, bottom: true } }))[0])
      .toMatchObject({ type: 'league_rank', strength: 0.7, rank: 28 });
    expect(computedFrames(makeFact({ kind: 'standings', data: { rank: 1, total: 15 } }))[0])
      .toMatchObject({ strength: 0.85 });
    expect(computedFrames(makeFact({ kind: 'league_rank', data: { rank: 12, total: 30 } }))).toEqual([]);
  });
  it('frames milestones by threshold step and YoY team ranks', () => {
    expect(computedFrames(makeFact({ kind: 'milestone', data: { step: 2 } })))
      .toEqual([{ type: 'milestone', strength: 0.8, who: 'subject', text: '', step: 2, proof_rows: [] }]);
    expect(computedFrames(makeFact({ kind: 'yoy_change', data: { yoy: 'team_rank', rank: 2, total: 30 } }))[0])
      .toMatchObject({ type: 'league_rank', strength: 0.7 });
    expect(computedFrames(makeFact({ kind: 'yoy_change', data: { yoy: 'player' } }))).toEqual([]);
    expect(computedFrames(makeFact({ kind: 'h2h', data: {} }))).toEqual([]);
  });
});

describe('frameFact', () => {
  const rows = [{ end_date: '2021-01-10' }];
  const q1: Question = {
    name: 'q1', build: () => ({ sql: 'SELECT 1', params: [] }),
    interpret: (r) => (r.length ? frame('first_since', 0.65) : null),
  };
  const q2: Question = { name: 'q2', build: () => null, interpret: () => { throw new Error('not called'); } };
  const q3: Question = { name: 'q3', build: () => ({ sql: 'SELECT 3', params: [7] }), interpret: () => frame('records_best', 0.9) };

  it('runs the questions that apply and keeps the strongest frame with its query', async () => {
    const run = vi.fn(async () => rows);
    const out = await frameFact(makeFact(), makeCtx(), run, [q1, q2, q3]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(out.frame).toMatchObject({ type: 'records_best', strength: 0.9, proof_rows: rows });
    expect(out.proof).toEqual({ sql: 'SELECT 3', params: [7] });
  });
  it('lets a computed frame beat a weaker question and carries no query', async () => {
    const out = await frameFact(makeFact({ kind: 'league_rank', data: { rank: 1, total: 30 } }), makeCtx(), async () => rows, [q1]);
    expect(out.frame).toMatchObject({ type: 'league_rank', strength: 0.85 });
    expect(out.proof).toBeNull();
  });
  it('returns the none frame when nothing applies', async () => {
    const out = await frameFact(makeFact({ kind: 'h2h', data: {} }), makeCtx(), async () => [], [q2]);
    expect(out.frame.type).toBe('none');
    expect(out.proof).toBeNull();
  });
});
