// scripts/lib/insights/frozen.ts
// Pure classification for verify-insights (DB-free, unit-tested).
// A frozen postgame row is one the nightly run will never re-emit: its game is
// in a past season, or outside the postgame window (the engine covers dates > today − days, so
// frozen means <= today − days; today is America/Los_Angeles). When its proof fails the underlying data
// changed after the fact; we retire the row instead of failing the pipeline.
import { addDays, DEFAULT_POSTGAME_DAYS } from './engine/dates.js';
import { currentSeasonId } from '../schedule-utils.js';


export interface FrozenCandidate {
  surface: string | null;
  game_date: string | null;  // ISO date of the row's game
  season_id: number | null;  // season of the row's game
}

export function isFrozenPostgame(row: FrozenCandidate, today: string, days: number = DEFAULT_POSTGAME_DAYS): boolean {
  if (row.surface !== 'postgame') return false;
  if (row.season_id !== null && row.season_id < currentSeasonId(new Date(`${today}T12:00:00Z`))) return true;
  return row.game_date !== null && row.game_date <= addDays(today, -days);
}
