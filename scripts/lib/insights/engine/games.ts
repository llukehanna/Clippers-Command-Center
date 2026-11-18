// scripts/lib/insights/engine/games.ts
// Which Clippers games a run talks about, as of the cutoff.
import { sql } from '../../db.js';
import type { EngineContext } from './types.js';

export interface NextGame { gameId: string; date: string; home: boolean; opponentId: string }

/** The next Clippers game: dated after as-of, or on as-of and not final yet. */
export async function nextClippersGame(ctx: EngineContext): Promise<NextGame | null> {
  const lac = ctx.lac.teamId;
  const [g] = await sql<{ game_id: string; game_date: string; home_team_id: string; away_team_id: string }[]>`
    SELECT game_id::text, game_date::text AS game_date, home_team_id::text, away_team_id::text
    FROM games
    WHERE ${lac}::bigint IN (home_team_id, away_team_id)
      AND (game_date > ${ctx.asOf}::date OR (game_date = ${ctx.asOf}::date AND status <> 'final'))
    ORDER BY game_date, start_time_utc NULLS LAST
    LIMIT 1`;
  if (!g) return null;
  const home = g.home_team_id === lac;
  return { gameId: g.game_id, date: g.game_date, home, opponentId: home ? g.away_team_id : g.home_team_id };
}

/** Final Clippers games of the stats season, as of the cutoff. */
export async function clippersSeasonGameIds(ctx: EngineContext): Promise<string[]> {
  const rows = await sql<{ game_id: string }[]>`
    SELECT g.game_id::text AS game_id
    FROM games g
    WHERE ${ctx.lac.teamId}::bigint IN (g.home_team_id, g.away_team_id)
      AND g.season_id = ${ctx.season.id} AND g.status = 'final' AND g.game_date <= ${ctx.asOf}::date`;
  return rows.map((r) => r.game_id);
}
