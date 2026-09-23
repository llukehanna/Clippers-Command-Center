// scripts/lib/insights/league-comparisons.ts
// Batch insight category: league comparisons. Needs league-wide box scores
// (scripts/sync-league-games.ts); every rank requires MIN_LEAGUE_TEAMS teams.
//
//   1. Team season ranks  — Clippers' rank in off/def/net rating, eFG%, TOV%,
//                           REB% and pace; emitted when top 5 or bottom 5.
//   2. Standings          — record and conference/league rank.
//   3. Recent form        — last-10-game off/net rating rank (current season
//                           only; top 5).
//   4. Player league ranks — Clippers players among every qualified NBA
//                           player in PPG/RPG/APG/3PM/TS%.
import {
  InsightRow,
  withInsightKey,
  guardProofResult,
  computeImportance,
  isReportableLeagueRank,
  MIN_LEAGUE_TEAMS,
  ordinal,
  rankPercentile,
  fmt,
  pct,
} from './proof-utils.js';
import { clippersSeasonPlayers, InsightContext, REGULAR_SEASON, runProof } from './context.js';

/** Team must have played this many regular-season games to be ranked. */
const MIN_TEAM_GAMES = 5;

// ── 1. Team season ranks ─────────────────────────────────────────────────────

interface TeamMetric {
  key: string;
  label: string;          // "offensive rating"
  /** SQL aggregate over advanced_team_game_stats `a` (per team, per season). */
  aggregate: string;
  higherIsBetter: boolean;
  format: (v: number) => string;
}

// Ratings are possession-weighted (points per 100 possessions over the whole
// season), not averages of per-game ratings.
const TEAM_METRICS: TeamMetric[] = [
  { key: 'off_rating', label: 'offensive rating', higherIsBetter: true,
    aggregate: 'SUM(a.off_rating * a.possessions) / NULLIF(SUM(a.possessions), 0)', format: (v) => fmt(v) },
  { key: 'def_rating', label: 'defensive rating', higherIsBetter: false,
    aggregate: 'SUM(a.def_rating * a.possessions) / NULLIF(SUM(a.possessions), 0)', format: (v) => fmt(v) },
  { key: 'net_rating', label: 'net rating', higherIsBetter: true,
    aggregate: 'SUM(a.net_rating * a.possessions) / NULLIF(SUM(a.possessions), 0)',
    format: (v) => (v > 0 ? `+${fmt(v)}` : fmt(v)) },
  { key: 'efg_pct', label: 'effective FG%', higherIsBetter: true, aggregate: 'AVG(a.efg_pct)', format: (v) => pct(v) },
  { key: 'tov_pct', label: 'turnover rate', higherIsBetter: false, aggregate: 'AVG(a.tov_pct)', format: (v) => pct(v) },
  { key: 'reb_pct', label: 'rebounding rate', higherIsBetter: true, aggregate: 'AVG(a.reb_pct)', format: (v) => pct(v) },
  { key: 'pace', label: 'pace', higherIsBetter: true, aggregate: 'AVG(a.pace)', format: (v) => fmt(v) },
];

function teamRankSql(m: TeamMetric): string {
  return `
    WITH team_values AS (
      SELECT a.team_id, (${m.aggregate})::float8 AS value, COUNT(*)::int AS games
      FROM advanced_team_game_stats a
      JOIN games g ON g.game_id = a.game_id
      WHERE g.season_id = $1::int AND ${REGULAR_SEASON}
      GROUP BY a.team_id
      HAVING COUNT(*) >= $2::int
    ), ranked AS (
      SELECT team_id, value, games,
             RANK() OVER (ORDER BY value ${m.higherIsBetter ? 'DESC' : 'ASC'})::int AS rank,
             COUNT(*) OVER ()::int AS total_teams
      FROM team_values
      WHERE value IS NOT NULL
    )
    SELECT team_id::text AS team_id, value, games, rank, total_teams
    FROM ranked
    WHERE team_id = $3::bigint
  `.trim();
}

// ── 2. Standings ─────────────────────────────────────────────────────────────

const STANDINGS_SQL = `
  WITH results AS (
    SELECT g.home_team_id AS team_id, (g.home_score > g.away_score) AS won
    FROM games g
    WHERE g.season_id = $1::int AND ${REGULAR_SEASON}
      AND g.status = 'final' AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
    UNION ALL
    SELECT g.away_team_id, (g.away_score > g.home_score)
    FROM games g
    WHERE g.season_id = $1::int AND ${REGULAR_SEASON}
      AND g.status = 'final' AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
  ), records AS (
    SELECT r.team_id, t.conference,
           COUNT(*) FILTER (WHERE r.won)::int AS wins,
           COUNT(*) FILTER (WHERE NOT r.won)::int AS losses
    FROM results r
    JOIN teams t ON t.team_id = r.team_id
    GROUP BY r.team_id, t.conference
  ), ranked AS (
    SELECT team_id, conference, wins, losses,
           RANK() OVER (PARTITION BY conference ORDER BY wins::float8 / (wins + losses) DESC)::int AS conf_rank,
           COUNT(*) OVER (PARTITION BY conference)::int AS conf_teams,
           RANK() OVER (ORDER BY wins::float8 / (wins + losses) DESC)::int AS league_rank,
           COUNT(*) OVER ()::int AS league_teams
    FROM records
  )
  SELECT team_id::text AS team_id, conference, wins, losses, conf_rank, conf_teams, league_rank, league_teams
  FROM ranked
  WHERE team_id = $2::bigint
`.trim();

