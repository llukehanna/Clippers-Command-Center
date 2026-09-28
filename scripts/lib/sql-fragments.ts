// scripts/lib/sql-fragments.ts
// SQL fragments shared by insight and record-book queries. DB-free so pure
// modules (and their unit tests) can import them.

/**
 * Predicate (for alias `g`) selecting regular-season games only: excludes
 * playoffs and the play-in (NBA ids 005YY…, stored as 50,000,000–59,999,999).
 */
export const REGULAR_SEASON = `(NOT g.is_playoffs AND g.nba_game_id NOT BETWEEN 50000000 AND 59999999)`;
