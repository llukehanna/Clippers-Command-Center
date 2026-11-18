// scripts/lib/insights/engine/detectors/pregame-vs-opponent.ts
// Current Clippers' regular-season scoring against the next opponent since records start
// (spec §2.2 "career numbers vs this opponent"; the career is "career" only when it is wholly in the data),
// when it differs from their overall average over the same games by 3+ points over 5+ games.
import { fmt } from '../../proof-utils.js';
import { nextClippersGame } from '../games.js';
import { runQuery } from '../query.js';
import { careerComplete } from '../records.js';
import { REGULAR_SEASON, rosterSubquery } from '../sql.js';
import type { Detector, Fact } from '../types.js';

export const MIN_VS_GAMES = 5;
export const MIN_PPG_GAP = 3;

/**
 * $1 season (the stats season: the roster is its roster), $2 LAC, $3 as-of, $4 opponent, $5 records start season,
 * $6 min games. Lines are the roster's regular-season games for any team since records start; the vs-opponent
 * average and the overall one it is compared with come from the same lines.
 */
export const VS_OPPONENT_SQL = `
WITH lines AS (
  SELECT pb.player_id, pb.points,
         (CASE WHEN g.home_team_id = pb.team_id THEN g.away_team_id ELSE g.home_team_id END) AS opp_id
  FROM game_player_box_scores pb
  JOIN games g ON g.game_id = pb.game_id
  WHERE pb.player_id IN ${rosterSubquery('$1', '$2', '$3')} AND ${REGULAR_SEASON}
    AND g.season_id >= $5::int AND g.game_date <= $3::date AND pb.points IS NOT NULL
), per_opp AS (
  SELECT player_id, opp_id, COUNT(*)::int AS games, ROUND(AVG(points)::numeric, 6)::float8 AS ppg
  FROM lines GROUP BY player_id, opp_id
), ranked AS (
  SELECT player_id, opp_id, games, ppg,
         (RANK() OVER (PARTITION BY player_id ORDER BY ppg DESC))::int AS opp_rank,
         (COUNT(*) OVER (PARTITION BY player_id))::int AS opps
  FROM per_opp
  WHERE games >= 3
), overall AS (
  SELECT player_id, COUNT(*)::int AS games, ROUND(AVG(points)::numeric, 6)::float8 AS ppg
  FROM lines GROUP BY player_id
)
SELECT r.player_id::text AS player_id, p.display_name::text AS display_name, r.games::int AS games, r.ppg::float8 AS ppg,
       r.opp_rank::int AS opp_rank, r.opps::int AS opps, o.games::int AS all_games, o.ppg::float8 AS all_ppg,
       (SELECT MIN(g2.season_id) FROM game_player_box_scores pb2 JOIN games g2 ON g2.game_id = pb2.game_id
        WHERE pb2.player_id = r.player_id AND g2.game_date <= $3::date)::int AS first_season
FROM ranked r
JOIN overall o ON o.player_id = r.player_id
JOIN players p ON p.player_id = r.player_id
WHERE r.opp_id = $4::bigint AND r.games >= $6::int
ORDER BY r.ppg DESC, r.player_id`.trim();

export function vsOpponentDetector(minGames = MIN_VS_GAMES): Detector {
  return {
    name: 'pregame.vs_opponent',
    surface: 'pregame',
    categories: ['vs_opponent'],
    async run(ctx) {
      const next = await nextClippersGame(ctx);
      const opp = next ? ctx.teams.get(next.opponentId) : undefined;
      // "This season" is the next game's season, not the stats season (which lags a new season's first games).
      if (!next || next.seasonId === null || !opp || !ctx.recordsStart) return { facts: [], gameIds: null };
      const seasonId = next.seasonId;
      const q = { sql: VS_OPPONENT_SQL, params: [ctx.season.id, ctx.lac.teamId, ctx.asOf, opp.teamId, ctx.recordsStart.season_id, minGames] };
      const facts: Fact[] = [];
      for (const r of await runQuery(q)) {
        const ppg = Number(r.ppg);
        const all = Number(r.all_ppg);
        const gap = ppg - all;
        if (Math.abs(gap) < MIN_PPG_GAP) continue;
        const rank = Number(r.opp_rank);
        const opps = Number(r.opps);
        const playerId = String(r.player_id);
        facts.push({
          kind: 'vs_opponent', surface: 'pregame', subject: { type: 'player', id: playerId, name: String(r.display_name) },
          stat: 'ppg', value: Math.round(ppg * 10) / 10,
          window: { type: 'career', season_id: seasonId, game_id: next.gameId },
          context: { date: next.date, opponent_id: opp.teamId, opponent_name: opp.fullName, home: next.home },
          polarity: gap > 0 ? 'positive' : 'negative', proof: { ...q, match: { player_id: playerId } }, asOf: ctx.asOf,
          sample: { kind: 'share', p: (gap > 0 ? rank : opps - rank + 1) / opps },
          data: {
            games: Number(r.games), prev_games: Number(r.all_games), formatted: fmt(ppg), prev_formatted: fmt(all),
            prev_value: all, cur_value: ppg, label: ctx.recordsStart.label, higherIsBetter: true,
            career: careerComplete(r.first_season === null ? null : Number(r.first_season), ctx.recordsStart),
          },
          gameId: next.gameId, seasonId,
        });
      }
      return { facts, gameIds: null };
    },
  };
}