// ── 3. Recent form (rolling last 10) ─────────────────────────────────────────

const ROLLING_WINDOW = 10;

function rollingRankSql(metric: 'off_rating' | 'net_rating'): string {
  return `
    WITH latest AS (
      SELECT DISTINCT ON (team_id) team_id, ${metric}::float8 AS value, as_of_game_date
      FROM rolling_team_stats
      WHERE season_id = $1::int AND window_games = $2::int AND ${metric} IS NOT NULL
      ORDER BY team_id, as_of_game_date DESC
    )
    SELECT (SELECT COUNT(*) + 1 FROM latest l WHERE l.value > lac.value)::int AS rank,
           (SELECT COUNT(*) FROM latest)::int AS total_teams,
           lac.value,
           lac.as_of_game_date::text AS as_of_game_date
    FROM latest lac
    WHERE lac.team_id = $3::bigint
  `.trim();
}

// ── 4. Player league ranks ───────────────────────────────────────────────────

interface PlayerMetric {
  key: string;
  label: string;          // "scoring"
  /** SQL over game_player_box_scores `pb`, grouped per player. NULL = unqualified. */
  expr: string;
  format: (v: number) => string;
  topN: number;
}

const PLAYER_METRICS: PlayerMetric[] = [
  { key: 'ppg', label: 'scoring', expr: 'AVG(pb.points)', format: (v) => `${fmt(v)} PPG`, topN: 25 },
  { key: 'rpg', label: 'rebounding', expr: 'AVG(pb.rebounds)', format: (v) => `${fmt(v)} RPG`, topN: 20 },
  { key: 'apg', label: 'assists', expr: 'AVG(pb.assists)', format: (v) => `${fmt(v)} APG`, topN: 20 },
  { key: 'fg3m', label: 'made threes', expr: 'SUM(pb.fg3_made)', format: (v) => `${Math.round(v)} 3PM`, topN: 20 },
  { key: 'stocks', label: 'steals + blocks', expr: 'AVG(pb.steals + pb.blocks)', format: (v) => `${fmt(v)} per game`, topN: 15 },
  {
    // True shooting, qualified at 10+ shot attempts per game.
    key: 'ts_pct', label: 'true shooting',
    expr: `CASE WHEN AVG(pb.fg_attempted + 0.44 * pb.ft_attempted) >= 10
                THEN SUM(pb.points)::float8 / NULLIF(2 * (SUM(pb.fg_attempted) + 0.44 * SUM(pb.ft_attempted)), 0)
           END`,
    format: (v) => `${pct(v)} TS`, topN: 15,
  },
];

function playerRanksSql(m: PlayerMetric): string {
  return `
    WITH per_player AS (
      SELECT pb.player_id, COUNT(*)::int AS games, (${m.expr})::float8 AS value
      FROM game_player_box_scores pb
      JOIN games g ON g.game_id = pb.game_id
      WHERE g.season_id = $1::int AND ${REGULAR_SEASON}
      GROUP BY pb.player_id
      HAVING COUNT(*) >= $2::int
    ), ranked AS (
      SELECT player_id, games, value,
             RANK() OVER (ORDER BY value DESC)::int AS rank,
             COUNT(*) OVER ()::int AS total_players
      FROM per_player
      WHERE value IS NOT NULL
    )
    SELECT r.player_id::text AS player_id, p.display_name, r.games, r.value, r.rank, r.total_players
    FROM ranked r
    JOIN players p ON p.player_id = r.player_id
    WHERE r.rank <= $3::int
      AND r.player_id IN ${clippersSeasonPlayers('$1', '$4')}
    ORDER BY r.rank
  `.trim();
}

// ── Generator ────────────────────────────────────────────────────────────────

