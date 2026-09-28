// scripts/lib/backfill-plan.ts
// Which seasons backfill-history should ingest next (newest first). Pure.

/** stats.nba.com league game logs are complete from 1996-97. */
export const HISTORY_OLDEST_SEASON = 1996;

/**
 * @param loadedThrough earliest season already fully loaded (app_kv
 *                      'history:backfilled_through', else the start of complete records)
 * @param stopAt        oldest season to ingest in this run
 */
export function planHistorySeasons(loadedThrough: number, stopAt: number): number[] {
  const from = loadedThrough - 1;
  const to = Math.max(stopAt, HISTORY_OLDEST_SEASON);
  const seasons: number[] = [];
  for (let s = from; s >= to; s--) seasons.push(s);
  return seasons;
}
