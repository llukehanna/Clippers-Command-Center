// scripts/lib/insights/engine/detectors/pregame-opponent.ts
// The next game's opponent (v1 opponent-context.ts on the v2 engine): their
// offense/defense rank, the season series and the last meeting. Stats come
// from the stats season, so before the opener the preview uses last season's
// numbers and says so.
import { fmt, isReportableLeagueRank } from '../../proof-utils.js';
import { nextClippersGame } from '../games.js';
import { runQuery } from '../query.js';
import type { Detector, Fact } from '../types.js';
import { MIN_TEAM_GAMES, TEAM_METRICS } from './metrics.js';
import { teamRankSql } from './season-ranks.js';

/** $1 season, $2 min games, $3 opponent, $4 as-of. Same shape as the Clippers' own team rank. */
export function oppRankSql(metric: 'off_rating' | 'def_rating'): string {
  return teamRankSql(TEAM_METRICS.find((m) => m.key === metric)!);
}

/** $1 LAC, $2 opponent, $3 season, $4 as-of. */
export const H2H_SQL = `
SELECT
  COUNT(*) FILTER (WHERE (g.home_team_id = $1::bigint) = (g.home_score > g.away_score))::int AS clippers_wins,
  COUNT(*) FILTER (WHERE (g.home_team_id = $1::bigint) <> (g.home_score > g.away_score))::int AS opp_wins,
  COUNT(*)::int AS total_games
FROM games g
WHERE ((g.home_team_id = $1::bigint AND g.away_team_id = $2::bigint)
    OR (g.home_team_id = $2::bigint AND g.away_team_id = $1::bigint))
  AND g.season_id = $3::int AND g.game_date <= $4::date
  AND g.status = 'final' AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL`.trim();

/** $1 LAC, $2 opponent, $3 next game date, $4 as-of. */
export const LAST_MEETING_SQL = `
SELECT g.game_id::text AS game_id, g.game_date::text AS game_date,
       (g.home_team_id = $1::bigint) AS clippers_home,
       g.home_score::int AS home_score, g.away_score::int AS away_score
FROM games g
WHERE ((g.home_team_id = $1::bigint AND g.away_team_id = $2::bigint)
    OR (g.home_team_id = $2::bigint AND g.away_team_id = $1::bigint))
  AND g.status = 'final' AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
  AND g.game_date < $3::date AND g.game_date <= $4::date
ORDER BY g.game_date DESC
LIMIT 1`.trim();

export function opponentDetector(): Detector {
  return {
    name: 'pregame.opponent',
    surface: 'pregame',
    categories: ['opp_rank', 'h2h', 'last_meeting'],
    async run(ctx) {
      const next = await nextClippersGame(ctx);
      const opp = next ? ctx.teams.get(next.opponentId) : undefined;
      if (!next || !opp) return { facts: [], gameIds: null };
      const base = {
        surface: 'pregame' as const, asOf: ctx.asOf, gameId: next.gameId,
        context: { date: next.date, opponent_id: opp.teamId, opponent_name: opp.fullName, home: next.home },
      };
      const clippers = { type: 'team' as const, id: ctx.lac.teamId, name: 'Clippers' };
      const facts: Fact[] = [];

      if (ctx.league.complete) {
        for (const metric of ['def_rating', 'off_rating'] as const) {
          const q = { sql: oppRankSql(metric), params: [ctx.season.id, MIN_TEAM_GAMES, opp.teamId, ctx.asOf] };
          const [r] = await runQuery(q);
          if (!r) continue;
          const rank = Number(r.rank);
          const total = Number(r.total_teams);
          if (!isReportableLeagueRank(rank, total)) continue;
          const fromBottom = total - rank + 1;
          facts.push({
            ...base, kind: 'opp_rank', subject: { type: 'team', id: opp.teamId, name: opp.fullName },
            stat: `opp_${metric}`, value: rank,
            window: { type: 'season', season_id: ctx.season.id, game_id: next.gameId },
            polarity: 'neutral', proof: { ...q, match: {} },
            sample: { kind: 'share', p: Math.min(rank, fromBottom) / total },
            data: {
              rank, total, bottom: rank > fromBottom, side: metric === 'def_rating' ? 'defense' : 'offense',
              label: metric === 'def_rating' ? 'defensive rating' : 'offensive rating',
              formatted: fmt(Number(r.value)), higherIsBetter: metric === 'off_rating',
            },
            seasonId: ctx.season.id,
          });
        }
      }

      {
        const q = { sql: H2H_SQL, params: [ctx.lac.teamId, opp.teamId, ctx.season.id, ctx.asOf] };
        const [r] = await runQuery(q);
        if (r && Number(r.total_games) > 0) {
          facts.push({
            ...base, kind: 'h2h', subject: clippers, stat: 'h2h', value: Number(r.clippers_wins),
            window: { type: 'season', season_id: ctx.season.id, game_id: next.gameId },
            polarity: 'neutral', proof: { ...q, match: {} }, sample: { kind: 'context' },
            data: { wins: Number(r.clippers_wins), opp_wins: Number(r.opp_wins), meetings: Number(r.total_games) },
            seasonId: ctx.season.id,
          });
        }
      }

      {
        const q = { sql: LAST_MEETING_SQL, params: [ctx.lac.teamId, opp.teamId, next.date, ctx.asOf] };
        const [r] = await runQuery(q);
        if (r) {
          const home = r.clippers_home === true;
          const lacScore = Number(home ? r.home_score : r.away_score);
          const oppScore = Number(home ? r.away_score : r.home_score);
          facts.push({
            ...base, kind: 'last_meeting', subject: clippers, stat: 'last_meeting', value: lacScore - oppScore,
            window: { type: 'game', game_id: next.gameId },
            polarity: 'neutral', proof: { ...q, match: {} }, sample: { kind: 'context' },
            data: { lac_score: lacScore, opp_score: oppScore, meeting_date: String(r.game_date), meeting_home: home },
            seasonId: null,
          });
        }
      }
      return { facts, gameIds: null };
    },
  };
}