export async function generateLeagueComparisonInsights(ctx: InsightContext): Promise<InsightRow[]> {
  const results: InsightRow[] = [];
  const { lac, season } = ctx;
  const seasonDateMs = new Date(season.lastGameDate).getTime();
  const teamVerb = season.isCurrent ? 'rank' : 'ranked';     // "Clippers rank"
  const playerVerb = season.isCurrent ? 'ranks' : 'ranked';  // "Kawhi Leonard ranks"

  // 1. Team season ranks
  for (const m of TEAM_METRICS) {
    const proofSql = teamRankSql(m);
    const { rows, proof_params } = await runProof<{
      team_id: string; value: number; games: number; rank: number; total_teams: number;
    }>(proofSql, [season.id, MIN_TEAM_GAMES, lac.teamId]);
    if (!guardProofResult(rows)) continue;
    const { value, rank, total_teams } = rows[0];
    const isTop = isReportableLeagueRank(rank, total_teams, 5);
    const isBottom = isReportableLeagueRank(rank, total_teams) && rank > total_teams - 5;
    if (!isTop && !isBottom) continue;

    results.push(withInsightKey({
      scope: 'between_games',
      team_id: lac.teamId, game_id: null, player_id: null, season_id: season.id,
      category: 'league_comparison',
      headline: `Clippers ${teamVerb} ${ordinal(rank)} in the NBA in ${m.label} ${season.phrase}`,
      detail: `${m.format(value)} — ${ordinal(rank)} of ${total_teams} teams${m.higherIsBetter ? '' : ' (lower is better)'}`,
      // Bottom-5 facts are shown, but below the flattering ones.
      importance: computeImportance('league_comparison', rankPercentile(rank, total_teams), seasonDateMs) - (isTop ? 0 : 15),
      proof_sql: proofSql, proof_params, proof_result: rows,
    }, `team_rank_${m.key}`));
  }

  // 2. Standings
  {
    const { rows, proof_params } = await runProof<{
      conference: string | null; wins: number; losses: number;
      conf_rank: number; conf_teams: number; league_rank: number; league_teams: number;
    }>(STANDINGS_SQL, [season.id, lac.teamId]);
    if (guardProofResult(rows) && rows[0].league_teams >= MIN_LEAGUE_TEAMS && rows[0].wins + rows[0].losses >= MIN_TEAM_GAMES) {
      const r = rows[0];
      const conf = r.conference ? `the ${r.conference}` : 'the conference';
      const headline = season.isCurrent
        ? `Clippers are ${r.wins}-${r.losses}, ${ordinal(r.conf_rank)} in ${conf}`
        : `Clippers finished ${season.label} at ${r.wins}-${r.losses}, ${ordinal(r.conf_rank)} in ${conf}`;
      results.push(withInsightKey({
        scope: 'between_games',
        team_id: lac.teamId, game_id: null, player_id: null, season_id: season.id,
        category: 'league_comparison',
        headline,
        detail: `${ordinal(r.league_rank)} of ${r.league_teams} teams league-wide by win percentage (regular season)`,
        importance: computeImportance('league_comparison', rankPercentile(r.league_rank, r.league_teams), seasonDateMs) + 5,
        proof_sql: STANDINGS_SQL, proof_params, proof_result: rows,
      }, 'standings'));
    }
  }

  // 3. Recent form — only meaningful while the season is being played
  if (season.isCurrent) {
    for (const metric of ['off_rating', 'net_rating'] as const) {
      const proofSql = rollingRankSql(metric);
      const { rows, proof_params } = await runProof<{
        rank: number; total_teams: number; value: number; as_of_game_date: string;
      }>(proofSql, [season.id, ROLLING_WINDOW, lac.teamId]);
      if (!guardProofResult(rows)) continue;
      const { rank, total_teams, value, as_of_game_date } = rows[0];
      if (!isReportableLeagueRank(rank, total_teams, 5)) continue;
      const label = metric === 'off_rating' ? 'offensive rating' : 'net rating';
      results.push(withInsightKey({
        scope: 'between_games',
        team_id: lac.teamId, game_id: null, player_id: null, season_id: season.id,
        category: 'league_comparison',
        headline: `Clippers rank ${ordinal(rank)} in ${label} over their last ${ROLLING_WINDOW} games`,
        detail: `${fmt(value)} — ${ordinal(rank)} of ${total_teams} teams (as of ${as_of_game_date})`,
        importance: computeImportance('league_comparison', rankPercentile(rank, total_teams), new Date(as_of_game_date).getTime()),
        proof_sql: proofSql, proof_params, proof_result: rows,
      }, `rolling_rank_${metric}_last${ROLLING_WINDOW}`));
    }
  }

  // 4. Player league ranks
  for (const m of PLAYER_METRICS) {
    const proofSql = playerRanksSql(m);
    const { rows, proof_params } = await runProof<{
      player_id: string; display_name: string; games: number; value: number; rank: number; total_players: number;
    }>(proofSql, [season.id, ctx.minPlayerGames, m.topN, lac.teamId]);
    for (const r of rows) {
      if (r.total_players < MIN_LEAGUE_TEAMS * 5) continue; // league data too thin to rank players
      results.push(withInsightKey({
        scope: 'between_games',
        team_id: lac.teamId, game_id: null, player_id: r.player_id, season_id: season.id,
        category: 'league_comparison',
        headline: `${r.display_name} ${playerVerb} ${ordinal(r.rank)} in the NBA in ${m.label} ${season.phrase}`,
        detail: `${m.format(r.value)} — ${ordinal(r.rank)} of ${r.total_players} qualified players (min ${ctx.minPlayerGames} games)`,
        importance: computeImportance('league_comparison', rankPercentile(r.rank, r.total_players), seasonDateMs),
        // One row per player per metric: the proof query lists every Clippers
        // player in the top N; this row's claim is its own line of that result.
        proof_sql: proofSql, proof_params, proof_result: [r],
      }, `player_rank_${m.key}`));
    }
  }

  return results;
}
