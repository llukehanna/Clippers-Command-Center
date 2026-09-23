// scripts/lib/insights/opponent-context.ts
// Batch insight category: opponent context for the NEXT Clippers game.
//
//   1. opp_rank_{off,def}: the opponent's offensive / defensive rating rank in
//      the stats season (league-wide, possession-weighted).
//   2. h2h: Clippers vs opponent record in the stats season.
//   3. last_meeting: result of the most recent completed meeting.
//
// Stats come from the stats season (context.ts), so before the opener the
// preview uses last season's numbers and says so ("in 2025-26"). With no
// upcoming game on the schedule, nothing is emitted.
import {
  InsightRow,
  withInsightKey,
  guardProofResult,
  computeImportance,
  isReportableLeagueRank,
  ordinal,
  rankPercentile,
  fmt,
} from './proof-utils.js';
import { InsightContext, REGULAR_SEASON, runProof } from './context.js';
import { sql } from '../db.js';

const MIN_TEAM_GAMES = 5;

function oppRankSql(metric: 'off_rating' | 'def_rating'): string {
  const order = metric === 'off_rating' ? 'DESC' : 'ASC';
  return `
    WITH team_values AS (
      SELECT a.team_id,
             (SUM(a.${metric} * a.possessions) / NULLIF(SUM(a.possessions), 0))::float8 AS value
      FROM advanced_team_game_stats a
      JOIN games g ON g.game_id = a.game_id
      WHERE g.season_id = $1::int AND ${REGULAR_SEASON}
      GROUP BY a.team_id
      HAVING COUNT(*) >= $2::int
    ), ranked AS (
      SELECT team_id, value,
             RANK() OVER (ORDER BY value ${order})::int AS rank,
             COUNT(*) OVER ()::int AS total_teams
      FROM team_values
      WHERE value IS NOT NULL
    )
    SELECT value, rank, total_teams FROM ranked WHERE team_id = $3::bigint
  `.trim();
}

const H2H_SQL = `
  SELECT
    COUNT(*) FILTER (WHERE (g.home_team_id = $1::bigint) = (g.home_score > g.away_score))::int AS clippers_wins,
    COUNT(*) FILTER (WHERE (g.home_team_id = $1::bigint) <> (g.home_score > g.away_score))::int AS opp_wins,
    COUNT(*)::int AS total_games
  FROM games g
  WHERE ((g.home_team_id = $1::bigint AND g.away_team_id = $2::bigint)
      OR (g.home_team_id = $2::bigint AND g.away_team_id = $1::bigint))
    AND g.season_id = $3::int
    AND g.status = 'final'
    AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
`.trim();

const LAST_MEETING_SQL = `
  SELECT g.game_id::text AS game_id, g.game_date::text AS game_date,
         (g.home_team_id = $1::bigint) AS clippers_home,
         g.home_score, g.away_score
  FROM games g
  WHERE ((g.home_team_id = $1::bigint AND g.away_team_id = $2::bigint)
      OR (g.home_team_id = $2::bigint AND g.away_team_id = $1::bigint))
    AND g.status = 'final'
    AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
    AND g.game_date < $3::date
  ORDER BY g.game_date DESC
  LIMIT 1
`.trim();

