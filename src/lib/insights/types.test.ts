import { describe, it, expect } from 'vitest';
import { scopeForSurface, SURFACES } from './types';
import { evidenceAria } from './evidence-aria';

describe('scopeForSurface', () => {
  it('keeps the legacy scope populated (spec §2.8)', () => {
    expect(scopeForSurface('season')).toBe('between_games');
    expect(scopeForSurface('player')).toBe('between_games');
    expect(scopeForSurface('pregame')).toBe('between_games');
    expect(scopeForSurface('postgame')).toBe('historical');
    expect(scopeForSurface('live')).toBe('live');
    expect(SURFACES).toEqual(['live', 'pregame', 'postgame', 'season', 'player']);
  });
});

describe('evidenceAria', () => {
  it('summarises a streak strip', () => {
    expect(evidenceAria({
      type: 'streak_strip', threshold: 30,
      games: [
        { date: '2026-02-01', value: 31, hit: true },
        { date: '2026-02-03', value: 34, hit: true },
        { date: '2026-02-05', value: 22, hit: false },
      ],
    })).toBe('2 of 3 games at 30 or better');
  });

  it('summarises a rank track', () => {
    expect(evidenceAria({ type: 'rank_track', rank: 3, total: 30, betterIsHigher: true, label: 'offensive rating' }))
      .toBe('Ranked 3rd of 30 in offensive rating');
  });

  it('summarises a history ladder with and without a next best', () => {
    const current = { value: 55, label: 'Star Clipper, Jan 2, 2026' };
    expect(evidenceAria({ type: 'history_ladder', current, others: [{ value: 48, label: 'Big Clipper', date: 'Dec 1, 2024' }] }))
      .toBe('Star Clipper, Jan 2, 2026: 55. Next best on record: 48, Big Clipper, Dec 1, 2024');
    expect(evidenceAria({ type: 'history_ladder', current, others: [] })).toBe('Star Clipper, Jan 2, 2026: 55');
  });

  it('summarises a delta, a milestone and a margin spark', () => {
    expect(evidenceAria({
      type: 'delta', betterIsHigher: true,
      before: { value: 24.1, label: '2024-25' }, after: { value: 27.5, label: '2025-26' },
    })).toBe('From 24.1 (2024-25) to 27.5 (2025-26)');
    expect(evidenceAria({ type: 'milestone_progress', current: 1612, target: 1500, label: 'points' }))
      .toBe('1,612 of 1,500 points');
    expect(evidenceAria({ type: 'margin_spark', series: [[0, 0], [600, -12], [2880, 7]] }))
      .toBe('Margin ranged from -12 to 7');
    expect(evidenceAria({ type: 'margin_spark', series: [] })).toBe('No margin data');
  });
});
