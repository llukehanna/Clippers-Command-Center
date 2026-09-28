// scripts/lib/record-book/records-start.ts
// The first season of the contiguous run of complete seasons ending at the
// latest complete one — where "records" begin for framing ("since 1996-97").

/** Regular-season games with box scores for a season to count as complete (1998-99 lockout: 725). */
export const MIN_COMPLETE_GAMES = 700;

export interface SeasonCoverage {
  season_id: number;
  games_with_box: number;   // final regular-season games that have player box scores
}

/**
 * @param backfilledThrough earliest season backfill-history finished cleanly
 *   (app_kv 'history:backfilled_through'); a partially written older season is
 *   never counted even if it passes the game threshold.
 */
export function resolveRecordsStart(coverage: SeasonCoverage[], backfilledThrough: number | null): number | null {
  const complete = new Set(coverage.filter((c) => c.games_with_box >= MIN_COMPLETE_GAMES).map((c) => c.season_id));
  if (complete.size === 0) return null;
  let start = Math.max(...complete);
  while (complete.has(start - 1)) start--;
  return backfilledThrough !== null ? Math.max(start, backfilledThrough) : start;
}

/** Share of a season's Clippers games that need play-by-play for the season to count as complete. */
export const MIN_PBP_COVERAGE = 0.95;

export interface PbpCoverage {
  season_id: number;
  games: number;        // final regular-season Clippers games
  with_flow: number;    // of those, games with a game_flow row (play-by-play ingested)
}

/**
 * First season of play-by-play records ("most points in a quarter since 2019-20"):
 * the contiguous run of seasons with >= MIN_PBP_COVERAGE of Clippers games
 * ingested, ending at the latest such season. Null when no season qualifies.
 */
export function resolvePbpRecordsStart(coverage: PbpCoverage[]): number | null {
  const complete = new Set(
    coverage.filter((c) => c.games > 0 && c.with_flow / c.games >= MIN_PBP_COVERAGE).map((c) => c.season_id)
  );
  if (complete.size === 0) return null;
  let start = Math.max(...complete);
  while (complete.has(start - 1)) start--;
  return start;
}
