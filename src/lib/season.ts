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
 * Pure calendar-based season id. Seasons roll over on July 1 (after the
 * Finals), the same rule as seasonStartYear() and the pipeline's
 * currentSeasonId(). Used only as a fallback when the DB has no completed
 * LAC games.
 */
export function calendarSeasonId(now: Date = new Date()): number {
  return now.getUTCMonth() < 6 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
}

/**
 * Season whose numbers the app shows (record, ratings, roster, player pages):
 * the most recent season with a completed Clippers game that has a box score.
 * Through the offseason and the preseason window this stays on last season —
 * the pages label which season they show — and it flips the morning after the
 * opener is finalized. (Flipping earlier would show an empty roster and 0-0:
 * rosters are built from games played.) The schedule is season-independent.
 */
export async function getDisplaySeasonId(): Promise<number> {
  const rows = await sql<{ display_season_id: number | null }[]>`
    SELECT MAX(g.season_id)::int AS display_season_id
    FROM games g
    WHERE (
        g.home_team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
        OR g.away_team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
      )
      AND lower(g.status) = 'final'
      AND EXISTS (SELECT 1 FROM game_team_box_scores b WHERE b.game_id = g.game_id)
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
