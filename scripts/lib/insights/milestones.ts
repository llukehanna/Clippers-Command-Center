// scripts/lib/insights/milestones.ts
// Batch insight category: season milestones for Clippers players, over the
// stats season (context.ts). Each emits only the highest threshold reached;
// crossing a new threshold replaces the old insight (the key includes it).
//
//   1. season_points  — 1,000 / 1,250 / 1,500 / 1,750 / 2,000 / 2,500 points
//   2. double_doubles — 20 / 30 / 40 / 50 / 60 double-doubles
//   3. season_threes  — 150 / 200 / 250 / 300 made threes
// Bigger thresholds rank higher (importance + 2 per step).
//
// Clippers players = clippersSeasonPlayers() (last game of the season was for
// LAC). Totals are regular-season only, across both teams for a player
// acquired mid-season — the usual season stat line.
import {
  InsightRow,
  withInsightKey,
  computeImportance,
  highestThreshold,
} from './proof-utils.js';
import { clippersSeasonPlayers, InsightContext, REGULAR_SEASON, runProof } from './context.js';

interface Milestone {
  key: string;
  thresholds: readonly number[];
  /** Per-player season total over game_player_box_scores `pb`. */
  expr: string;
  noun: (n: number) => string;   // 1500 → "1,500 points"
}

// A double-double: 10+ in at least two of points, rebounds, assists, steals, blocks.
const DOUBLE_DOUBLE = `
  ((pb.points >= 10)::int + (pb.rebounds >= 10)::int + (pb.assists >= 10)::int
   + (pb.steals >= 10)::int + (pb.blocks >= 10)::int) >= 2`;

const MILESTONES: Milestone[] = [
  { key: 'season_points', thresholds: [1000, 1250, 1500, 1750, 2000, 2500],
    expr: 'SUM(pb.points)', noun: (n) => `${n.toLocaleString('en-US')} points` },
  { key: 'double_doubles', thresholds: [20, 30, 40, 50, 60],
    expr: `COUNT(*) FILTER (WHERE ${DOUBLE_DOUBLE})`, noun: (n) => `${n} double-doubles` },
  { key: 'season_threes', thresholds: [150, 200, 250, 300],
    expr: 'SUM(pb.fg3_made)', noun: (n) => `${n} made threes` },
];

function milestoneSql(m: Milestone): string {
  return `
    SELECT pb.player_id::text AS player_id, p.display_name,
           COUNT(*)::int AS games, (${m.expr})::int AS total
    FROM game_player_box_scores pb
    JOIN games g ON g.game_id = pb.game_id
    JOIN players p ON p.player_id = pb.player_id
    WHERE g.season_id = $1::int
      AND ${REGULAR_SEASON}
      AND pb.player_id IN ${clippersSeasonPlayers('$1', '$2')}
    GROUP BY pb.player_id, p.display_name
    HAVING (${m.expr}) >= $3::int
    ORDER BY total DESC
  `.trim();
}

export async function generateMilestoneInsights(ctx: InsightContext): Promise<InsightRow[]> {
  const results: InsightRow[] = [];
  const { lac, season } = ctx;
  const seasonDateMs = new Date(season.lastGameDate).getTime();

  for (const m of MILESTONES) {
    const proofSql = milestoneSql(m);
    const { rows, proof_params } = await runProof<{
      player_id: string; display_name: string; games: number; total: number;
    }>(proofSql, [season.id, lac.teamId, Math.min(...m.thresholds)]);

    for (const r of rows) {
      const reached = highestThreshold(r.total, m.thresholds);
      if (reached === null) continue;
      const headline = season.isCurrent
        ? `${r.display_name} has reached ${m.noun(reached)} this season`
        : `${r.display_name} reached ${m.noun(reached)} in ${season.label}`;
      results.push(withInsightKey({
        scope: 'between_games',
        team_id: lac.teamId, game_id: null, player_id: r.player_id, season_id: season.id,
        category: 'milestone',
        headline,
        detail: `${m.noun(r.total)} in ${r.games} games`,
        importance: computeImportance('milestone', null, seasonDateMs) + 2 * m.thresholds.indexOf(reached),
        // Proof lists every Clippers player past the lowest threshold; this row is its own line.
        proof_sql: proofSql, proof_params, proof_result: [r],
      }, `${m.key}_${reached}`));
    }
  }

  return results;
}
