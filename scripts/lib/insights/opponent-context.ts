// scripts/lib/insights/opponent-context.ts
// Batch insight category: opponent context.
// Exports generateOpponentContextInsights() — returns InsightRow[] for:
//   1. opp_def_rating: opponent defensive rating and league rank (rolling last 10)
//   2. h2h_record: head-to-head record between LAC and the opponent this season
//
// "Upcoming game": next game where status != 'final' and LAC is involved.
// Falls back to most recently completed game if no upcoming game found.
import { sql } from '../db.js';
import {
  InsightRow,
  makeProofHash,
  guardProofResult,
  computeImportance,
} from './proof-utils.js';

const ROLLING_WINDOW = 10;

export async function generateOpponentContextInsights(): Promise<InsightRow[]> {
  const results: InsightRow[] = [];

  // Look up LAC team_id dynamically
  const [lacTeam] = await sql<{ team_id: string }[]>`
    SELECT team_id::text AS team_id FROM teams WHERE abbreviation = 'LAC'
  `;
  if (!lacTeam) return [];
  const lacTeamId = lacTeam.team_id;

  // Find upcoming game (status != 'final') or fall back to most recent completed
  const [upcomingGame] = await sql<{
    game_id: string;
    home_team_id: string;
    away_team_id: string;
    game_date: string;
    season_id: number;
  }[]>`
    SELECT game_id::text AS game_id,
           home_team_id::text AS home_team_id,
           away_team_id::text AS away_team_id,
           game_date::text AS game_date,
           season_id
    FROM games
    WHERE (home_team_id = ${lacTeamId}::bigint OR away_team_id = ${lacTeamId}::bigint)
      AND status != 'final'
    ORDER BY game_date ASC
    LIMIT 1
  `;

  let targetGame: {
    game_id: string;
    home_team_id: string;
    away_team_id: string;
    game_date: string;
    season_id: number;
  } | undefined = upcomingGame;

  if (!targetGame) {
    // Fall back to most recent completed game
    const [recentGame] = await sql<{
      game_id: string;
      home_team_id: string;
      away_team_id: string;
      game_date: string;
      season_id: number;
    }[]>`
      SELECT game_id::text AS game_id,
             home_team_id::text AS home_team_id,
             away_team_id::text AS away_team_id,
             game_date::text AS game_date,
             season_id
      FROM games
      WHERE (home_team_id = ${lacTeamId}::bigint OR away_team_id = ${lacTeamId}::bigint)
        AND status = 'final'
      ORDER BY game_date DESC
      LIMIT 1
    `;
    targetGame = recentGame;
  }

  if (!targetGame) return [];

  // Determine opponent
  const oppTeamId =
    targetGame.home_team_id === lacTeamId
      ? targetGame.away_team_id
      : targetGame.home_team_id;

  const [oppTeam] = await sql<{ full_name: string }[]>`
    SELECT (city || ' ' || name) AS full_name FROM teams WHERE team_id = ${oppTeamId}::bigint
  `;
  const oppName = oppTeam?.full_name ?? 'Opponent';
  const gameDateMs = new Date(targetGame.game_date).getTime();

  // -------------------------------------------------------------------------
  // 1. opp_def_rating: opponent defensive rating + league rank (rolling 10)
  // -------------------------------------------------------------------------
  const defRatingProofSql = `
    SELECT rts.def_rating,
           (SELECT COUNT(*) + 1
            FROM rolling_team_stats r2
            WHERE r2.window_games = $2
              AND r2.def_rating < rts.def_rating) AS def_rank,
           (SELECT COUNT(DISTINCT team_id) FROM rolling_team_stats WHERE window_games = $2) AS total_teams
    FROM rolling_team_stats rts
    WHERE rts.team_id = $1::bigint
      AND rts.window_games = $2
  `.trim();

  const defProofParams = {
    opp_team_id: oppTeamId,
    window_games: ROLLING_WINDOW,
  };

  const defProofResult = await sql<{
    def_rating: string;
    def_rank: string;
    total_teams: string;
  }[]>`
    SELECT rts.def_rating::text AS def_rating,
           (SELECT COUNT(*) + 1
            FROM rolling_team_stats r2
            WHERE r2.window_games = ${ROLLING_WINDOW}
              AND r2.def_rating < rts.def_rating)::text AS def_rank,
           (SELECT COUNT(DISTINCT team_id) FROM rolling_team_stats WHERE window_games = ${ROLLING_WINDOW})::text AS total_teams
    FROM rolling_team_stats rts
    WHERE rts.team_id = ${oppTeamId}::bigint
      AND rts.window_games = ${ROLLING_WINDOW}
  `;

  if (guardProofResult(defProofResult)) {
    const defRow = defProofResult[0];
    const defRank = parseInt(defRow.def_rank, 10);
    const totalTeams = parseInt(defRow.total_teams, 10);
    const avgDefRating = parseFloat(defRow.def_rating);

    const ordinal = (n: number) => {
      const s = ['th', 'st', 'nd', 'rd'];
      const v = n % 100;
      return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
    };

    const metricKey = `opp_def_rating_${oppTeamId}_${targetGame.game_id}`;
    const proofHash = makeProofHash(defRatingProofSql, defProofParams, defProofResult);
    const importance = computeImportance('opponent_context', null, gameDateMs);

    results.push({
      scope: 'between_games',
      team_id: lacTeamId,
      game_id: targetGame.game_id,
      player_id: null,
      season_id: targetGame.season_id,
      category: 'opponent_context',
      headline: `${oppName} has the ${ordinal(defRank)}-best defense in the league (last ${ROLLING_WINDOW} games)`,
      detail: `Def rating: ${avgDefRating.toFixed(1)} (rank ${defRank}/${totalTeams} — lower is better)`,
      importance,
      proof_sql: defRatingProofSql,
      proof_params: defProofParams,
      proof_result: defProofResult,
      proof_hash: proofHash,
    });
  }

  // -------------------------------------------------------------------------
  // 2. h2h_record: head-to-head record between LAC and the opponent this season
  // -------------------------------------------------------------------------
  const h2hProofSql = `
    SELECT
      COUNT(*) FILTER (WHERE
        (g.home_team_id = $1::bigint AND g.home_score > g.away_score)
        OR (g.away_team_id = $1::bigint AND g.away_score > g.home_score)
      )::int AS clippers_wins,
      COUNT(*) FILTER (WHERE
        (g.home_team_id = $2::bigint AND g.home_score > g.away_score)
        OR (g.away_team_id = $2::bigint AND g.away_score > g.home_score)
      )::int AS opp_wins,
      COUNT(*)::int AS total_games
    FROM games g
    WHERE ((g.home_team_id = $1::bigint AND g.away_team_id = $2::bigint)
        OR (g.home_team_id = $2::bigint AND g.away_team_id = $1::bigint))
      AND g.season_id = $3
      AND g.status = 'final'
  `.trim();

  const h2hProofParams = {
    lac_team_id: lacTeamId,
    opp_team_id: oppTeamId,
    season_id: targetGame.season_id,
  };

  const h2hProofResult = await sql<{
    clippers_wins: number;
    opp_wins: number;
    total_games: number;
  }[]>`
    SELECT
      COUNT(*) FILTER (WHERE
        (g.home_team_id = ${lacTeamId}::bigint AND g.home_score > g.away_score)
        OR (g.away_team_id = ${lacTeamId}::bigint AND g.away_score > g.home_score)
      )::int AS clippers_wins,
      COUNT(*) FILTER (WHERE
        (g.home_team_id = ${oppTeamId}::bigint AND g.home_score > g.away_score)
        OR (g.away_team_id = ${oppTeamId}::bigint AND g.away_score > g.home_score)
      )::int AS opp_wins,
      COUNT(*)::int AS total_games
    FROM games g
    WHERE ((g.home_team_id = ${lacTeamId}::bigint AND g.away_team_id = ${oppTeamId}::bigint)
        OR (g.home_team_id = ${oppTeamId}::bigint AND g.away_team_id = ${lacTeamId}::bigint))
      AND g.season_id = ${targetGame.season_id}
      AND g.status = 'final'
  `;

  if (guardProofResult(h2hProofResult)) {
    const h2hRow = h2hProofResult[0];

    // Only generate if there are completed H2H games
    if (h2hRow.total_games > 0) {
      const metricKey = `h2h_${lacTeamId}_${oppTeamId}_${targetGame.season_id}`;
      const proofHash = makeProofHash(h2hProofSql, h2hProofParams, h2hProofResult);
      const importance = computeImportance('opponent_context', null, gameDateMs);

      results.push({
        scope: 'between_games',
        team_id: lacTeamId,
        game_id: targetGame.game_id,
        player_id: null,
        season_id: targetGame.season_id,
        category: 'opponent_context',
        headline: `Clippers are ${h2hRow.clippers_wins}-${h2hRow.opp_wins} vs ${oppName} this season`,
        detail: `Head-to-head in ${targetGame.season_id} season: ${h2hRow.total_games} game(s) played`,
        importance,
        proof_sql: h2hProofSql,
        proof_params: h2hProofParams,
        proof_result: h2hProofResult,
        proof_hash: proofHash,
      });
    }
  }

  return results;
}
