// src/lib/insights/season-highs.ts
// The floors under which a player's season high is noise (1 block over a prior max of 0). Shared by the box
// score's grey tags and the Record book's "season high" notes. Pure, no imports.

export type SeasonHighStat = 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'fg3m';

export const SEASON_HIGH_FLOORS: Record<SeasonHighStat, number> = { pts: 15, reb: 8, ast: 5, stl: 3, blk: 3, fg3m: 3 };

/** True when a season high in this stat is worth a mark; a stat without a floor always is. */
export function meetsSeasonHighFloor(stat: string, value: number): boolean {
  const floor = Object.prototype.hasOwnProperty.call(SEASON_HIGH_FLOORS, stat)
    ? SEASON_HIGH_FLOORS[stat as SeasonHighStat]
    : null;
  return floor === null || value >= floor;
}
