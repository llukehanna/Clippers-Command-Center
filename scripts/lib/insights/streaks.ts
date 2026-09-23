// scripts/lib/insights/streaks.ts
// Batch insight category: streaks, over the stats season (context.ts).
//
// Player streaks are ACTIVE streaks: consecutive qualifying games counted back
// from the player's most recent game of the season (a streak that already
// ended is not a fact worth showing; generate-insights deactivates it). In the
// offseason the same query describes how the player closed the season.
//
//   scoring_20 / scoring_30  20+ / 30+ points
//   rebounding_10            10+ rebounds
//   threes_3                 3+ made threes
//   hot_shooting             50%+ FG on 8+ attempts
//   team_streak              Clippers win / losing streak (current season only)
import {
  InsightRow,
  withInsightKey,
  computeImportance,
} from './proof-utils.js';
import { clippersSeasonPlayers, InsightContext, runProof } from './context.js';

interface StreakDef {
  key: string;
  /** Boolean SQL over game_player_box_scores `pb` for a qualifying game. */
  qualifies: string;
  minGames: number;
  /** "has scored 20+ in 5 straight games" / "closed 2025-26 with 20+ points in 5 straight games" */
  current: (n: number) => string;
  closed: (n: number, season: string) => string;
}

const STREAKS: StreakDef[] = [
  { key: 'scoring_20', qualifies: 'pb.points >= 20', minGames: 3,
    current: (n) => `has scored 20+ in ${n} straight games`,
    closed: (n, s) => `closed ${s} with 20+ points in ${n} straight games` },
  { key: 'scoring_30', qualifies: 'pb.points >= 30', minGames: 3,
    current: (n) => `has scored 30+ in ${n} straight games`,
    closed: (n, s) => `closed ${s} with 30+ points in ${n} straight games` },
  { key: 'rebounding_10', qualifies: 'pb.rebounds >= 10', minGames: 4,
    current: (n) => `has 10+ rebounds in ${n} straight games`,
    closed: (n, s) => `closed ${s} with 10+ rebounds in ${n} straight games` },
  { key: 'threes_3', qualifies: 'pb.fg3_made >= 3', minGames: 4,
    current: (n) => `has made 3+ threes in ${n} straight games`,
    closed: (n, s) => `closed ${s} making 3+ threes in ${n} straight games` },
  { key: 'hot_shooting', qualifies: 'pb.fg_attempted >= 8 AND pb.fg_made * 2 >= pb.fg_attempted', minGames: 4,
    current: (n) => `is shooting 50%+ from the field in ${n} straight games`,
    closed: (n, s) => `closed ${s} shooting 50%+ from the field in ${n} straight games` },
];

function playerStreakSql(def: StreakDef): string {
  return `
    WITH season_games AS (
      SELECT pb.player_id, g.game_id, g.game_date,
             pb.points, pb.rebounds, pb.fg3_made, pb.fg_made, pb.fg_attempted,
             (${def.qualifies}) AS qualifies,
             ROW_NUMBER() OVER (PARTITION BY pb.player_id ORDER BY g.game_date DESC, g.game_id DESC) AS recency
      FROM game_player_box_scores pb
      JOIN games g ON g.game_id = pb.game_id
      WHERE g.season_id = $1::int
        AND pb.player_id IN ${clippersSeasonPlayers('$1', '$2')}
    ), first_miss AS (
      SELECT player_id, MIN(recency) FILTER (WHERE NOT qualifies) AS recency
      FROM season_games
      GROUP BY player_id
    )
    SELECT s.player_id::text AS player_id, p.display_name,
           COUNT(*)::int AS streak,
           MIN(s.game_date)::text AS streak_start,
           MAX(s.game_date)::text AS streak_end,
           json_agg(json_build_object(
             'game_date', s.game_date, 'points', s.points, 'rebounds', s.rebounds,
             'fg3_made', s.fg3_made, 'fg_made', s.fg_made, 'fg_attempted', s.fg_attempted
           ) ORDER BY s.game_date) AS games
    FROM season_games s
    JOIN first_miss f ON f.player_id = s.player_id
    JOIN players p ON p.player_id = s.player_id
    WHERE s.recency < COALESCE(f.recency, 2147483647)
    GROUP BY s.player_id, p.display_name
    HAVING COUNT(*) >= $3::int
    ORDER BY streak DESC
  `.trim();
}

