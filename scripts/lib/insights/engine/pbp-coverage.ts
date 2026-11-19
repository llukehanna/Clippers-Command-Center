// scripts/lib/insights/engine/pbp-coverage.ts
// Are play-by-play records complete? A record frame over play-by-play ("largest
// comeback by the Clippers since 2020-21") is only true when every final
// regular-season Clippers game in that range has play-by-play; the records start
// admits seasons that are up to 5% short (records-start.ts). DB-free: the caller
// passes the Runner (query.ts in production).
import { REGULAR_SEASON } from '../../sql-fragments.js';
import type { EngineContext, Runner } from './types.js';

/**
 * $1 LAC, $2 first season (by season, not date: the 2019-20 bubble games run into Aug-Oct 2020), $3 before-date (exclusive), $4 as-of.
 * Counts final Clippers games whose play-by-play is incomplete: no game_flow row; or the Clippers' player period points (periods 1-4)
 * differ from their team period points (ingest drops player rows whose person is unknown); or a team clutch row exists and the
 * player clutch points differ from it. A game with no clutch row had no clutch time (rows are created lazily).
 */
export const PBP_MISSING_SQL = `
SELECT COUNT(*)::int AS missing
FROM games g
WHERE $1::bigint IN (g.home_team_id, g.away_team_id) AND g.status = 'final'
  AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL AND ${REGULAR_SEASON}
  AND g.season_id >= $2::int AND g.game_date < $3::date AND g.game_date <= $4::date
  AND (
    NOT EXISTS (SELECT 1 FROM game_flow gf WHERE gf.game_id = g.game_id)
    OR COALESCE((SELECT SUM(pp.pts) FROM period_player_stats pp
                 WHERE pp.game_id = g.game_id AND pp.team_id = $1::bigint AND pp.period <= 4), 0)
       <> COALESCE((SELECT SUM(pt.pts) FROM period_team_stats pt
                    WHERE pt.game_id = g.game_id AND pt.team_id = $1::bigint AND pt.period <= 4), 0)
    OR EXISTS (SELECT 1 FROM clutch_stats ct
               WHERE ct.game_id = g.game_id AND ct.team_id = $1::bigint AND ct.player_id IS NULL
                 AND ct.pts <> COALESCE((SELECT SUM(c.pts) FROM clutch_stats c
                                         WHERE c.game_id = g.game_id AND c.team_id = $1::bigint AND c.player_id IS NOT NULL), 0))
  )`.trim();

/** One answer per context and date bound, so a run asks the database once per distinct fact date. */
const cache = new WeakMap<EngineContext, Map<string, Promise<boolean>>>();

/**
 * True when no final regular-season Clippers game dated from the start of the play-by-play
 * records up to, but not including, `beforeDate` lacks a game_flow row. False without play-by-play
 * records. Postgame-flow, quarter and clutch frames of "since {records label}" depend on it.
 */
export function pbpRecordsComplete(ctx: EngineContext, beforeDate: string, run: Runner): Promise<boolean> {
  const start = ctx.pbpRecordsStart;
  if (!start) return Promise.resolve(false);
  const key = `${start.season_id}|${beforeDate}|${ctx.asOf}`;
  let byDate = cache.get(ctx);
  if (!byDate) cache.set(ctx, (byDate = new Map()));
  let answer = byDate.get(key);
  if (!answer) {
    answer = run({ sql: PBP_MISSING_SQL, params: [ctx.lac.teamId, start.season_id, beforeDate, ctx.asOf] })
      .then(([r]) => Number(r?.missing ?? 1) === 0);
    byDate.set(key, answer);
    answer.catch(() => byDate!.delete(key));
  }
  return answer;
}
