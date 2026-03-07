// src/lib/player-utils.test.ts
// Vitest unit tests for player derivation utilities

import { describe, it, expect } from 'vitest';
import {
  deriveAverages,
  l5ColorClass,
  mergeChartSeries,
  computeSeasonAverages,
} from './player-utils';

type GameLogRow = {
  game_id: string;
  PTS: number;
  REB: number;
  AST: number;
  ts_pct_computed?: number | null;
};

function makeRow(
  i: number,
  pts: number,
  reb: number,
  ast: number,
  ts?: number | null
): GameLogRow {
  return {
    game_id: `game-${i}`,
    PTS: pts,
    REB: reb,
    AST: ast,
    ts_pct_computed: ts ?? null,
  };
}

// 8-row fixture: rows 0-4 are "recent" (L5), rows 5-7 older
const EIGHT_ROWS: GameLogRow[] = [
  makeRow(1, 30, 5, 4, 0.65),
  makeRow(2, 25, 6, 3, 0.60),
  makeRow(3, 20, 4, 5, 0.55),
  makeRow(4, 28, 7, 2, 0.70),
  makeRow(5, 22, 3, 6, 0.58),
  makeRow(6, 15, 8, 1, 0.45),
  makeRow(7, 18, 5, 3, 0.50),
  makeRow(8, 10, 2, 7, 0.40),
];

describe('deriveAverages', () => {
  it('uses first 5 rows for L5, all 8 rows for season', () => {
    const result = deriveAverages(EIGHT_ROWS);
    expect(result).not.toBeNull();

    // L5 PTS: (30+25+20+28+22)/5 = 125/5 = 25
    expect(result!.l5.pts).toBeCloseTo(25, 4);
    // Season PTS: (30+25+20+28+22+15+18+10)/8 = 168/8 = 21
    expect(result!.season.pts).toBeCloseTo(21, 4);

    // L5 REB: (5+6+4+7+3)/5 = 25/5 = 5
    expect(result!.l5.reb).toBeCloseTo(5, 4);
    // Season REB: (5+6+4+7+3+8+5+2)/8 = 40/8 = 5
    expect(result!.season.reb).toBeCloseTo(5, 4);

    // L5 AST: (4+3+5+2+6)/5 = 20/5 = 4
    expect(result!.l5.ast).toBeCloseTo(4, 4);
    // Season AST: (4+3+5+2+6+1+3+7)/8 = 31/8 = 3.875
    expect(result!.season.ast).toBeCloseTo(3.875, 4);
  });

  it('returns null for all stats when given an empty array', () => {
    const result = deriveAverages([]);
    expect(result).not.toBeNull();
    expect(result!.l5.pts).toBeNull();
    expect(result!.l5.reb).toBeNull();
    expect(result!.l5.ast).toBeNull();
    expect(result!.l5.ts).toBeNull();
    expect(result!.season.pts).toBeNull();
    expect(result!.season.reb).toBeNull();
    expect(result!.season.ast).toBeNull();
    expect(result!.season.ts).toBeNull();
  });
});

describe('l5ColorClass', () => {
  it('returns text-positive when L5 is more than 10% above L10', () => {
    // 26 vs 23: (26-23)/23 = 13% → text-positive
    expect(l5ColorClass(26, 23)).toBe('text-positive');
  });

  it('returns text-negative when L5 is more than 10% below L10', () => {
    // 20 vs 23: (20-23)/23 = -13% → text-negative
    expect(l5ColorClass(20, 23)).toBe('text-negative');
  });

  it('returns empty string when within 10% threshold', () => {
    // 24 vs 23: (24-23)/23 = 4.3% → ""
    expect(l5ColorClass(24, 23)).toBe('');
  });

  it('returns empty string when l5 is null', () => {
    expect(l5ColorClass(null, 23)).toBe('');
  });

  it('returns empty string when l10 is 0 (avoid division by zero)', () => {
    expect(l5ColorClass(26, 0)).toBe('');
  });
});

describe('mergeChartSeries', () => {
  it('correctly handles non-overlapping dates — all points have one null value', () => {
    const l5 = [
      { game_date: '2024-01-01', value: 10 },
      { game_date: '2024-01-03', value: 12 },
    ];
    const l10 = [
      { game_date: '2024-01-02', value: 8 },
      { game_date: '2024-01-04', value: 9 },
    ];
    const result = mergeChartSeries(l5, l10);
    expect(result).toHaveLength(4);
    // Sorted ascending
    expect(result[0].date).toBe('2024-01-01');
    expect(result[0].l5).toBe(10);
    expect(result[0].l10).toBeNull();
    expect(result[1].date).toBe('2024-01-02');
    expect(result[1].l5).toBeNull();
    expect(result[1].l10).toBe(8);
  });

  it('correctly merges overlapping dates', () => {
    const l5 = [
      { game_date: '2024-01-01', value: 10 },
      { game_date: '2024-01-02', value: 12 },
    ];
    const l10 = [
      { game_date: '2024-01-01', value: 8 },
      { game_date: '2024-01-03', value: 9 },
    ];
    const result = mergeChartSeries(l5, l10);
    expect(result).toHaveLength(3);
    // 2024-01-01 has both values
    expect(result[0].date).toBe('2024-01-01');
    expect(result[0].l5).toBe(10);
    expect(result[0].l10).toBe(8);
    // 2024-01-02 only in l5
    expect(result[1].date).toBe('2024-01-02');
    expect(result[1].l5).toBe(12);
    expect(result[1].l10).toBeNull();
    // 2024-01-03 only in l10
    expect(result[2].date).toBe('2024-01-03');
    expect(result[2].l5).toBeNull();
    expect(result[2].l10).toBe(9);
  });
});

describe('computeSeasonAverages', () => {
  it('computes correct averages over 3 rows', () => {
    const rows: GameLogRow[] = [
      makeRow(1, 30, 5, 4, 0.65),
      makeRow(2, 20, 3, 6, 0.55),
      makeRow(3, 10, 7, 2, 0.45),
    ];
    const result = computeSeasonAverages(rows);
    expect(result).not.toBeNull();
    // PTS: (30+20+10)/3 = 20
    expect(result!.pts_avg).toBeCloseTo(20, 4);
    // REB: (5+3+7)/3 = 5
    expect(result!.reb_avg).toBeCloseTo(5, 4);
    // AST: (4+6+2)/3 = 4
    expect(result!.ast_avg).toBeCloseTo(4, 4);
    // TS: (0.65+0.55+0.45)/3 = 0.55
    expect(result!.ts_pct).toBeCloseTo(0.55, 4);
  });

  it('returns null when given an empty array', () => {
    expect(computeSeasonAverages([])).toBeNull();
  });
});
