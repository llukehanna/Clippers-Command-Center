import { describe, it, expect } from 'vitest';
import {
  isTrivial, novelty, probability, rarity, recency, salienceClass, scoreInsight, unchangedSince,
} from './score';
import { makeCtx } from './__fixtures__/facts';

describe('probability (Bayesian shrinkage, α = 10)', () => {
  it('shrinks k/n toward p_ref', () => {
    expect(probability({ kind: 'rate', k: 2, n: 60, pRef: 0.05, power: 1 })).toBeCloseTo(2.5 / 70, 9);
  });
  it('raises a per-game rate to the streak length', () => {
    expect(probability({ kind: 'rate', k: 54, n: 60, pRef: 0.1, power: 3 })).toBeCloseTo((55 / 70) ** 3, 9);
  });
  it('clamps shares and has no p for context facts', () => {
    expect(probability({ kind: 'share', p: 0 })).toBe(1e-6);
    expect(probability({ kind: 'share', p: 2 })).toBe(1);
    expect(probability({ kind: 'context' })).toBeNull();
  });
});

describe('rarity', () => {
  it('maps p = 0.001 to 1 and p = 1 to 0', () => {
    expect(rarity(0.001)).toBeCloseTo(1, 9);
    expect(rarity(0.01)).toBeCloseTo(2 / 3, 9);
    expect(rarity(1)).toBe(0);
    expect(rarity(1e-9)).toBe(1);
    expect(rarity(null)).toBe(0);
  });
});

describe('triviality filter', () => {
  it('drops p > 0.25 unless the frame or kind is always news', () => {
    const p = (55 / 70) ** 3; // a 28-PPG scorer's "20+ in 3 straight"
    expect(isTrivial(p, 'longest_since', 'streak')).toBe(true);
    expect(isTrivial(p, 'records_best', 'streak')).toBe(false);
    expect(isTrivial(p, 'career_high', 'player_game_stat')).toBe(false);
    expect(isTrivial(p, 'only_one', 'player_game_stat')).toBe(false);
    expect(isTrivial(p, 'milestone', 'milestone')).toBe(false);
    expect(isTrivial(p, 'first_since', 'milestone')).toBe(false);
    expect(isTrivial(0.25, 'none', 'league_rank')).toBe(false);
    expect(isTrivial(null, 'none', 'h2h')).toBe(false);
  });
});

describe('salience, recency, novelty', () => {
  it('classifies the subject', () => {
    const { roster } = makeCtx();
    expect(salienceClass({ type: 'team', id: '1', name: 'Clippers' }, roster)).toBe('team');
    expect(salienceClass({ type: 'player', id: '1', name: 'Star Clipper' }, roster)).toBe('roster_core');
    expect(salienceClass({ type: 'player', id: '2', name: 'Big Clipper' }, roster)).toBe('roster');
    expect(salienceClass({ type: 'player', id: '99', name: 'Former Clipper' }, roster)).toBe('former');
  });
  it('halves at the half-life; pregame is 1 until tip, then 0', () => {
    expect(recency('season', 14)).toBeCloseTo(0.5, 9);
    expect(recency('postgame', 3)).toBeCloseTo(0.5, 9);
    expect(recency('player', 0)).toBe(1);
    expect(recency('pregame', -2)).toBe(1);
    expect(recency('pregame', 0)).toBe(1);
    expect(recency('pregame', 1)).toBe(0);
  });
  it('boosts new claims and decays stale ones', () => {
    expect(novelty('2026-02-25', null, null)).toBe(0.1);
    expect(novelty('2026-02-25', '2026-02-23', '2026-02-23')).toBe(0.1);
    expect(novelty('2026-02-25', '2026-02-20', '2026-02-20')).toBe(0);
    expect(novelty('2026-02-25', '2026-01-01', '2026-02-05')).toBeCloseTo(-0.12, 9);
    expect(novelty('2026-02-25', '2025-12-01', '2026-01-05')).toBe(-0.2);
  });
  it('tracks how long the headline and frame have been unchanged', () => {
    const prior = { firstEmittedAt: '2026-01-01', headline: 'h', frameType: 'records_best' as const, unchangedSince: '2026-01-10' };
    expect(unchangedSince(null, 'h', 'records_best', '2026-02-25')).toBe('2026-02-25');
    expect(unchangedSince(prior, 'h', 'records_best', '2026-02-25')).toBe('2026-01-10');
    expect(unchangedSince({ ...prior, unchangedSince: null }, 'h', 'records_best', '2026-02-25')).toBe('2026-01-01');
    expect(unchangedSince(prior, 'h2', 'records_best', '2026-02-25')).toBe('2026-02-25');
    expect(unchangedSince(prior, 'h', 'first_since', '2026-02-25')).toBe('2026-02-25');
  });
});

describe('scoreInsight', () => {
  it('combines every term (spec §2.4)', () => {
    const s = scoreInsight({
      surface: 'postgame', kind: 'player_game_stat', sample: { kind: 'rate', k: 2, n: 60, pRef: 0.05, power: 1 },
      frameStrength: 0.9, salienceClass: 'roster_core', polarity: 'positive', ageDays: 0,
      asOf: '2026-02-25', firstEmittedAt: null, unchangedSince: '2026-02-25',
    });
    expect(s.p).toBeCloseTo(0.035714, 5);
    expect(s.rarity).toBeCloseTo(0.48239, 4);
    expect(s.base).toBeCloseTo(0.64943, 4);
    expect(s.novelty).toBe(0.1);
    expect(s.half_life_days).toBe(3);
    expect(s.importance).toBe(75);
  });
  it('applies team salience, recency and negative polarity', () => {
    const s = scoreInsight({
      surface: 'season', kind: 'league_rank', sample: { kind: 'share', p: 0.1 },
      frameStrength: 0.7, salienceClass: 'team', polarity: 'negative', ageDays: 14,
      asOf: '2026-02-25', firstEmittedAt: '2026-02-15', unchangedSince: '2026-02-15',
    });
    expect(s.base).toBeCloseTo(0.48, 9);
    expect(s.importance).toBe(17);
  });
  it('clamps at 0', () => {
    const s = scoreInsight({
      surface: 'pregame', kind: 'h2h', sample: { kind: 'context' }, frameStrength: 0.2, salienceClass: 'team',
      polarity: 'neutral', ageDays: 1, asOf: '2026-02-25', firstEmittedAt: '2026-01-01', unchangedSince: '2026-01-01',
    });
    expect(s.p).toBeNull();
    expect(s.importance).toBe(0);
  });
});
