// scripts/lib/insights/league-comparisons.ts
// Batch insight category: league comparisons.
// Exports generateLeagueComparisonInsights() — returns InsightRow[] for:
//   1. clippers_off_rank: Clippers offensive rating rank in league (last 10 games)
//   2. clippers_net_rank: Clippers net rating rank in league (last 10 games)
//
// Only generates insights when Clippers rank in top 5 (rank <= 5).
import { sql } from '../db.js';
import {
  InsightRow,
  makeProofHash,
  guardProofResult,
  computeImportance,
} from './proof-utils.js';

const ROLLING_WINDOW = 10;
const TOP_N_RANK = 5;

export async function generateLeagueComparisonInsights(): Promise<InsightRow[]> {
  const results: InsightRow[] = [];

  // Look up LAC team_id dynamically
  const [lacTeam] = await sql<{ team_id: string }[]>`
    SELECT team_id::text AS team_id FROM teams WHERE abbreviation = 'LAC'
  `;
  if (!lacTeam) return [];
  const lacTeamId = lacTeam.team_id;

  const asOfDate = new Date().toISOString().slice(0, 10);

  // -------------------------------------------------------------------------
  // 1. clippers_off_rank: Clippers offensive rating rank (last 10 games)
  // -------------------------------------------------------------------------
  const offRankProofSql = `
    SELECT COUNT(*) + 1 AS rank,
           total.total_teams
    FROM rolling_team_stats rts
    CROSS JOIN (
      SELECT COUNT(DISTINCT team_id) AS total_teams
      FROM rolling_team_stats
      WHERE window_games = $2
    ) total
    WHERE rts.window_games = $2
      AND rts.off_rating > (
        SELECT off_rating
        FROM rolling_team_stats
        WHERE team_id = $1::bigint
          AND window_games = $2
      )
  `.trim();

  const offRankProofParams = {
    lac_team_id: lacTeamId,
    window_games: ROLLING_WINDOW,
    as_of_date: asOfDate,
  };

  const offRankProofResult = await sql<{
    rank: string;
    total_teams: string;
  }[]>`
    SELECT
      (
        SELECT (COUNT(*) + 1)::text
        FROM rolling_team_stats
        WHERE window_games = ${ROLLING_WINDOW}
          AND off_rating > (
            SELECT off_rating FROM rolling_team_stats
            WHERE team_id = ${lacTeamId}::bigint AND window_games = ${ROLLING_WINDOW}
            LIMIT 1
          )
      ) AS rank,
      (
        SELECT COUNT(DISTINCT team_id)::text
        FROM rolling_team_stats
        WHERE window_games = ${ROLLING_WINDOW}
      ) AS total_teams
  `;

  if (guardProofResult(offRankProofResult)) {
    const offRow = offRankProofResult[0];
    const rank = parseInt(offRow.rank, 10);
    const totalTeams = parseInt(offRow.total_teams, 10);

    if (rank <= TOP_N_RANK) {
      const ordinal = (n: number) => {
        const s = ['th', 'st', 'nd', 'rd'];
        const v = n % 100;
        return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
      };

      const metricKey = `clippers_off_rank_last10_${asOfDate}`;
      const proofHash = makeProofHash(offRankProofSql, offRankProofParams, offRankProofResult);
      const importance = computeImportance('league_comparison', null, Date.now());

      results.push({
        scope: 'between_games',
        team_id: lacTeamId,
        game_id: null,
        player_id: null,
        season_id: null,
        category: 'league_comparison',
        headline: `Clippers rank ${ordinal(rank)} in offensive rating over the last ${ROLLING_WINDOW} games`,
        detail: `Rank ${rank}/${totalTeams} in the league (last ${ROLLING_WINDOW} games, as of ${asOfDate})`,
        importance,
        proof_sql: offRankProofSql,
        proof_params: offRankProofParams,
        proof_result: offRankProofResult,
        proof_hash: proofHash,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 2. clippers_net_rank: Clippers net rating rank (last 10 games)
  // -------------------------------------------------------------------------
  const netRankProofSql = `
    SELECT COUNT(*) + 1 AS rank,
           total.total_teams
    FROM rolling_team_stats rts
    CROSS JOIN (
      SELECT COUNT(DISTINCT team_id) AS total_teams
      FROM rolling_team_stats
      WHERE window_games = $2
    ) total
    WHERE rts.window_games = $2
      AND rts.net_rating > (
        SELECT net_rating
        FROM rolling_team_stats
        WHERE team_id = $1::bigint
          AND window_games = $2
      )
  `.trim();

  const netRankProofParams = {
    lac_team_id: lacTeamId,
    window_games: ROLLING_WINDOW,
    as_of_date: asOfDate,
  };

  const netRankProofResult = await sql<{
    rank: string;
    total_teams: string;
  }[]>`
    SELECT
      (
        SELECT (COUNT(*) + 1)::text
        FROM rolling_team_stats
        WHERE window_games = ${ROLLING_WINDOW}
          AND net_rating > (
            SELECT net_rating FROM rolling_team_stats
            WHERE team_id = ${lacTeamId}::bigint AND window_games = ${ROLLING_WINDOW}
            LIMIT 1
          )
      ) AS rank,
      (
        SELECT COUNT(DISTINCT team_id)::text
        FROM rolling_team_stats
        WHERE window_games = ${ROLLING_WINDOW}
      ) AS total_teams
  `;

  if (guardProofResult(netRankProofResult)) {
    const netRow = netRankProofResult[0];
    const rank = parseInt(netRow.rank, 10);
    const totalTeams = parseInt(netRow.total_teams, 10);

    if (rank <= TOP_N_RANK) {
      const ordinal = (n: number) => {
        const s = ['th', 'st', 'nd', 'rd'];
        const v = n % 100;
        return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
      };

      const metricKey = `clippers_net_rank_last10_${asOfDate}`;
      const proofHash = makeProofHash(netRankProofSql, netRankProofParams, netRankProofResult);
      const importance = computeImportance('league_comparison', null, Date.now());

      results.push({
        scope: 'between_games',
        team_id: lacTeamId,
        game_id: null,
        player_id: null,
        season_id: null,
        category: 'league_comparison',
        headline: `Clippers have the ${ordinal(rank)}-best net rating in the league over the last ${ROLLING_WINDOW} games`,
        detail: `Net rating rank ${rank}/${totalTeams} in the league (last ${ROLLING_WINDOW} games, as of ${asOfDate})`,
        importance,
        proof_sql: netRankProofSql,
        proof_params: netRankProofParams,
        proof_result: netRankProofResult,
        proof_hash: proofHash,
      });
    }
  }

  return results;
}
