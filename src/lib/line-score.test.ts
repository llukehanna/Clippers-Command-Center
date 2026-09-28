// src/lib/line-score.test.ts — buildLineScore (history game `periods`).
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/src/lib/db', () => ({ sql: vi.fn() }));

import { buildLineScore } from './data/history-game';

describe('buildLineScore', () => {
  it('pairs home and away scores by period, overtime included', () => {
    const home = [{ period: 1, periodType: 'REGULAR', score: 30 }, { period: 5, periodType: 'OVERTIME', score: 9 }];
    const away = [{ period: 5, periodType: 'OVERTIME', score: 7 }, { period: 1, periodType: 'REGULAR', score: 25 }];
    expect(buildLineScore(home, away)).toEqual([
      { period: 1, home: 30, away: 25 },
      { period: 5, home: 9, away: 7 },
    ]);
  });

  it('returns [] when the line score is not stored', () => {
    expect(buildLineScore(null, undefined)).toEqual([]);
    expect(buildLineScore('oops', [])).toEqual([]);
  });
});
