// scripts/lib/insights/frozen.ts
// Pure classification for verify-insights (DB-free, unit-tested).
// A frozen postgame row is one the nightly run will never re-emit: its game is
// in a past season, or dated before the default postgame window (today in
// America/Los_Angeles minus 3 days). When its proof fails the underlying data
// changed after the fact; we retire the row instead of failing the pipeline.
import { addDays } from './engine/dates.js';
import { currentSeasonId } from '../schedule-utils.js';

export const POSTGAME_WINDOW_DAYS = 3;

export interface FrozenCandidate {
  surface: string | null;
  game_date: string | null;  // ISO date of the row's game
  season_id: number | null;  // season of the row's game
}

export function isFrozenPostgame(row: FrozenCandidate, today: string): boolean {
  if (row.surface !== 'postgame') return false;
  if (row.season_id !== null && row.season_id < currentSeasonId(new Date(`${today}T12:00:00Z`))) return true;
  return row.game_date !== null && row.game_date < addDays(today, -POSTGAME_WINDOW_DAYS);
}
