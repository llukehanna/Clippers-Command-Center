// scripts/lib/insights/rare-events.ts
// Batch insight category: rare statistical events.
// Exports generateRareEventInsights() — returns InsightRow[] for:
//   1. rare_points: Clippers player scoring performance in top 5% across 3-season DB
//   2. rare_assists: Clippers player assists performance in top 5% across 3-season DB
//
// IMPORTANT: Uses subquery to avoid PostgreSQL 42P10 DISTINCT + ORDER BY cast restriction.
import { sql } from '../db.js';
import {
  InsightRow,
  makeProofHash,
  guardProofResult,
  computeImportance,
} from './proof-utils.js';

const PCT_RANK_THRESHOLD = 0.95;
const SEASON_IDS = [2022, 2023, 2024];
const TOP_N_RESULTS = 10;

export async function generateRareEventInsights(): Promise<InsightRow[]> {
  const results: InsightRow[] = [];

  // Look up LAC team_id dynamically
  const [lacTeam] = await sql<{ team_id: string }[]>`
    SELECT team_id::text AS team_id FROM teams WHERE abbreviation = 'LAC'
  `;
  if (!lacTeam) return [];
  const lacTeamId = lacTeam.team_id;

  // -------------------------------------------------------------------------
  // 1. rare_points: top 5% scoring performances by Clippers players
  // -------------------------------------------------------------------------
  const rarePointsProofSql = `
    SELECT sub.player_id, sub.game_id, sub.points, sub.pct_rank
    FROM (
      SELECT pb.player_id::text AS player_id, pb.game_id::text AS game_id,
             pb.points,
             PERCENT_RANK() OVER (ORDER BY pb.points ASC) AS pct_rank
      FROM game_player_box_scores pb
      JOIN games g ON g.game_id = pb.game_id
      WHERE g.season_id IN (2022, 2023, 2024)
    ) sub
    JOIN players p ON p.player_id = sub.player_id::bigint
    WHERE sub.pct_rank >= $2
      AND p.team_id = $1::bigint
    ORDER BY sub.pct_rank DESC, sub.game_id DESC
    LIMIT $3
  `.trim();

  const rarePointsRows = await sql<{
    player_id: string;
    game_id: string;
    points: number;
    pct_rank: string;
    display_name: string;
    game_date: string;
  }[]>`
    SELECT sub.player_id, sub.game_id, sub.points, sub.pct_rank,
           pl.display_name, g.game_date::text AS game_date
    FROM (
      SELECT pb.player_id::text AS player_id, pb.game_id::text AS game_id,
             pb.points,
             PERCENT_RANK() OVER (ORDER BY pb.points ASC) AS pct_rank
      FROM game_player_box_scores pb
      JOIN games g ON g.game_id = pb.game_id
      WHERE g.season_id = ANY(${SEASON_IDS})
    ) sub
    JOIN players pl ON pl.player_id = sub.player_id::bigint
    JOIN games g ON g.game_id = sub.game_id::bigint
    WHERE sub.pct_rank >= ${PCT_RANK_THRESHOLD}
      AND pl.team_id = ${lacTeamId}::bigint
    ORDER BY sub.pct_rank DESC, sub.game_id DESC
    LIMIT ${TOP_N_RESULTS}
  `;

  for (const row of rarePointsRows) {
    const pctRank = parseFloat(row.pct_rank as unknown as string);
    const pctRankInt = Math.round(pctRank * 100);
    const gameDateMs = new Date(row.game_date).getTime();

    const proofParams = {
      lac_team_id: lacTeamId,
      pct_rank_threshold: PCT_RANK_THRESHOLD,
      limit: TOP_N_RESULTS,
    };

    const proofResult = await sql<{
      player_id: string;
      game_id: string;
      points: number;
      pct_rank: string;
    }[]>`
      SELECT sub.player_id, sub.game_id, sub.points::int AS points, sub.pct_rank::text AS pct_rank
      FROM (
        SELECT pb.player_id::text AS player_id, pb.game_id::text AS game_id,
               pb.points,
               PERCENT_RANK() OVER (ORDER BY pb.points ASC) AS pct_rank
        FROM game_player_box_scores pb
        JOIN games g ON g.game_id = pb.game_id
        WHERE g.season_id = ANY(${SEASON_IDS})
      ) sub
      JOIN players p ON p.player_id = sub.player_id::bigint
      WHERE sub.pct_rank >= ${PCT_RANK_THRESHOLD}
        AND sub.player_id = ${row.player_id}
        AND sub.game_id = ${row.game_id}
        AND p.team_id = ${lacTeamId}::bigint
      ORDER BY sub.pct_rank DESC
      LIMIT 1
    `;

    if (!guardProofResult(proofResult)) continue;

    const metricKey = `rare_points_${row.player_id}_${row.game_id}`;
    const proofHash = makeProofHash(rarePointsProofSql, proofParams, proofResult);

    const importance = computeImportance('rare_event', pctRankInt, gameDateMs);

    results.push({
      scope: 'historical',
      team_id: lacTeamId,
      game_id: row.game_id,
      player_id: row.player_id,
      season_id: null,
      category: 'rare_event',
      headline: `${row.display_name}'s ${row.points}-point game ranks in the top 5% of all performances in this 3-season stretch`,
      detail: `Percentile rank: top ${100 - pctRankInt}% (${row.game_date})`,
      importance,
      proof_sql: rarePointsProofSql,
      proof_params: proofParams,
      proof_result: proofResult,
      proof_hash: proofHash,
    });
  }

  // -------------------------------------------------------------------------
  // 2. rare_assists: top 5% assists performances by Clippers players
  // -------------------------------------------------------------------------
  const rareAssistsProofSql = `
    SELECT sub.player_id, sub.game_id, sub.assists, sub.pct_rank
    FROM (
      SELECT pb.player_id::text AS player_id, pb.game_id::text AS game_id,
             pb.assists,
             PERCENT_RANK() OVER (ORDER BY pb.assists ASC) AS pct_rank
      FROM game_player_box_scores pb
      JOIN games g ON g.game_id = pb.game_id
      WHERE g.season_id IN (2022, 2023, 2024)
    ) sub
    JOIN players p ON p.player_id = sub.player_id::bigint
    WHERE sub.pct_rank >= $2
      AND p.team_id = $1::bigint
    ORDER BY sub.pct_rank DESC, sub.game_id DESC
    LIMIT $3
  `.trim();

  const rareAssistsRows = await sql<{
    player_id: string;
    game_id: string;
    assists: number;
    pct_rank: string;
    display_name: string;
    game_date: string;
  }[]>`
    SELECT sub.player_id, sub.game_id, sub.assists, sub.pct_rank,
           pl.display_name, g.game_date::text AS game_date
    FROM (
      SELECT pb.player_id::text AS player_id, pb.game_id::text AS game_id,
             pb.assists,
             PERCENT_RANK() OVER (ORDER BY pb.assists ASC) AS pct_rank
      FROM game_player_box_scores pb
      JOIN games g ON g.game_id = pb.game_id
      WHERE g.season_id = ANY(${SEASON_IDS})
    ) sub
    JOIN players pl ON pl.player_id = sub.player_id::bigint
    JOIN games g ON g.game_id = sub.game_id::bigint
    WHERE sub.pct_rank >= ${PCT_RANK_THRESHOLD}
      AND pl.team_id = ${lacTeamId}::bigint
    ORDER BY sub.pct_rank DESC, sub.game_id DESC
    LIMIT ${TOP_N_RESULTS}
  `;

  for (const row of rareAssistsRows) {
    const pctRank = parseFloat(row.pct_rank as unknown as string);
    const pctRankInt = Math.round(pctRank * 100);
    const gameDateMs = new Date(row.game_date).getTime();

    const proofParams = {
      lac_team_id: lacTeamId,
      pct_rank_threshold: PCT_RANK_THRESHOLD,
      limit: TOP_N_RESULTS,
    };

    const proofResult = await sql<{
      player_id: string;
      game_id: string;
      assists: number;
      pct_rank: string;
    }[]>`
      SELECT sub.player_id, sub.game_id, sub.assists::int AS assists, sub.pct_rank::text AS pct_rank
      FROM (
        SELECT pb.player_id::text AS player_id, pb.game_id::text AS game_id,
               pb.assists,
               PERCENT_RANK() OVER (ORDER BY pb.assists ASC) AS pct_rank
        FROM game_player_box_scores pb
        JOIN games g ON g.game_id = pb.game_id
        WHERE g.season_id = ANY(${SEASON_IDS})
      ) sub
      JOIN players p ON p.player_id = sub.player_id::bigint
      WHERE sub.pct_rank >= ${PCT_RANK_THRESHOLD}
        AND sub.player_id = ${row.player_id}
        AND sub.game_id = ${row.game_id}
        AND p.team_id = ${lacTeamId}::bigint
      ORDER BY sub.pct_rank DESC
      LIMIT 1
    `;

    if (!guardProofResult(proofResult)) continue;

    const metricKey = `rare_assists_${row.player_id}_${row.game_id}`;
    const proofHash = makeProofHash(rareAssistsProofSql, proofParams, proofResult);

    const importance = computeImportance('rare_event', pctRankInt, gameDateMs);

    results.push({
      scope: 'historical',
      team_id: lacTeamId,
      game_id: row.game_id,
      player_id: row.player_id,
      season_id: null,
      category: 'rare_event',
      headline: `${row.display_name}'s ${row.assists}-assist game ranks in the top 5% of all performances in this 3-season stretch`,
      detail: `Percentile rank: top ${100 - pctRankInt}% (${row.game_date})`,
      importance,
      proof_sql: rareAssistsProofSql,
      proof_params: proofParams,
      proof_result: proofResult,
      proof_hash: proofHash,
    });
  }

  return results;
}
