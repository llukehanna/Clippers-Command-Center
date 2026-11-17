// scripts/lib/periods-candidates.ts
// Which final Clippers games scripts/backfill-periods.ts still needs a line score for.
import type postgres from 'postgres';

export type PeriodsCandidate = { game_id: string; nba_game_id: string; season_id: number };

export async function periodsBackfillCandidates(sql: postgres.Sql, limit: number): Promise<PeriodsCandidate[]> {
  // Kaggle rows (raw_payload {"source":"kaggle"}) never carry periods and
  // cdn.nba.com has no line score for most of them; skipping keeps the nightly
  // job from retrying thousands of archive games forever.
  return sql<PeriodsCandidate[]>`
    SELECT g.game_id::text, g.nba_game_id::text, g.season_id
    FROM games g
    JOIN teams lac ON lac.abbreviation = 'LAC' AND lac.team_id IN (g.home_team_id, g.away_team_id)
    WHERE lower(g.status) = 'final'
      AND EXISTS (
        SELECT 1 FROM game_team_box_scores tb
        WHERE tb.game_id = g.game_id
          AND (jsonb_typeof(tb.raw_payload) IS DISTINCT FROM 'object' OR NOT (tb.raw_payload ? 'periods'))
          AND COALESCE(tb.raw_payload->>'source', '') <> 'kaggle'
      )
    ORDER BY g.game_date DESC
    LIMIT ${limit}
  `;
}
