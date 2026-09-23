// scripts/lib/insights/league-comparisons.ts
// Batch insight category: league comparisons.
// Exports generateLeagueComparisonInsights() — returns InsightRow[] for:
//   1. clippers_off_rank: Clippers offensive rating rank in league (last 10 games)
//   2. clippers_net_rank: Clippers net rating rank in league (last 10 games)
//
// Only generates insights when Clippers rank in top 5 (rank <= 5) and at least
// MIN_LEAGUE_TEAMS teams have a current-season rolling row (see proof-utils).
import { sql } from '../db.js';
import {
  InsightRow,
  withInsightKey,
  guardProofResult,
  computeImportance,
  isReportableLeagueRank,
} from './proof-utils.js';

const ROLLING_WINDOW = 10;
const TOP_N_RANK = 5;

type RankMetric = 'off_rating' | 'net_rating';

// Rank among each team's LATEST rolling row in the current season. Without
// this restriction the comparison ran across every (season, as_of date) row in
// rolling_team_stats, producing ranks like "1/0" or ranks against stale rows.
function rankProofSql(metric: RankMetric): string {
  return `
    WITH latest AS (
      SELECT DISTINCT ON (team_id) team_id, ${metric} AS value, as_of_game_date
      FROM rolling_team_stats
      WHERE season_id = $2 AND window_games = $3 AND ${metric} IS NOT NULL
      ORDER BY team_id, as_of_game_date DESC
    )
    SELECT (SELECT COUNT(*) + 1 FROM latest l WHERE l.value > lac.value) AS rank,
           (SELECT COUNT(*) FROM latest) AS total_teams,
           lac.value,
           lac.as_of_game_date
    FROM latest lac
    WHERE lac.team_id = $1::bigint
  `.trim();
}

async function rankLatest(
  metric: RankMetric,
  lacTeamId: string,
  seasonId: number
): Promise<{ rank: string; total_teams: string; value: string; as_of_game_date: string }[]> {
  return sql<{ rank: string; total_teams: string; value: string; as_of_game_date: string }[]>`
    WITH latest AS (
      SELECT DISTINCT ON (team_id) team_id, ${sql(metric)} AS value, as_of_game_date
      FROM rolling_team_stats
      WHERE season_id = ${seasonId} AND window_games = ${ROLLING_WINDOW} AND ${sql(metric)} IS NOT NULL
      ORDER BY team_id, as_of_game_date DESC
    )
    SELECT (SELECT COUNT(*) + 1 FROM latest l WHERE l.value > lac.value)::text AS rank,
           (SELECT COUNT(*) FROM latest)::text AS total_teams,
           lac.value::text AS value,
           lac.as_of_game_date::text AS as_of_game_date
    FROM latest lac
    WHERE lac.team_id = ${lacTeamId}::bigint
  `;
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
};

export async function generateLeagueComparisonInsights(): Promise<InsightRow[]> {
  const results: InsightRow[] = [];

  // Look up LAC team_id dynamically
  const [lacTeam] = await sql<{ team_id: string }[]>`
    SELECT team_id::text AS team_id FROM teams WHERE abbreviation = 'LAC'
  `;
  if (!lacTeam) return [];
  const lacTeamId = lacTeam.team_id;

  // Current season = latest season with rolling stats
  const [seasonRow] = await sql<{ season_id: number | null }[]>`
    SELECT MAX(season_id) AS season_id FROM rolling_team_stats WHERE window_games = ${ROLLING_WINDOW}
  `;
  const seasonId = seasonRow?.season_id ?? null;
  if (seasonId === null) return [];

  const metrics: Array<{
    metric: RankMetric;
    metricKey: string;
    headline: (rank: number) => string;
    detail: (rank: number, total: number, asOf: string) => string;
  }> = [
    {
      // 1. clippers_off_rank: Clippers offensive rating rank (last 10 games)
      metric: 'off_rating',
      metricKey: 'clippers_off_rank_last10',
      headline: (rank) =>
        `Clippers rank ${ordinal(rank)} in offensive rating over the last ${ROLLING_WINDOW} games`,
      detail: (rank, total, asOf) =>
        `Rank ${rank}/${total} in the league (last ${ROLLING_WINDOW} games, as of ${asOf})`,
    },
    {
      // 2. clippers_net_rank: Clippers net rating rank (last 10 games)
      metric: 'net_rating',
      metricKey: 'clippers_net_rank_last10',
      headline: (rank) =>
        `Clippers have the ${ordinal(rank)}-best net rating in the league over the last ${ROLLING_WINDOW} games`,
      detail: (rank, total, asOf) =>
        `Net rating rank ${rank}/${total} in the league (last ${ROLLING_WINDOW} games, as of ${asOf})`,
    },
  ];

  for (const m of metrics) {
    const proofResult = await rankLatest(m.metric, lacTeamId, seasonId);
    if (!guardProofResult(proofResult)) continue; // LAC has no rolling row this season

    const row = proofResult[0];
    const rank = parseInt(row.rank, 10);
    const totalTeams = parseInt(row.total_teams, 10);
    if (!isReportableLeagueRank(rank, totalTeams, TOP_N_RANK)) continue;

    const proofParams = {
      lac_team_id: lacTeamId,
      season_id: seasonId,
      window_games: ROLLING_WINDOW,
    };

    results.push(withInsightKey({
      scope: 'between_games',
      team_id: lacTeamId,
      game_id: null,
      player_id: null,
      season_id: seasonId,
      category: 'league_comparison',
      headline: m.headline(rank),
      detail: m.detail(rank, totalTeams, row.as_of_game_date),
      importance: computeImportance('league_comparison', null, Date.now()),
      proof_sql: rankProofSql(m.metric),
      proof_params: proofParams,
      proof_result: proofResult,
    }, m.metricKey)); // no date in the key — one row per metric per season, updated nightly
  }

  return results;
}