function shortDate(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

export async function generateOpponentContextInsights(ctx: InsightContext): Promise<InsightRow[]> {
  const results: InsightRow[] = [];
  const { lac, season } = ctx;

  const [next] = await sql<{
    game_id: string; home_team_id: string; away_team_id: string; game_date: string; season_id: number;
  }[]>`
    SELECT game_id::text, home_team_id::text, away_team_id::text, game_date::text AS game_date, season_id
    FROM games
    WHERE ${lac.teamId}::bigint IN (home_team_id, away_team_id)
      AND status <> 'final'
      AND game_date >= CURRENT_DATE
    ORDER BY game_date, start_time_utc NULLS LAST
    LIMIT 1
  `;
  if (!next) return results;

  const oppId = next.home_team_id === lac.teamId ? next.away_team_id : next.home_team_id;
  const opp = ctx.teams.get(oppId);
  if (!opp) return results;
  const gameDateMs = new Date(next.game_date).getTime();
  const base = {
    scope: 'between_games' as const,
    team_id: lac.teamId,
    game_id: next.game_id,
    player_id: null,
    category: 'opponent_context' as const,
  };

  // 1. Opponent offense / defense rank
  for (const metric of ['def_rating', 'off_rating'] as const) {
    const proofSql = oppRankSql(metric);
    const { rows, proof_params } = await runProof<{ value: number; rank: number; total_teams: number }>(
      proofSql, [season.id, MIN_TEAM_GAMES, oppId]
    );
    if (!guardProofResult(rows)) continue;
    const { value, rank, total_teams } = rows[0];
    if (!isReportableLeagueRank(rank, total_teams)) continue;
    const side = metric === 'def_rating' ? 'defense' : 'offense';
    const verb = season.isCurrent ? 'have' : 'had'; // team names take plural verbs: "the Warriors have"
    results.push(withInsightKey({
      ...base,
      season_id: season.id,
      headline: `Up next: the ${opp.fullName} ${verb} the ${ordinal(rank)}-ranked ${side} ${season.phrase}`,
      detail: `${metric === 'def_rating' ? 'Defensive' : 'Offensive'} rating ${fmt(value)} — ${ordinal(rank)} of ${total_teams}${metric === 'def_rating' ? ' (lower is better)' : ''}`,
      // A top-5 or bottom-5 unit is the notable case.
      importance: computeImportance('opponent_context', rankPercentile(Math.min(rank, total_teams - rank + 1), total_teams), gameDateMs),
      proof_sql: proofSql, proof_params, proof_result: rows,
    }, `opp_rank_${metric}_${oppId}_${next.game_id}`));
  }

  // 2. Head-to-head in the stats season
  {
    const { rows, proof_params } = await runProof<{ clippers_wins: number; opp_wins: number; total_games: number }>(
      H2H_SQL, [lac.teamId, oppId, season.id]
    );
    if (guardProofResult(rows) && rows[0].total_games > 0) {
      const r = rows[0];
      const headline = season.isCurrent
        ? `Clippers are ${r.clippers_wins}-${r.opp_wins} vs the ${opp.fullName} this season`
        : `Clippers went ${r.clippers_wins}-${r.opp_wins} vs the ${opp.fullName} in ${season.label}`;
      results.push(withInsightKey({
        ...base,
        season_id: season.id,
        headline,
        detail: `${r.total_games} meeting${r.total_games === 1 ? '' : 's'} (incl. postseason)`,
        importance: computeImportance('opponent_context', null, gameDateMs),
        proof_sql: H2H_SQL, proof_params, proof_result: rows,
      }, `h2h_${oppId}_${season.id}_${next.game_id}`));
    }
  }

  // 3. Last meeting
  {
    const { rows, proof_params } = await runProof<{
      game_id: string; game_date: string; clippers_home: boolean; home_score: number; away_score: number;
    }>(LAST_MEETING_SQL, [lac.teamId, oppId, next.game_date]);
    if (guardProofResult(rows)) {
      const m = rows[0];
      const lacScore = m.clippers_home ? m.home_score : m.away_score;
      const oppScore = m.clippers_home ? m.away_score : m.home_score;
      const result = lacScore > oppScore ? 'won' : 'lost';
      results.push(withInsightKey({
        ...base,
        season_id: null,
        headline: `Last meeting: Clippers ${result} ${Math.max(lacScore, oppScore)}-${Math.min(lacScore, oppScore)} vs the ${opp.fullName}`,
        detail: `${m.clippers_home ? 'Home' : 'Away'}, ${shortDate(m.game_date)}`,
        importance: computeImportance('opponent_context', null, gameDateMs) - 5,
        proof_sql: LAST_MEETING_SQL, proof_params, proof_result: rows,
      }, `last_meeting_${oppId}_${next.game_id}`));
    }
  }

  return results;
}
