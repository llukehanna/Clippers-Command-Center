// scripts/lib/insights/year-over-year.ts
// Batch insight category: year over year — the stats season (context.ts)
// against the season before it. Needs league-wide box scores for both.
//
//   1. team_rank  — Clippers off/def/net rating league rank moved 5+ places
//   2. record     — wins (completed season) or win% (season in progress)
//   3. player     — a Clippers player's PPG/RPG/APG/TS% rose sharply vs his
//                   previous season (any team; regular season only)
//
// Only improvements are reported for players (a drop is usually injury or
// role noise); team moves are reported both ways, drops ranked lower.
import {
  InsightRow,
  withInsightKey,
  computeImportance,
  isReportableLeagueRank,
  ordinal,
} from './proof-utils.js';
import { clippersSeasonPlayers, InsightContext, REGULAR_SEASON, runProof } from './context.js';
import { MIN_TEAM_GAMES, PLAYER_METRICS, TEAM_METRICS, type PlayerMetric } from './league-comparisons.js';
import { seasonLabel } from '../schedule-utils.js';

const MIN_RANK_MOVE = 5;
const MIN_WIN_CHANGE = 5;          // games, completed seasons
const MIN_WIN_PCT_CHANGE = 0.1;    // in-season
const MIN_INSEASON_GAMES = 20;
const MIN_PREV_PLAYER_GAMES = 20;

/** Player metrics compared, with the minimum rise worth reporting. */
const PLAYER_RISES: { key: string; minRise: number }[] = [
  { key: 'ppg', minRise: 3 },
  { key: 'rpg', minRise: 2 },
  { key: 'apg', minRise: 2 },
  { key: 'ts_pct', minRise: 0.03 },
];

const YOY_TEAM_METRICS = TEAM_METRICS.filter((m) => ['off_rating', 'def_rating', 'net_rating'].includes(m.key));

function teamRankSql(aggregate: string, higherIsBetter: boolean): string {
  return `
    WITH team_values AS (
      SELECT g.season_id, a.team_id, (${aggregate})::float8 AS value
      FROM advanced_team_game_stats a
      JOIN games g ON g.game_id = a.game_id
      WHERE g.season_id IN ($1::int, $2::int) AND ${REGULAR_SEASON}
      GROUP BY g.season_id, a.team_id
      HAVING COUNT(*) >= $3::int
    ), ranked AS (
      SELECT season_id, team_id, value,
             RANK() OVER (PARTITION BY season_id ORDER BY value ${higherIsBetter ? 'DESC' : 'ASC'})::int AS rank,
             COUNT(*) OVER (PARTITION BY season_id)::int AS total_teams
      FROM team_values
      WHERE value IS NOT NULL
    )
    SELECT season_id::int AS season_id, value, rank, total_teams
    FROM ranked
    WHERE team_id = $4::bigint
    ORDER BY season_id
  `.trim();
}

const RECORD_SQL = `
  SELECT g.season_id::int AS season_id,
         COUNT(*) FILTER (WHERE (g.home_team_id = $3::bigint) = (g.home_score > g.away_score))::int AS wins,
         COUNT(*) FILTER (WHERE (g.home_team_id = $3::bigint) <> (g.home_score > g.away_score))::int AS losses
  FROM games g
  WHERE g.season_id IN ($1::int, $2::int) AND ${REGULAR_SEASON}
    AND g.status = 'final' AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
    AND $3::bigint IN (g.home_team_id, g.away_team_id)
  GROUP BY g.season_id
  ORDER BY g.season_id
`.trim();

function playerRiseSql(m: PlayerMetric): string {
  return `
    WITH per_season AS (
      SELECT pb.player_id, g.season_id, COUNT(*)::int AS games, (${m.expr})::float8 AS value
      FROM game_player_box_scores pb
      JOIN games g ON g.game_id = pb.game_id
      WHERE g.season_id IN ($1::int, $2::int) AND ${REGULAR_SEASON}
      GROUP BY pb.player_id, g.season_id
    )
    SELECT cur.player_id::text AS player_id, p.display_name,
           cur.games, cur.value, prev.games AS prev_games, prev.value AS prev_value
    FROM per_season cur
    JOIN per_season prev ON prev.player_id = cur.player_id AND prev.season_id = $2::int
    JOIN players p ON p.player_id = cur.player_id
    WHERE cur.season_id = $1::int
      AND cur.games >= $3::int AND prev.games >= $4::int
      AND cur.value IS NOT NULL AND prev.value IS NOT NULL
      AND cur.value - prev.value >= $5::float8
      AND cur.player_id IN ${clippersSeasonPlayers('$1', '$6')}
    ORDER BY cur.value - prev.value DESC
  `.trim();
}

