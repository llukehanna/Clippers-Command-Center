// scripts/lib/insights/engine/detectors/postgame-league-nights.ts
// v1 rare events on the v2 engine: each Clippers player's best top-1% night
// league-wide per stat this season (game pages read these by game_id). Plan 3
// retires this detector — the postgame stat lines subsume it (spec §2.2).
import { clippersSeasonGameIds } from '../games.js';
import { runQuery } from '../query.js';
import { MIN_LEAGUE_SAMPLE } from '../questions.js';
import { playerValueRate } from '../rates.js';
import { PLAYER_GAME_STATS } from '../references.js';
import { REGULAR_SEASON } from '../sql.js';
import type { Detector, Fact } from '../types.js';

const PCT_RANK_THRESHOLD = 0.99;
const MAX_PER_STAT = 5;
const NIGHT_STATS = ['pts', 'reb', 'ast', 'fg3m'] as const;

/** $1 season, $2 LAC, $3 percent-rank threshold, $4 as-of, $5 per-stat limit. */
export function leagueNightSql(column: string): string {
  return `
WITH sample AS (
  SELECT pb.game_id, pb.player_id, pb.team_id, pb.${column}::int AS value, g.game_date,
         PERCENT_RANK() OVER (ORDER BY pb.${column})::float8 AS pct_rank,
         (RANK() OVER (ORDER BY pb.${column} DESC))::int AS league_rank,
         (COUNT(*) OVER ())::int AS sample_size
  FROM game_player_box_scores pb
  JOIN games g ON g.game_id = pb.game_id
  WHERE g.season_id = $1::int AND g.status = 'final' AND ${REGULAR_SEASON} AND g.game_date <= $4::date AND pb.${column} IS NOT NULL
), best AS (
  SELECT DISTINCT ON (s.player_id) s.game_id, s.player_id, s.value, s.pct_rank, s.league_rank, s.sample_size, s.game_date
  FROM sample s
  WHERE s.team_id = $2::bigint AND s.pct_rank >= $3::float8
  ORDER BY s.player_id, s.value DESC, s.game_date DESC
)
SELECT b.game_id::text AS game_id, b.player_id::text AS player_id, p.display_name,
       b.game_date::text AS game_date, b.value, b.league_rank, b.sample_size,
       ROUND(b.pct_rank::numeric, 6)::float8 AS pct_rank,
       (CASE WHEN g.home_team_id = $2::bigint THEN g.away_team_id ELSE g.home_team_id END)::text AS opponent_id,
       (g.home_team_id = $2::bigint) AS home,
       ((g.home_team_id = $2::bigint) = (g.home_score > g.away_score)) AS won
FROM best b
JOIN players p ON p.player_id = b.player_id
JOIN games g ON g.game_id = b.game_id
ORDER BY b.value DESC, b.game_date DESC
LIMIT $5::int`.trim();
}

export function leagueNightDetector(): Detector {
  return {
    name: 'postgame.league_nights',
    surface: 'postgame',
    categories: ['league_night'],
    async run(ctx) {
      // Incomplete league: no new claims, and keep the stored ones (true as of when they were made).
      if (!ctx.league.complete) return { facts: [], gameIds: [] };
      const gameIds = ctx.gameId ? [ctx.gameId] : await clippersSeasonGameIds(ctx);
      const facts: Fact[] = [];
      for (const key of NIGHT_STATS) {
        const stat = PLAYER_GAME_STATS[key];
        const q = { sql: leagueNightSql(stat.column), params: [ctx.season.id, ctx.lac.teamId, PCT_RANK_THRESHOLD, ctx.asOf, MAX_PER_STAT] };
        for (const r of await runQuery(q)) {
          const gameId = String(r.game_id);
          if (ctx.gameId && gameId !== ctx.gameId) continue;
          if (Number(r.sample_size) < MIN_LEAGUE_SAMPLE) continue;
          const playerId = String(r.player_id);
          const value = Number(r.value);
          const opp = String(r.opponent_id);
          const rate = await playerValueRate(ctx, stat.column, playerId, value, gameId, String(r.game_date));
          facts.push({
            kind: 'league_night', surface: 'postgame',
            subject: { type: 'player', id: playerId, name: String(r.display_name) },
            stat: key, value,
            window: { type: 'game', game_id: gameId, season_id: ctx.season.id },
            context: { date: String(r.game_date), opponent_id: opp, opponent_name: ctx.teams.get(opp)?.fullName, home: r.home === true, result: r.won === true ? 'W' : 'L' },
            polarity: 'positive',
            proof: { ...q, match: { player_id: playerId, game_id: gameId } },
            asOf: ctx.asOf,
            sample: { kind: 'rate', k: rate.k, n: rate.n, pRef: rate.pRef, power: 1 },
            data: {
              rank: Number(r.league_rank), total: Number(r.sample_size), label: stat.label, unit: stat.plural,
              thing: `${value}-${stat.noun} game`, best: `most ${stat.plural} in a game`, by: 'by a Clipper',
            },
            gameId,
            seasonId: ctx.season.id,
          });
        }
      }
      return { facts, gameIds };
    },
  };
}
