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
import { STREAKS, TEAM_FORM_SQL, playerStreakSql, streakGames } from './season-streaks.js';

export const OPP_STREAK_MIN = 4;
export const HOT_NOUN: Record<string, string> = {
  scoring_20: '20+ points', scoring_30: '30+ points', rebounding_10: '10+ rebounds', threes_3: '3+ threes',
};

/**
 * $1 LAC, $2 opponent, $3 next game date: each team's last scheduled game before the next one, played or not
 * (the schedule is known; a game between as-of and the next game still costs rest). Preseason games don't count
 * (all_games holds the Clippers' preseason; FW-9). Mirrors the game page's rest query (src/lib/data/game-preview.ts,
 * preview:rest). Statuses are scheduled | in_progress | final only.
 */
export const REST_SQL = `
SELECT t.team_id::text AS team_id, MAX(g.game_date)::text AS last_game
FROM (VALUES ($1::bigint), ($2::bigint)) AS t(team_id)
JOIN all_games g ON t.team_id IN (g.home_team_id, g.away_team_id)
WHERE g.game_date < $3::date AND g.game_date >= $3::date - 30 AND NOT g.is_preseason
GROUP BY t.team_id
ORDER BY 1`.trim();

const lineSql = (bound: string) => `
SELECT (CASE WHEN g.home_team_id = $2::bigint THEN o.spread_home ELSE o.spread_away END)::float8 AS lac_spread,
       o.total_points::float8 AS total, o.captured_at::text AS captured_at
FROM odds_snapshots o
JOIN all_games g ON g.game_id = o.game_id
WHERE o.game_id = $1::bigint
  AND o.captured_at < (($3::date + 1)::timestamp AT TIME ZONE 'America/Los_Angeles')${bound}
  AND (g.start_time_utc IS NULL OR o.captured_at <= g.start_time_utc)
  AND (CASE WHEN g.home_team_id = $2::bigint THEN o.spread_home ELSE o.spread_away END) IS NOT NULL
ORDER BY o.captured_at DESC
LIMIT 1`.trim();

/** $1 next game, $2 LAC, $3 as-of: the latest snapshot with a Clippers spread, captured by the end of the as-of day in Los Angeles and before tip. */
export const LINE_SQL = lineSql('');

/**
 * The line's stored proof: LINE_SQL bounded by the chosen snapshot's captured_at ($4), so a sync-odds run landing
 * between Generate and Verify cannot change the row it re-selects (FW-10).
 */
export const LINE_PROOF_SQL = lineSql('\n  AND o.captured_at <= $4::timestamptz');

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
        const fq = { sql: TEAM_FORM_SQL, params: [seasonId, opp.teamId, ctx.asOf] };
        const [f] = await runQuery(fq);
        const games = Number(f?.last10_games ?? 0);
        if (f && games > 0) {
          const winning = f.winning === true;
          const streak = Number(f.streak);
          const wins = Number(f.last10_wins);
          const data = { wins, losses: games - wins, length: streak, winning, start_date: String(f.streak_start), end_date: String(f.streak_end) };
          if (streak >= OPP_STREAK_MIN) {
            const rate = await teamResultRate(ctx, winning, String(f.streak_start), opp.teamId);
            const pRef = await clippersTeamResultShare(ctx, winning, opp.teamId);
            facts.push({
              ...base, kind: 'opp_form', subject: opponent, stat: 'opp_streak', value: streak,
              window: { type: 'streak', season_id: seasonId, game_id: next.gameId }, polarity: 'neutral',
              proof: { ...fq, match: {} }, sample: { kind: 'rate', k: rate.k, n: rate.n, pRef, power: streak },
              keyExtra: String(f.streak_start), data,
            });
          }
          if (games === 10 && (wins >= 8 || wins <= 2)) {
            // Chance of a last 10 this extreme for a team with the opponent's own win share.
            const pWin = await clippersTeamResultShare(ctx, true, opp.teamId);
            facts.push({
              ...base, kind: 'opp_form', subject: opponent, stat: 'opp_last10', value: wins,
              window: { type: 'last_n', n: 10, season_id: seasonId, game_id: next.gameId }, polarity: 'neutral',
              proof: { ...fq, match: {} }, sample: { kind: 'share', p: binomialTail(10, wins, pWin, wins >= 8) }, data,
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
        const rq = { sql: REST_SQL, params: [ctx.lac.teamId, opp.teamId, next.date] };
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

      const [line] = await runQuery({ sql: LINE_SQL, params: [next.gameId, ctx.lac.teamId, ctx.asOf] });
      if (line && line.lac_spread !== null && line.lac_spread !== undefined) {
        const proof = { sql: LINE_PROOF_SQL, params: [next.gameId, ctx.lac.teamId, ctx.asOf, String(line.captured_at)], match: {} };
        facts.push({
          ...base, kind: 'line', subject: clippers, stat: 'spread', value: Number(line.lac_spread),
          window: { type: 'game', game_id: next.gameId }, polarity: 'neutral', proof, sample: { kind: 'context' },
          data: { spread: Number(line.lac_spread), total_points: line.total === null || line.total === undefined ? undefined : Number(line.total) },
        });
      }
      return { facts, gameIds: null };
    },
  };
}
