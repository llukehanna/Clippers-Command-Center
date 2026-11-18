// src/lib/game-preview-utils.ts
// Pure helpers behind the game preview: the Clippers' side of each odds
// snapshot, days since each team last played, and a sparkline path.

export interface OddsRow {
  captured_at: string;
  spread_home: number | null;
  spread_away: number | null;
  moneyline_home: number | null;
  moneyline_away: number | null;
  total_points: number | null;
}

export function lacSpreadSeries(rows: OddsRow[], lacHome: boolean): { t: string; spread: number }[] {
  const out: { t: string; spread: number }[] = [];
  for (const row of rows) {
    const spread = lacHome ? row.spread_home : row.spread_away;
    if (spread != null && Number.isFinite(spread)) out.push({ t: row.captured_at, spread });
  }
  return out;
}

export function latestLacLine(rows: OddsRow[], lacHome: boolean) {
  const last = rows.at(-1);
  if (!last) return null;
  return {
    spread: lacHome ? last.spread_home : last.spread_away,
    moneyline: lacHome ? last.moneyline_home : last.moneyline_away,
    over_under: last.total_points,
    captured_at: last.captured_at,
  };
}

const DAY_MS = 86_400_000;

export function daysSince(gameDate: string, prevDate: string | null): number | null {
  if (!prevDate) return null;
  return Math.round((Date.parse(`${gameDate}T00:00:00Z`) - Date.parse(`${prevDate}T00:00:00Z`)) / DAY_MS);
}

export function sparklinePath(values: number[], width: number, height: number, pad = 2): string {
  if (values.length < 2) return '';
  const hi = Math.max(...values);
  const lo = Math.min(...values);
  const step = (width - 2 * pad) / (values.length - 1);
  return values
    .map((v, i) => {
      const x = pad + i * step;
      const y = hi === lo ? height / 2 : pad + ((hi - v) / (hi - lo)) * (height - 2 * pad);
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
