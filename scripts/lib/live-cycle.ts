// scripts/lib/live-cycle.ts
// Finds Clippers games that may be live now. The polling itself lives in
// scripts/lib/live-poller.ts (Live v2); callers are the game-night runner and
// the on-demand /api/cron/poll-live route.

import type { Sql } from 'postgres';

export interface LiveCandidate {
  game_id: string;
  nba_game_id: string;
  home_team_id: string;
  away_team_id: string;
  start_time_utc: Date | null;
}

export function scoreboardStatus(gameStatus: number): 'scheduled' | 'in_progress' | 'final' {
  return gameStatus === 3 ? 'final' : gameStatus === 2 ? 'in_progress' : 'scheduled';
}

/**
 * Clippers games that may be live now: not final, tipping within the next
 * `leadMinutes`, or tipped within the last 4 hours (overtime + delays).
 * Rows with no start time fall back to today's US Eastern date.
 */
export async function findLiveCandidates(sql: Sql, leadMinutes = 30): Promise<LiveCandidate[]> {
  return sql<LiveCandidate[]>`
    SELECT g.game_id::text, g.nba_game_id::text, g.home_team_id::text, g.away_team_id::text,
           g.start_time_utc
    FROM games g
    JOIN teams lac ON lac.abbreviation = 'LAC'
      AND lac.team_id IN (g.home_team_id, g.away_team_id)
    WHERE g.status <> 'final'
      AND (
        g.start_time_utc BETWEEN now() - INTERVAL '4 hours'
                             AND now() + make_interval(mins => ${leadMinutes})
        OR (g.start_time_utc IS NULL
            AND g.game_date = (now() AT TIME ZONE 'America/New_York')::date)
      )
    ORDER BY g.start_time_utc ASC NULLS LAST
  `;
}