function pctPoints(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export async function generateYearOverYearInsights(ctx: InsightContext): Promise<InsightRow[]> {
  const results: InsightRow[] = [];
  const { lac, season } = ctx;
  const prevId = season.id - 1;
  const prevLabel = seasonLabel(prevId);
  const prevPhrase = season.isCurrent ? 'last season' : `in ${prevLabel}`;
  const seasonDateMs = new Date(season.lastGameDate).getTime();
  const base = {
    scope: 'between_games' as const,
    team_id: lac.teamId,
    game_id: null,
    season_id: season.id,
    category: 'year_over_year' as const,
  };

  // 1. Team rank moves
  for (const m of YOY_TEAM_METRICS) {
    const proofSql = teamRankSql(m.aggregate, m.higherIsBetter);
    const { rows, proof_params } = await runProof<{
      season_id: number; value: number; rank: number; total_teams: number;
    }>(proofSql, [season.id, prevId, MIN_TEAM_GAMES, lac.teamId]);
    const prev = rows.find((r) => r.season_id === prevId);
    const cur = rows.find((r) => r.season_id === season.id);
    if (!prev || !cur) continue;
    if (!isReportableLeagueRank(cur.rank, cur.total_teams) || !isReportableLeagueRank(prev.rank, prev.total_teams)) continue;
    const moved = prev.rank - cur.rank; // positive = improved
    if (Math.abs(moved) < MIN_RANK_MOVE) continue;
    const verb = moved > 0 ? 'improved' : 'slipped';
    results.push(withInsightKey({
      ...base,
      player_id: null,
      headline: `Clippers' ${m.label} ${verb} from ${ordinal(prev.rank)} ${prevPhrase} to ${ordinal(cur.rank)} ${season.phrase}`,
      detail: `${m.format(prev.value)} → ${m.format(cur.value)}${m.higherIsBetter ? '' : ' (lower is better)'}`,
      importance: computeImportance('year_over_year', null, seasonDateMs) + Math.min(10, Math.abs(moved)) - (moved > 0 ? 0 : 15),
      proof_sql: proofSql, proof_params, proof_result: rows,
    }, `yoy_team_rank_${m.key}`));
  }

  // 2. Record
  {
    const { rows, proof_params } = await runProof<{ season_id: number; wins: number; losses: number }>(
      RECORD_SQL, [season.id, prevId, lac.teamId]
    );
    const prev = rows.find((r) => r.season_id === prevId);
    const cur = rows.find((r) => r.season_id === season.id);
    if (prev && cur && prev.wins + prev.losses >= MIN_INSEASON_GAMES) {
      const curPct = cur.wins / (cur.wins + cur.losses);
      const prevPct = prev.wins / (prev.wins + prev.losses);
      let headline: string | null = null;
      if (!season.isCurrent && Math.abs(cur.wins - prev.wins) >= MIN_WIN_CHANGE) {
        headline = `Clippers won ${cur.wins} games in ${season.label}, ${cur.wins > prev.wins ? 'up' : 'down'} from ${prev.wins} in ${prevLabel}`;
      } else if (season.isCurrent && cur.wins + cur.losses >= MIN_INSEASON_GAMES
                 && Math.abs(curPct - prevPct) >= MIN_WIN_PCT_CHANGE) {
        headline = `Clippers are winning ${pctPoints(curPct)} of their games, ${curPct > prevPct ? 'up' : 'down'} from ${pctPoints(prevPct)} last season`;
      }
      if (headline) {
        results.push(withInsightKey({
          ...base,
          player_id: null,
          headline,
          detail: `${cur.wins}-${cur.losses} vs ${prev.wins}-${prev.losses} (regular season)`,
          importance: computeImportance('year_over_year', null, seasonDateMs) + (curPct > prevPct ? 5 : -10),
          proof_sql: RECORD_SQL, proof_params, proof_result: rows,
        }, 'yoy_record'));
      }
    }
  }

  // 3. Player rises
  for (const { key, minRise } of PLAYER_RISES) {
    const m = PLAYER_METRICS.find((pm) => pm.key === key)!;
    const proofSql = playerRiseSql(m);
    const { rows, proof_params } = await runProof<{
      player_id: string; display_name: string; games: number; value: number; prev_games: number; prev_value: number;
    }>(proofSql, [season.id, prevId, ctx.minPlayerGames, MIN_PREV_PLAYER_GAMES, minRise, lac.teamId]);
    for (const r of rows) {
      const rise = (r.value - r.prev_value) / minRise; // 1 = just over the bar
      results.push(withInsightKey({
        ...base,
        player_id: r.player_id,
        headline: `${r.display_name}'s ${m.label} rose from ${m.format(r.prev_value)} ${prevPhrase} to ${m.format(r.value)} ${season.phrase}`,
        detail: `${r.prev_games} games ${prevPhrase} → ${r.games} games ${season.phrase} (regular season)`,
        importance: computeImportance('year_over_year', null, seasonDateMs) + Math.min(10, Math.round(rise * 3)),
        proof_sql: proofSql, proof_params, proof_result: [r],
      }, `yoy_player_${key}`));
    }
  }

  return results;
}
