// scripts/lib/insights/engine/periods.ts
// Each player's best regulation quarter and best half from per-quarter lines. Pure.
// Overtime periods are ignored, exactly as the reference sets ignore them (period <= 4).
export interface PeriodRow { player_id: string; display_name: string; period: number; pts: number }
export interface PlayerPeriods {
  playerId: string;
  name: string;
  quarter: { period: number; pts: number };
  half: { half: 1 | 2; pts: number };
}

export function bestPeriods(rows: PeriodRow[]): PlayerPeriods[] {
  const byPlayer = new Map<string, PeriodRow[]>();
  for (const r of rows) if (r.period >= 1 && r.period <= 4) byPlayer.set(r.player_id, [...(byPlayer.get(r.player_id) ?? []), r]);
  return [...byPlayer.values()].map((list) => {
    const quarter = list.reduce((b, r) => (r.pts > b.pts || (r.pts === b.pts && r.period < b.period) ? r : b));
    const first = list.filter((r) => r.period <= 2).reduce((s, r) => s + r.pts, 0);
    const second = list.filter((r) => r.period >= 3).reduce((s, r) => s + r.pts, 0);
    return {
      playerId: list[0].player_id,
      name: list[0].display_name,
      quarter: { period: quarter.period, pts: quarter.pts },
      half: second > first ? { half: 2 as const, pts: second } : { half: 1 as const, pts: first },
    };
  });
}
