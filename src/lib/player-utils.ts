// src/lib/player-utils.ts
// Pure derivation utilities for player trend computations.
// No DB dependency — safe to import from both server and client contexts.

export type GameLogRow = {
  game_id: string;
  PTS: number;
  REB: number;
  AST: number;
  ts_pct_computed?: number | null;
};

export type AverageStat = {
  pts: number | null;
  reb: number | null;
  ast: number | null;
  ts: number | null;
};

export type DerivedAverages = {
  l5: AverageStat;
  season: AverageStat;
};

export type ChartSeriesPoint = {
  game_date: string;
  value: number | null;
};

export type MergedChartPoint = {
  date: string;
  l5: number | null;
  l10: number | null;
};

export type SeasonAverages = {
  pts_avg: number | null;
  reb_avg: number | null;
  ast_avg: number | null;
  ts_pct: number | null;
};

function avgOf(vals: (number | null | undefined)[]): number | null {
  const nums = vals.filter((v): v is number => v !== null && v !== undefined);
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * deriveAverages — computes L5 (first 5 rows) and season (all rows) averages
 * for PTS, REB, AST, and TS% from a game log array.
 *
 * @param gameLog - Array of game log rows in descending date order (most recent first)
 * @returns DerivedAverages with l5 and season sub-objects
 */
export function deriveAverages(gameLog: GameLogRow[]): DerivedAverages {
  const seasonRows = gameLog;
  const l5Rows = gameLog.slice(0, 5);

  function computeStat(rows: GameLogRow[]): AverageStat {
    if (rows.length === 0) {
      return { pts: null, reb: null, ast: null, ts: null };
    }
    return {
      pts: avgOf(rows.map((r) => r.PTS)),
      reb: avgOf(rows.map((r) => r.REB)),
      ast: avgOf(rows.map((r) => r.AST)),
      ts: avgOf(rows.map((r) => r.ts_pct_computed ?? null)),
    };
  }

  return {
    l5: computeStat(l5Rows),
    season: computeStat(seasonRows),
  };
}

/**
 * l5ColorClass — returns a Tailwind text color class based on how L5 compares to L10.
 *
 * Rules:
 * - l5 > l10 by more than 10% → "text-positive"
 * - l5 < l10 by more than 10% → "text-negative"
 * - Within threshold, either null, or l10 === 0 → ""
 *
 * @param l5 - L5 rolling average (null if unavailable)
 * @param l10 - L10 rolling average (null if unavailable)
 * @returns Tailwind class string
 */
export function l5ColorClass(l5: number | null, l10: number | null): string {
  if (l5 === null || l10 === null || l10 === 0) return '';
  const pctDiff = (l5 - l10) / l10;
  if (pctDiff > 0.1) return 'text-positive';
  if (pctDiff < -0.1) return 'text-negative';
  return '';
}

/**
 * mergeChartSeries — merges two date-keyed series arrays into unified data points.
 *
 * All unique dates from both arrays are included, sorted ascending.
 * When a date appears in only one series, the other value is null.
 *
 * @param l5rows - L5 chart series points
 * @param l10rows - L10 chart series points
 * @returns Array of merged points sorted by date ascending
 */
export function mergeChartSeries(
  l5rows: ChartSeriesPoint[],
  l10rows: ChartSeriesPoint[]
): MergedChartPoint[] {
  const l5Map = new Map<string, number | null>();
  const l10Map = new Map<string, number | null>();

  for (const row of l5rows) {
    l5Map.set(row.game_date, row.value);
  }
  for (const row of l10rows) {
    l10Map.set(row.game_date, row.value);
  }

  const allDates = Array.from(new Set([...l5Map.keys(), ...l10Map.keys()])).sort();

  return allDates.map((date) => ({
    date,
    l5: l5Map.has(date) ? (l5Map.get(date) ?? null) : null,
    l10: l10Map.has(date) ? (l10Map.get(date) ?? null) : null,
  }));
}

/**
 * computeSeasonAverages — computes averages over ALL game log rows.
 *
 * @param gameLog - Array of game log rows
 * @returns SeasonAverages or null if array is empty
 */
export function computeSeasonAverages(gameLog: GameLogRow[]): SeasonAverages | null {
  if (gameLog.length === 0) return null;
  return {
    pts_avg: avgOf(gameLog.map((r) => r.PTS)),
    reb_avg: avgOf(gameLog.map((r) => r.REB)),
    ast_avg: avgOf(gameLog.map((r) => r.AST)),
    ts_pct: avgOf(gameLog.map((r) => r.ts_pct_computed ?? null)),
  };
}
