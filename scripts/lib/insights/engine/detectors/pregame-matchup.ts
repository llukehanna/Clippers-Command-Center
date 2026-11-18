// scripts/lib/insights/engine/detectors/pregame-matchup.ts
// The next game (spec §2.2 pregame): the opponent's streak and last 10, the
// opponent's players on hot streaks (computed from box scores: rb_streaks holds
// Clipper streaks only), rest and back-to-backs for both teams, and the line.
//
// Opponent facts describe the NEXT GAME's season and phase, not the stats
// season (which stays on last season until the Clippers have played 10 games):
// they need complete league data, and league coverage is assessed for the stats
// season only, so when the next game is in another season it is unknown and they
// are skipped. A playoff game, or an opponent already in the postseason, gets no
// form, hot-player or rest facts (their streak queries are regular season).
import { nextClippersGame } from '../games.js';
import { runQuery } from '../query.js';
import { clippersTeamResultShare, playerHitRates, teamResultRate } from '../rates.js';
import { binomialTail, restDays, restSituations } from '../stats.js';
import type { Detector, Fact } from '../types.js';
import { LAC_POSTSEASON_SQL } from './season-ranks.js';
import { STREAKS, TEAM_LAST10_SQL, TEAM_STREAK_SQL, playerStreakSql, streakGames } from './season-streaks.js';

export const OPP_STREAK_MIN = 4;
export const HOT_NOUN: Record<string, string> = {
  scoring_20: '20+ points', scoring_30: '30+ points', rebounding_10: '10+ rebounds', threes_3: '3+ threes',
};

/** $1 LAC, $2 opponent, $3 next game date, $4 as-of: each team's last final game before the next one. */
export const REST_SQL = `
SELECT t.team_id::text AS team_id, MAX(g.game_date)::text AS last_game
FROM (VALUES ($1::bigint), ($2::bigint)) AS t(team_id)
JOIN games g ON t.team_id IN (g.home_team_id, g.away_team_id)
WHERE g.status = 'final' AND g.game_date < $3::date AND g.game_date <= $4::date
GROUP BY t.team_id
ORDER BY 1`.trim();

/** $1 next game, $2 LAC, $3 as-of: the latest snapshot captured by the end of the as-of day in Los Angeles. */
export const LINE_SQL = `
SELECT (CASE WHEN g.home_team_id = $2::bigint THEN o.spread_home ELSE o.spread_away END)::float8 AS lac_spread,
       o.total_points::float8 AS total, o.captured_at::text AS captured_at
FROM odds_snapshots o
JOIN all_games g ON g.game_id = o.game_id
WHERE o.game_id = $1::bigint
  AND o.captured_at < (($3::date + 1)::timestamp AT TIME ZONE 'America/Los_Angeles')
ORDER BY o.captured_at DESC
LIMIT 1`.trim();

