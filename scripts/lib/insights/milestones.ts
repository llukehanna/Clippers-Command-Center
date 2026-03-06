// scripts/lib/insights/milestones.ts
// Batch insight category: player milestones.
// Exports generateMilestoneInsights() — returns InsightRow[] for:
//   1. season_points_milestone: player crossed a round-number season points total
//   2. games_played_milestone: player played their N00th career game
import { sql } from '../db.js';
import {
  InsightRow,
  makeProofHash,
  guardProofResult,
  computeImportance,
} from './proof-utils.js';

const SEASON_POINTS_THRESHOLDS = [500, 750, 1000, 1250, 1500, 2000];
const GAMES_PLAYED_THRESHOLDS = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

export async function generateMilestoneInsights(): Promise<InsightRow[]> {
  const results: InsightRow[] = [];

  // Look up LAC team_id dynamically
  const [lacTeam] = await sql<{ team_id: string }[]>`
    SELECT team_id::text AS team_id FROM teams WHERE abbreviation = 'LAC'
  `;
  if (!lacTeam) return [];
  const lacTeamId = lacTeam.team_id;

  // Get current season (most recent season in DB)
  const [currentSeasonRow] = await sql<{ season_id: number }[]>`
    SELECT season_id FROM seasons ORDER BY year DESC LIMIT 1
  `;
  if (!currentSeasonRow) return [];
  const currentSeasonId = currentSeasonRow.season_id;

  // Get all Clippers players
  const lacPlayers = await sql<{ player_id: string; display_name: string }[]>`
    SELECT DISTINCT p.player_id::text AS player_id, p.display_name
    FROM players p
    JOIN game_player_box_scores pb ON pb.player_id = p.player_id
    WHERE p.team_id = ${lacTeamId}::bigint
    ORDER BY p.player_id
  `;

  // -------------------------------------------------------------------------
  // 1. Season points milestone: player crossed a round-number total this season
  // -------------------------------------------------------------------------
  const seasonPointsProofSql = `
    SELECT SUM(pb.points)::int AS total_points, $3::int AS milestone_threshold
    FROM game_player_box_scores pb
    JOIN games g ON g.game_id = pb.game_id
    WHERE pb.player_id = $1::bigint
      AND g.season_id = $2
  `.trim();

  for (const player of lacPlayers) {
    const [pointsRow] = await sql<{ total_points: number | null }[]>`
      SELECT SUM(pb.points)::int AS total_points
      FROM game_player_box_scores pb
      JOIN games g ON g.game_id = pb.game_id
      WHERE pb.player_id = ${player.player_id}::bigint
        AND g.season_id = ${currentSeasonId}
    `;

    if (!pointsRow || pointsRow.total_points == null) continue;
    const totalPoints = pointsRow.total_points;

    // Find the highest milestone threshold the player has crossed
    const crossedThresholds = SEASON_POINTS_THRESHOLDS.filter(
      (t) => totalPoints >= t
    );
    if (crossedThresholds.length === 0) continue;
    const highestCrossed = Math.max(...crossedThresholds);

    const proofParams = {
      player_id: player.player_id,
      season_id: currentSeasonId,
      milestone_threshold: highestCrossed,
    };

    const proofResult = await sql<{
      total_points: number;
      milestone_threshold: number;
    }[]>`
      SELECT SUM(pb.points)::int AS total_points, ${highestCrossed}::int AS milestone_threshold
      FROM game_player_box_scores pb
      JOIN games g ON g.game_id = pb.game_id
      WHERE pb.player_id = ${player.player_id}::bigint
        AND g.season_id = ${currentSeasonId}
    `;

    if (!guardProofResult(proofResult)) continue;

    const metricKey = `season_points_${highestCrossed}_${currentSeasonId}`;
    const proofHash = makeProofHash(seasonPointsProofSql, proofParams, proofResult);

    const importance = computeImportance('milestone', null, Date.now());

    results.push({
      scope: 'between_games',
      team_id: lacTeamId,
      game_id: null,
      player_id: player.player_id,
      season_id: currentSeasonId,
      category: 'milestone',
      headline: `${player.display_name} has reached ${highestCrossed.toLocaleString()} season points`,
      detail: `Total season points: ${totalPoints.toLocaleString()} (season ${currentSeasonId})`,
      importance,
      proof_sql: seasonPointsProofSql,
      proof_params: proofParams,
      proof_result: proofResult,
      proof_hash: proofHash,
    });
  }

  // -------------------------------------------------------------------------
  // 2. Games played milestone: player played their N00th career game
  // -------------------------------------------------------------------------
  const gamesPlayedProofSql = `
    SELECT COUNT(*)::int AS career_games, $2::int AS milestone_threshold
    FROM game_player_box_scores pb
    WHERE pb.player_id = $1::bigint
  `.trim();

  for (const player of lacPlayers) {
    const [gamesRow] = await sql<{ career_games: number }[]>`
      SELECT COUNT(*)::int AS career_games
      FROM game_player_box_scores pb
      WHERE pb.player_id = ${player.player_id}::bigint
    `;

    if (!gamesRow || gamesRow.career_games == null) continue;
    const careerGames = gamesRow.career_games;

    // Find the highest milestone threshold the player has crossed
    const crossedThresholds = GAMES_PLAYED_THRESHOLDS.filter(
      (t) => careerGames >= t
    );
    if (crossedThresholds.length === 0) continue;
    const highestCrossed = Math.max(...crossedThresholds);

    const proofParams = {
      player_id: player.player_id,
      milestone_threshold: highestCrossed,
    };

    const proofResult = await sql<{
      career_games: number;
      milestone_threshold: number;
    }[]>`
      SELECT COUNT(*)::int AS career_games, ${highestCrossed}::int AS milestone_threshold
      FROM game_player_box_scores pb
      WHERE pb.player_id = ${player.player_id}::bigint
    `;

    if (!guardProofResult(proofResult)) continue;

    const metricKey = `games_played_${highestCrossed}`;
    const proofHash = makeProofHash(gamesPlayedProofSql, proofParams, proofResult);

    const importance = computeImportance('milestone', null, Date.now());

    results.push({
      scope: 'between_games',
      team_id: lacTeamId,
      game_id: null,
      player_id: player.player_id,
      season_id: null,
      category: 'milestone',
      headline: `${player.display_name} has played ${highestCrossed.toLocaleString()}+ career games`,
      detail: `Career games in DB: ${careerGames}`,
      importance,
      proof_sql: gamesPlayedProofSql,
      proof_params: proofParams,
      proof_result: proofResult,
      proof_hash: proofHash,
    });
  }

  return results;
}
