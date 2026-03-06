// scripts/lib/insights/streaks.ts
// Batch insight category: player streaks.
// Exports generateStreakInsights() — returns InsightRow[] for:
//   1. scoring_streak: player scored >= 20pts in 3+ consecutive games
//   2. hot_shooting_streak: player shot >= 50% FG in 3+ consecutive games
import { sql } from '../db.js';
import {
  InsightRow,
  makeProofHash,
  guardProofResult,
  computeImportance,
} from './proof-utils.js';

const SCORING_THRESHOLD = 20;
const SHOOTING_THRESHOLD = 0.5;
const MIN_FG_ATTEMPTED = 8;
const MIN_STREAK_GAMES = 3;
const ACTIVE_STREAK_DAYS = 14;

export async function generateStreakInsights(): Promise<InsightRow[]> {
  const results: InsightRow[] = [];

  // Look up LAC team_id dynamically
  const [lacTeam] = await sql<{ team_id: string }[]>`
    SELECT team_id::text AS team_id FROM teams WHERE abbreviation = 'LAC'
  `;
  if (!lacTeam) return [];
  const lacTeamId = lacTeam.team_id;

  // -------------------------------------------------------------------------
  // 1. Scoring streak: player scored >= 20pts in 3+ consecutive games
  // -------------------------------------------------------------------------
  // Get all Clippers players who have at least MIN_STREAK_GAMES box score rows
  const lacPlayers = await sql<{ player_id: string; display_name: string }[]>`
    SELECT player_id, display_name FROM (
      SELECT DISTINCT p.player_id::text AS player_id, p.display_name
      FROM players p
      JOIN game_player_box_scores pb ON pb.player_id = p.player_id
      WHERE pb.team_id = ${lacTeamId}::bigint
    ) sub
    ORDER BY player_id
  `;

  for (const player of lacPlayers) {
    const streakRows = await sql<{
      streak_start: string;
      streak_end: string;
      streak_length: string;
    }[]>`
      WITH player_games AS (
        SELECT
          pb.player_id,
          pb.game_id,
          g.game_date,
          pb.points,
          (pb.points >= ${SCORING_THRESHOLD}) AS qualifies,
          ROW_NUMBER() OVER (PARTITION BY pb.player_id ORDER BY g.game_date) AS rn,
          ROW_NUMBER() OVER (
            PARTITION BY pb.player_id, (pb.points >= ${SCORING_THRESHOLD})::int
            ORDER BY g.game_date
          ) AS rn2
        FROM game_player_box_scores pb
        JOIN games g ON g.game_id = pb.game_id
        WHERE pb.player_id = ${player.player_id}::bigint
      )
      SELECT
        MIN(game_date)::text AS streak_start,
        MAX(game_date)::text AS streak_end,
        COUNT(*)::text AS streak_length
      FROM player_games
      WHERE qualifies = TRUE
      GROUP BY player_id, rn - rn2
      HAVING COUNT(*) >= ${MIN_STREAK_GAMES}
      ORDER BY streak_end DESC
      LIMIT 1
    `;

    if (streakRows.length === 0) continue;
    const streak = streakRows[0];
    const streakLength = parseInt(streak.streak_length, 10);

    // Run proof query: games in this streak with dates and points
    const proofSql = `
      WITH player_games AS (
        SELECT
          pb.player_id,
          pb.game_id,
          g.game_date,
          pb.points,
          (pb.points >= $2) AS qualifies,
          ROW_NUMBER() OVER (PARTITION BY pb.player_id ORDER BY g.game_date) AS rn,
          ROW_NUMBER() OVER (
            PARTITION BY pb.player_id, (pb.points >= $2)::int
            ORDER BY g.game_date
          ) AS rn2
        FROM game_player_box_scores pb
        JOIN games g ON g.game_id = pb.game_id
        WHERE pb.player_id = $1::bigint
      )
      SELECT game_date, points
      FROM player_games
      WHERE qualifies = TRUE
        AND game_date >= $3
        AND game_date <= $4
      ORDER BY game_date DESC
      LIMIT $5
    `.trim();

    const proofParams = {
      player_id: player.player_id,
      threshold: SCORING_THRESHOLD,
      streak_start: streak.streak_start,
      streak_end: streak.streak_end,
      min_games: MIN_STREAK_GAMES,
    };

    const proofResult = await sql<{ game_date: string; points: number }[]>`
      WITH player_games AS (
        SELECT
          pb.player_id,
          pb.game_id,
          g.game_date,
          pb.points,
          (pb.points >= ${SCORING_THRESHOLD}) AS qualifies,
          ROW_NUMBER() OVER (PARTITION BY pb.player_id ORDER BY g.game_date) AS rn,
          ROW_NUMBER() OVER (
            PARTITION BY pb.player_id, (pb.points >= ${SCORING_THRESHOLD})::int
            ORDER BY g.game_date
          ) AS rn2
        FROM game_player_box_scores pb
        JOIN games g ON g.game_id = pb.game_id
        WHERE pb.player_id = ${player.player_id}::bigint
      )
      SELECT game_date::text AS game_date, points
      FROM player_games
      WHERE qualifies = TRUE
        AND game_date >= ${streak.streak_start}::date
        AND game_date <= ${streak.streak_end}::date
      ORDER BY game_date DESC
      LIMIT ${streakLength}
    `;

    if (!guardProofResult(proofResult)) continue;

    const metricKey = `scoring_streak_20_${streakLength}`;
    const proofHash = makeProofHash(proofSql, proofParams, proofResult);

    // Determine scope: active if streak ended in last 14 days
    const streakEndMs = new Date(streak.streak_end).getTime();
    const ageDays = (Date.now() - streakEndMs) / 86_400_000;
    const scope: InsightRow['scope'] =
      ageDays <= ACTIVE_STREAK_DAYS ? 'between_games' : 'historical';

    const importance = computeImportance('streak', null, streakEndMs);

    results.push({
      scope,
      team_id: lacTeamId,
      game_id: null,
      player_id: player.player_id,
      season_id: null,
      category: 'streak',
      headline: `${player.display_name} has scored ${SCORING_THRESHOLD}+ in ${streakLength} straight games`,
      detail: `Scoring streak from ${streak.streak_start} to ${streak.streak_end}`,
      importance,
      proof_sql: proofSql,
      proof_params: proofParams,
      proof_result: proofResult,
      proof_hash: proofHash,
    });
  }

  // -------------------------------------------------------------------------
  // 2. Hot shooting streak: player shot >= 50% FG in 3+ consecutive games
  //    Filter on fg_attempted >= MIN_FG_ATTEMPTED to avoid low-volume noise
  // -------------------------------------------------------------------------
  for (const player of lacPlayers) {
    const streakRows = await sql<{
      streak_start: string;
      streak_end: string;
      streak_length: string;
    }[]>`
      WITH player_games AS (
        SELECT
          pb.player_id,
          pb.game_id,
          g.game_date,
          pb.fg_made,
          pb.fg_attempted,
          (pb.fg_attempted >= ${MIN_FG_ATTEMPTED}
            AND (pb.fg_made::float / pb.fg_attempted) >= ${SHOOTING_THRESHOLD}) AS qualifies,
          ROW_NUMBER() OVER (PARTITION BY pb.player_id ORDER BY g.game_date) AS rn,
          ROW_NUMBER() OVER (
            PARTITION BY pb.player_id,
              (pb.fg_attempted >= ${MIN_FG_ATTEMPTED}
                AND (pb.fg_made::float / pb.fg_attempted) >= ${SHOOTING_THRESHOLD})::int
            ORDER BY g.game_date
          ) AS rn2
        FROM game_player_box_scores pb
        JOIN games g ON g.game_id = pb.game_id
        WHERE pb.player_id = ${player.player_id}::bigint
          AND pb.fg_attempted > 0
      )
      SELECT
        MIN(game_date)::text AS streak_start,
        MAX(game_date)::text AS streak_end,
        COUNT(*)::text AS streak_length
      FROM player_games
      WHERE qualifies = TRUE
      GROUP BY player_id, rn - rn2
      HAVING COUNT(*) >= ${MIN_STREAK_GAMES}
      ORDER BY streak_end DESC
      LIMIT 1
    `;

    if (streakRows.length === 0) continue;
    const streak = streakRows[0];
    const streakLength = parseInt(streak.streak_length, 10);

    const proofSql = `
      WITH player_games AS (
        SELECT
          pb.player_id,
          pb.game_id,
          g.game_date,
          pb.fg_made,
          pb.fg_attempted,
          (pb.fg_attempted >= $2
            AND (pb.fg_made::float / pb.fg_attempted) >= $3) AS qualifies,
          ROW_NUMBER() OVER (PARTITION BY pb.player_id ORDER BY g.game_date) AS rn,
          ROW_NUMBER() OVER (
            PARTITION BY pb.player_id,
              (pb.fg_attempted >= $2
                AND (pb.fg_made::float / pb.fg_attempted) >= $3)::int
            ORDER BY g.game_date
          ) AS rn2
        FROM game_player_box_scores pb
        JOIN games g ON g.game_id = pb.game_id
        WHERE pb.player_id = $1::bigint
          AND pb.fg_attempted > 0
      )
      SELECT game_date, fg_made, fg_attempted,
             ROUND((fg_made::float / fg_attempted * 100)::numeric, 1) AS fg_pct
      FROM player_games
      WHERE qualifies = TRUE
        AND game_date >= $4
        AND game_date <= $5
      ORDER BY game_date DESC
      LIMIT $6
    `.trim();

    const proofParams = {
      player_id: player.player_id,
      min_fg_attempted: MIN_FG_ATTEMPTED,
      shooting_threshold: SHOOTING_THRESHOLD,
      streak_start: streak.streak_start,
      streak_end: streak.streak_end,
      min_games: MIN_STREAK_GAMES,
    };

    const proofResult = await sql<{
      game_date: string;
      fg_made: number;
      fg_attempted: number;
      fg_pct: string;
    }[]>`
      WITH player_games AS (
        SELECT
          pb.player_id,
          pb.game_id,
          g.game_date,
          pb.fg_made,
          pb.fg_attempted,
          (pb.fg_attempted >= ${MIN_FG_ATTEMPTED}
            AND (pb.fg_made::float / pb.fg_attempted) >= ${SHOOTING_THRESHOLD}) AS qualifies,
          ROW_NUMBER() OVER (PARTITION BY pb.player_id ORDER BY g.game_date) AS rn,
          ROW_NUMBER() OVER (
            PARTITION BY pb.player_id,
              (pb.fg_attempted >= ${MIN_FG_ATTEMPTED}
                AND (pb.fg_made::float / pb.fg_attempted) >= ${SHOOTING_THRESHOLD})::int
            ORDER BY g.game_date
          ) AS rn2
        FROM game_player_box_scores pb
        JOIN games g ON g.game_id = pb.game_id
        WHERE pb.player_id = ${player.player_id}::bigint
          AND pb.fg_attempted > 0
      )
      SELECT
        game_date::text AS game_date,
        fg_made,
        fg_attempted,
        ROUND((fg_made::float / fg_attempted * 100)::numeric, 1)::text AS fg_pct
      FROM player_games
      WHERE qualifies = TRUE
        AND game_date >= ${streak.streak_start}::date
        AND game_date <= ${streak.streak_end}::date
      ORDER BY game_date DESC
      LIMIT ${streakLength}
    `;

    if (!guardProofResult(proofResult)) continue;

    const metricKey = `hot_shooting_streak_${streakLength}`;
    const proofHash = makeProofHash(proofSql, proofParams, proofResult);

    const streakEndMs = new Date(streak.streak_end).getTime();
    const ageDays = (Date.now() - streakEndMs) / 86_400_000;
    const scope: InsightRow['scope'] =
      ageDays <= ACTIVE_STREAK_DAYS ? 'between_games' : 'historical';

    const importance = computeImportance('streak', null, streakEndMs);

    results.push({
      scope,
      team_id: lacTeamId,
      game_id: null,
      player_id: player.player_id,
      season_id: null,
      category: 'streak',
      headline: `${player.display_name} is shooting 50%+ in ${streakLength} straight games`,
      detail: `Hot shooting streak from ${streak.streak_start} to ${streak.streak_end}`,
      importance,
      proof_sql: proofSql,
      proof_params: proofParams,
      proof_result: proofResult,
      proof_hash: proofHash,
    });
  }

  return results;
}