export function matchupDetector(): Detector {
  return {
    name: 'pregame.matchup',
    surface: 'pregame',
    categories: ['opp_form', 'opp_hot_player', 'rest', 'line'],
    async run(ctx) {
      const next = await nextClippersGame(ctx);
      const opp = next ? ctx.teams.get(next.opponentId) : undefined;
      if (!next || !opp) return { facts: [], gameIds: null };
      const seasonId = next.seasonId;
      const base = {
        surface: 'pregame' as const, asOf: ctx.asOf, gameId: next.gameId, seasonId,
        context: { date: next.date, opponent_id: opp.teamId, opponent_name: opp.fullName, home: next.home },
      };
      const clippers = { type: 'team' as const, id: ctx.lac.teamId, name: 'Clippers' };
      const opponent = { type: 'team' as const, id: opp.teamId, name: opp.fullName };
      const facts: Fact[] = [];

      // League coverage is known for the stats season only.
      const leagueOk = ctx.league.complete && seasonId !== null && seasonId === ctx.season.id;
      // Regular-season form and streaks mean nothing once the next game, or the opponent, is in the postseason.
      const postseason = next.isPlayoffs || (seasonId !== null
        && (await runQuery({ sql: LAC_POSTSEASON_SQL, params: [seasonId, opp.teamId, ctx.asOf] }))[0]?.postseason === true);

      if (leagueOk && !postseason) {
        const formParams = [seasonId, opp.teamId, ctx.asOf];
        const sq = { sql: TEAM_STREAK_SQL, params: formParams };
        const lq = { sql: TEAM_LAST10_SQL, params: formParams };
        const [s] = await runQuery(sq);
        const [l] = await runQuery(lq);
        const games = Number(l?.games ?? 0);
        if (s && games > 0) {
          const winning = s.winning === true;
          const streak = Number(s.streak);
          const wins = Number(l.wins);
          const data = { wins, losses: games - wins, length: streak, winning, start_date: String(s.streak_start), end_date: String(s.streak_end) };
          if (streak >= OPP_STREAK_MIN) {
            const rate = await teamResultRate(ctx, winning, String(s.streak_start), opp.teamId);
            const pRef = await clippersTeamResultShare(ctx, winning, opp.teamId);
            facts.push({
              ...base, kind: 'opp_form', subject: opponent, stat: 'opp_streak', value: streak,
              window: { type: 'streak', season_id: seasonId, game_id: next.gameId }, polarity: 'neutral',
              proof: { ...sq, match: {} }, sample: { kind: 'rate', k: rate.k, n: rate.n, pRef, power: streak },
              keyExtra: String(s.streak_start), data,
            });
          }
          if (games === 10 && (wins >= 8 || wins <= 2)) {
            // Chance of a last 10 this extreme for a team with the opponent's own win share.
            const pWin = await clippersTeamResultShare(ctx, true, opp.teamId);
            facts.push({
              ...base, kind: 'opp_form', subject: opponent, stat: 'opp_last10', value: wins,
              window: { type: 'last_n', n: 10, season_id: seasonId, game_id: next.gameId }, polarity: 'neutral',
              proof: { ...lq, match: {} }, sample: { kind: 'share', p: binomialTail(10, wins, pWin, wins >= 8) }, data,
            });
          }
        }

        for (const def of STREAKS.filter((d) => d.key in HOT_NOUN)) {
          const hq = { sql: playerStreakSql(def), params: [seasonId, opp.teamId, def.minGames, ctx.asOf] };
          const rows = await runQuery(hq);
          if (rows.length === 0) continue;
          const { rates, pRef } = await playerHitRates(ctx, def.qualifies,
            rows.map((x) => ({ playerId: String(x.player_id), date: String(x.streak_start) })));
          for (const x of rows) {
            const playerId = String(x.player_id);
            const length = Number(x.streak);
            const rate = rates.get(playerId) ?? { k: 0, n: 0 };
            facts.push({
              ...base, kind: 'opp_hot_player', subject: { type: 'player', id: playerId, name: String(x.display_name) },
              stat: def.key, value: length, window: { type: 'streak', season_id: seasonId, game_id: next.gameId },
              polarity: 'neutral', proof: { ...hq, match: { player_id: playerId } },
              sample: { kind: 'rate', k: rate.k, n: rate.n, pRef, power: length },
              keyExtra: String(x.streak_start),
              data: {
                length, start_date: String(x.streak_start), end_date: String(x.streak_end),
                streak_games: streakGames(def, x.games as Record<string, unknown>[]), hit_threshold: def.threshold,
                noun: HOT_NOUN[def.key], opponent_player: true,
              },
            });
          }
        }
      }

      if (!postseason) {
        const rq = { sql: REST_SQL, params: [ctx.lac.teamId, opp.teamId, next.date, ctx.asOf] };
        const restRows = await runQuery(rq);
        const lastOf = (id: string) => (restRows.find((x) => String(x.team_id) === id)?.last_game as string | undefined) ?? null;
        const lacLast = lastOf(ctx.lac.teamId);
        const oppLast = leagueOk ? lastOf(opp.teamId) : null;
        const lacRest = restDays(lacLast, next.date);
        const oppRest = restDays(oppLast, next.date);
        for (const kind of restSituations(lacRest, oppRest)) {
          facts.push({
            ...base, kind: 'rest', subject: kind === 'opp_b2b' ? opponent : clippers, stat: kind,
            value: (kind === 'opp_b2b' ? oppRest : lacRest) ?? 0, window: { type: 'game', game_id: next.gameId },
            polarity: 'neutral',
            proof: { ...rq, match: kind === 'rest_edge' ? {} : { team_id: kind === 'opp_b2b' ? opp.teamId : ctx.lac.teamId } },
            sample: { kind: 'context' },
            data: { lac_rest: lacRest ?? undefined, opp_rest: oppRest ?? undefined, lac_last_game: lacLast ?? undefined, opp_last_game: oppLast ?? undefined },
          });
        }
      }

      const lq = { sql: LINE_SQL, params: [next.gameId, ctx.lac.teamId, ctx.asOf] };
      const [line] = await runQuery(lq);
      if (line && line.lac_spread !== null && line.lac_spread !== undefined) {
        facts.push({
          ...base, kind: 'line', subject: clippers, stat: 'spread', value: Number(line.lac_spread),
          window: { type: 'game', game_id: next.gameId }, polarity: 'neutral', proof: { ...lq, match: {} }, sample: { kind: 'context' },
          data: { spread: Number(line.lac_spread), total_points: line.total === null || line.total === undefined ? undefined : Number(line.total) },
        });
      }
      return { facts, gameIds: null };
    },
  };
}