const TEAM_STREAK_SQL = `
  WITH lac_games AS (
    SELECT g.game_id, g.game_date,
           ((g.home_team_id = $2::bigint) = (g.home_score > g.away_score)) AS won,
           ROW_NUMBER() OVER (ORDER BY g.game_date DESC, g.game_id DESC) AS recency
    FROM games g
    WHERE g.season_id = $1::int
      AND $2::bigint IN (g.home_team_id, g.away_team_id)
      AND g.status = 'final'
      AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
  ), latest AS (
    SELECT won FROM lac_games WHERE recency = 1
  ), first_change AS (
    SELECT MIN(recency) AS recency FROM lac_games WHERE won <> (SELECT won FROM latest)
  )
  SELECT (SELECT won FROM latest) AS winning,
         COUNT(*)::int AS streak,
         MIN(game_date)::text AS streak_start,
         MAX(game_date)::text AS streak_end
  FROM lac_games
  WHERE recency < COALESCE((SELECT recency FROM first_change), 2147483647)
  HAVING COUNT(*) > 0
`.trim();

export async function generateStreakInsights(ctx: InsightContext): Promise<InsightRow[]> {
  const results: InsightRow[] = [];
  const { lac, season } = ctx;

  for (const def of STREAKS) {
    const proofSql = playerStreakSql(def);
    const { rows, proof_params } = await runProof<{
      player_id: string; display_name: string; streak: number;
      streak_start: string; streak_end: string; games: unknown[];
    }>(proofSql, [season.id, lac.teamId, def.minGames]);

    for (const r of rows) {
      const endMs = new Date(r.streak_end).getTime();
      results.push(withInsightKey({
        scope: 'between_games',
        team_id: lac.teamId, game_id: null, player_id: r.player_id, season_id: season.id,
        category: 'streak',
        headline: `${r.display_name} ${season.isCurrent ? def.current(r.streak) : def.closed(r.streak, season.label)}`,
        detail: `${r.streak_start} to ${r.streak_end}`,
        // Longer streaks rank higher; closed (offseason) streaks rank lower.
        importance: computeImportance('streak', null, endMs) + Math.min(10, (r.streak - def.minGames) * 2) - (season.isCurrent ? 0 : 10),
        // Proof lists every active Clippers streak of this kind; this row is its own line.
        proof_sql: proofSql, proof_params, proof_result: [r],
      }, def.key)); // no length in the key: an extending streak updates the same row
    }
  }

  if (season.isCurrent) {
    const { rows, proof_params } = await runProof<{
      winning: boolean; streak: number; streak_start: string; streak_end: string;
    }>(TEAM_STREAK_SQL, [season.id, lac.teamId]);
    const r = rows[0];
    if (r && ((r.winning && r.streak >= 3) || (!r.winning && r.streak >= 4))) {
      results.push(withInsightKey({
        scope: 'between_games',
        team_id: lac.teamId, game_id: null, player_id: null, season_id: season.id,
        category: 'streak',
        headline: r.winning
          ? `Clippers have won ${r.streak} straight`
          : `Clippers have lost ${r.streak} straight`,
        detail: `${r.streak_start} to ${r.streak_end}`,
        importance: computeImportance('streak', null, new Date(r.streak_end).getTime()) + (r.winning ? r.streak : -10),
        proof_sql: TEAM_STREAK_SQL, proof_params, proof_result: rows,
      }, 'team_streak'));
    }
  }

  return results;
}
