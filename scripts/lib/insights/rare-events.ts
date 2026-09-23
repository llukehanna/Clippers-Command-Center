// scripts/lib/insights/rare-events.ts
// Batch insight category: rare individual performances.
//
// The sample is every NBA player-game of the stats season (context.ts —
// league-wide box scores from scripts/sync-league-games.ts). A Clippers
// performance (the player was on the Clippers in that game) is "rare" when it
// is in the top 1% of the sample for points, rebounds, assists or made threes.
// Only each player's best such game per stat is kept (latest on ties), top
// MAX_PER_STAT per stat. Scope 'historical' with game_id set, so these surface
// on game pages.
import {
  InsightRow,
  withInsightKey,
  computeImportance,
} from './proof-utils.js';
import { InsightContext, runProof } from './context.js';

const PCT_RANK_THRESHOLD = 0.99;
const MAX_PER_STAT = 5;
/** Below this many player-games the percentile is not meaningful. */
const MIN_SAMPLE = 2000;

interface RareStat {
  column: 'points' | 'rebounds' | 'assists' | 'fg3_made';
  noun: (n: number) => string;  // 41 → "41-point"
  label: string;                // "scoring"
}

const STATS: RareStat[] = [
  { column: 'points', noun: (n) => `${n}-point`, label: 'scoring' },
  { column: 'rebounds', noun: (n) => `${n}-rebound`, label: 'rebounding' },
  { column: 'assists', noun: (n) => `${n}-assist`, label: 'assist' },
  { column: 'fg3_made', noun: (n) => `${n}-three`, label: 'three-point' },
];

function rareSql(stat: RareStat): string {
  return `
    WITH sample AS (
      SELECT pb.game_id, pb.player_id, pb.team_id, pb.${stat.column} AS value,
             PERCENT_RANK() OVER (ORDER BY pb.${stat.column})::float8 AS pct_rank,
             COUNT(*) OVER ()::int AS sample_size
      FROM game_player_box_scores pb
      JOIN games g ON g.game_id = pb.game_id
      WHERE g.season_id = $1::int
    )
    , best_per_player AS (
      SELECT DISTINCT ON (s.player_id)
             s.game_id, s.player_id, s.value, s.pct_rank, s.sample_size, g.game_date
      FROM sample s
      JOIN games g ON g.game_id = s.game_id
      WHERE s.team_id = $2::bigint
        AND s.pct_rank >= $3::float8
      ORDER BY s.player_id, s.value DESC, g.game_date DESC
    )
    SELECT b.game_id::text AS game_id, b.player_id::text AS player_id, p.display_name,
           b.game_date::text AS game_date, b.value::int AS value, b.pct_rank, b.sample_size
    FROM best_per_player b
    JOIN players p ON p.player_id = b.player_id
    ORDER BY b.value DESC, b.game_date DESC
    LIMIT $4::int
  `.trim();
}

function shortDate(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

export async function generateRareEventInsights(ctx: InsightContext): Promise<InsightRow[]> {
  const results: InsightRow[] = [];
  const { lac, season } = ctx;

  for (const stat of STATS) {
    const proofSql = rareSql(stat);
    const { rows, proof_params } = await runProof<{
      game_id: string; player_id: string; display_name: string; game_date: string;
      value: number; pct_rank: number; sample_size: number;
    }>(proofSql, [season.id, lac.teamId, PCT_RANK_THRESHOLD, MAX_PER_STAT]);

    for (const r of rows) {
      if (r.sample_size < MIN_SAMPLE) continue;
      const better = Math.floor(r.pct_rank * 1000) / 10; // 99.47 → "99.4"
      const best = r.pct_rank >= 1; // PERCENT_RANK = 1 only for the season's top value
      results.push(withInsightKey({
        scope: 'historical',
        team_id: lac.teamId, game_id: r.game_id, player_id: r.player_id, season_id: season.id,
        category: 'rare_event',
        headline: best
          ? `${r.display_name}'s ${stat.noun(r.value)} game was the best ${stat.label} night in the NBA ${season.phrase}`
          : `${r.display_name}'s ${stat.noun(r.value)} game was a top-1% ${stat.label} night in the NBA ${season.phrase}`,
        detail: best
          ? `${shortDate(r.game_date)} — the high among ${r.sample_size.toLocaleString('en-US')} player games`
          : `${shortDate(r.game_date)} — better than ${better}% of ${r.sample_size.toLocaleString('en-US')} player games`,
        importance: computeImportance('rare_event', r.pct_rank * 100, new Date(r.game_date).getTime()),
        proof_sql: proofSql, proof_params, proof_result: [r],
      }, `rare_${stat.column}_${r.player_id}_${r.game_id}`));
    }
  }

  return results;
}
