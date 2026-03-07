// src/lib/odds.ts
// Query helper for odds data — reads from odds_snapshots table.
// Imported by Phase 9 API routes via src/lib/.

import { sql } from './db.js';
import type { OddsSnapshot } from './types/odds.js';

/**
 * Returns the most recent OddsSnapshot for a given game if one was captured
 * within the last 24 hours, or null if no fresh snapshot exists.
 *
 * @param gameId - Internal DB game_id (bigint as string)
 * @returns OddsSnapshot | null
 */
export async function getLatestOdds(gameId: string): Promise<OddsSnapshot | null> {
  const rows = await sql<OddsSnapshot[]>`
    SELECT
      spread_home::float8   AS spread_home,
      spread_away::float8   AS spread_away,
      moneyline_home,
      moneyline_away,
      total_points::float8  AS total_points,
      captured_at::text     AS captured_at
    FROM odds_snapshots
    WHERE game_id = ${gameId}::bigint
      AND captured_at > now() - INTERVAL '24 hours'
    ORDER BY captured_at DESC
    LIMIT 1
  `;

  const [row] = rows;
  return row ?? null;
}
