// scripts/lib/insights/engine/games.ts
// Which Clippers games a run talks about, as of the cutoff.
import { sql } from '../../db.js';
import { REGULAR_SEASON } from '../../sql-fragments.js';
import { runQuery } from './query.js';
import { LATE_JOINERS_SQL } from './references.js';
import type { EngineContext } from './types.js';

export interface NextGame { gameId: string; date: string; home: boolean; opponentId: string; seasonId: number | null; isPlayoffs: boolean }

/** The next Clippers game: dated after as-of, or on as-of and not final yet. */
export async function nextClippersGame(ctx: EngineContext): Promise<NextGame | null> {
  const lac = ctx.lac.teamId;
  const [g] = await sql<{
    game_id: string; game_date: string; home_team_id: string; away_team_id: string; season_id: number | null; is_playoffs: boolean;
  }[]>`
    SELECT game_id::text, game_date::text AS game_date, home_team_id::text, away_team_id::text,
           season_id::int AS season_id, is_playoffs::boolean AS is_playoffs
    FROM games
    WHERE ${lac}::bigint IN (home_team_id, away_team_id)
      AND (game_date > ${ctx.asOf}::date OR (game_date = ${ctx.asOf}::date AND status <> 'final'))
    ORDER BY game_date, start_time_utc NULLS LAST
    LIMIT 1`;
  if (!g) return null;
  const home = g.home_team_id === lac;
  return {
    gameId: g.game_id, date: g.game_date, home, opponentId: home ? g.away_team_id : g.home_team_id,
    seasonId: g.season_id, isPlayoffs: g.is_playoffs,
  };
}

export interface PostgameGame {
  gameId: string;
  date: string;
  seasonId: number;
  home: boolean;
  opponentId: string;
  lacScore: number;
  oppScore: number;
  result: 'W' | 'L';
}

/** Final regular-season Clippers games with box scores: ctx.gameId, or those dated (asOf − postgameDays, asOf]. */
export async function postgameGames(ctx: EngineContext): Promise<PostgameGame[]> {
  const lac = ctx.lac.teamId;
  const rows = await sql<{
    game_id: string; game_date: string; season_id: number; home: boolean; opponent_id: string; lac_score: number; opp_score: number;
  }[]>`
    SELECT g.game_id::text AS game_id, g.game_date::text AS game_date, g.season_id::int AS season_id,
           (g.home_team_id = ${lac}::bigint) AS home,
           (CASE WHEN g.home_team_id = ${lac}::bigint THEN g.away_team_id ELSE g.home_team_id END)::text AS opponent_id,
           (CASE WHEN g.home_team_id = ${lac}::bigint THEN g.home_score ELSE g.away_score END)::int AS lac_score,
           (CASE WHEN g.home_team_id = ${lac}::bigint THEN g.away_score ELSE g.home_score END)::int AS opp_score
    FROM games g
    WHERE ${lac}::bigint IN (g.home_team_id, g.away_team_id)
      AND g.status = 'final' AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
      AND ${sql.unsafe(REGULAR_SEASON)} AND g.game_date <= ${ctx.asOf}::date
      AND EXISTS (SELECT 1 FROM game_player_box_scores pb WHERE pb.game_id = g.game_id AND pb.team_id = ${lac}::bigint)
      ${ctx.gameId
        ? sql`AND g.game_id = ${ctx.gameId}::bigint`
        : sql`AND g.game_date > ${ctx.asOf}::date - ${ctx.postgameDays}::int`}
    ORDER BY g.game_date, g.game_id`;
  return rows.map((r) => ({
    gameId: r.game_id, date: r.game_date, seasonId: r.season_id, home: r.home, opponentId: r.opponent_id,
    lacScore: r.lac_score, oppScore: r.opp_score, result: r.lac_score > r.opp_score ? 'W' : 'L',
  }));
}

/** The fields every postgame fact shares. */
export function gameFactBase(g: PostgameGame, ctx: EngineContext) {
  return {
    surface: 'postgame' as const,
    window: { type: 'game' as const, game_id: g.gameId, season_id: g.seasonId },
    context: {
      date: g.date, opponent_id: g.opponentId, opponent_name: ctx.teams.get(g.opponentId)?.fullName,
      home: g.home, result: g.result,
    },
    asOf: ctx.asOf,
    gameId: g.gameId,
    seasonId: g.seasonId,
  };
}

/**
 * Players whose first regular-season game for the Clippers in `seasonId` (through `asOf`, default the stats season and cutoff) came after the
 * Clippers' first one: acquired mid-season, so a season total over league box scores may miss games for
 * their previous team when league data is incomplete.
 */
export async function lateJoiners(ctx: EngineContext, seasonId: number = ctx.season.id, asOf: string = ctx.asOf): Promise<Set<string>> {
  const rows = await runQuery({ sql: LATE_JOINERS_SQL, params: [ctx.lac.teamId, seasonId, asOf] });
  return new Set(rows.map((r) => String(r.player_id)));
}
