// src/lib/season.ts
// Season derivation shared by API routes.
//
// season_id is the start year of an NBA season (2025 = "2025-26").
// The calendar alone is a poor guide to "the current season": in the offseason
// (July–October) the calendar has already rolled to the next season, which has
// no games yet, so records show 0-0 and rosters are empty. Instead we derive the
// display season from what is actually in the games table.

import { sql, LAC_NBA_TEAM_ID } from './db';

/**
 * How far ahead (in days) the next scheduled LAC game may be for its season to
 * become the display season. Keeps the dashboard on last season's numbers
 * through the offseason and flips to the new season about two weeks before
 * opening night.
 */
export const UPCOMING_SEASON_LOOKAHEAD_DAYS = 14;

/**
 * Pure calendar-based season id. January–July belong to the season that
 * started the previous calendar year (the Finals can run into late June).
 * Used only as a fallback when the DB has no LAC games at all, and as a cheap
 * "is this season still in play" check for cache headers.
 */
export function calendarSeasonId(now: Date = new Date()): number {
  return now.getUTCMonth() < 7 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
}

/**
 * DB-derived season to display across the app:
 *   1. the season of the next non-final LAC game dated within the next
 *      UPCOMING_SEASON_LOOKAHEAD_DAYS days (US Eastern calendar date), else
 *   2. the most recent season with at least one final LAC game.
 * The greater of the two wins (Postgres GREATEST ignores NULLs).
 * Falls back to calendarSeasonId() when the DB has neither.
 */
export async function getDisplaySeasonId(): Promise<number> {
  const rows = await sql<{ display_season_id: number | null }[]>`
    SELECT GREATEST(
      (
        SELECT g.season_id
        FROM games g
        WHERE (
          g.home_team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
          OR g.away_team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
        )
          AND lower(g.status) <> 'final'
          AND g.game_date >= (now() AT TIME ZONE 'America/New_York')::date
          AND g.game_date <= (now() AT TIME ZONE 'America/New_York')::date + ${UPCOMING_SEASON_LOOKAHEAD_DAYS}::int
        ORDER BY g.game_date ASC
        LIMIT 1
      ),
      (
        SELECT MAX(g.season_id)
        FROM games g
        WHERE (
          g.home_team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
          OR g.away_team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
        )
          AND lower(g.status) = 'final'
      )
    )::int AS display_season_id
  `;
  const value = rows[0]?.display_season_id;
  return typeof value === 'number' && Number.isFinite(value) ? value : calendarSeasonId();
}

/**
 * Parse an optional `season_id` query param.
 * Returns undefined when absent, null when present but invalid, else the number.
 */
export function parseSeasonIdParam(raw: string | null): number | null | undefined {
  if (raw === null || raw === '') return undefined;
  if (!/^\d{4}$/.test(raw)) return null;
  return parseInt(raw, 10);
}
