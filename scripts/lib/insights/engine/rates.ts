// scripts/lib/insights/engine/rates.ts
// The scorer's k/n and p_ref (spec §2.4): the subject's PRIOR opportunities
// over the stats season and the one before, and the rate across Clippers
// player-games since records start.
import { sql } from '../../db.js';
import { REGULAR_SEASON } from '../../sql-fragments.js';
import type { EngineContext } from './types.js';

export interface Rate { k: number; n: number }

const regular = () => sql.unsafe(REGULAR_SEASON);
const recordsFrom = (ctx: EngineContext) => ctx.recordsStart?.season_id ?? ctx.season.id - 1;

/** Share of Clippers player-games since records start where `predicate` (over pb) holds. */
export async function clippersPlayerRate(ctx: EngineContext, predicate: string): Promise<number> {
  const [r] = await sql<{ p: number }[]>`
    SELECT COALESCE(AVG((${sql.unsafe(predicate)})::int), 0)::float8 AS p
    FROM game_player_box_scores pb
    JOIN games g ON g.game_id = pb.game_id
    WHERE pb.team_id = ${ctx.lac.teamId}::bigint AND g.season_id >= ${recordsFrom(ctx)}
      AND g.game_date <= ${ctx.asOf}::date AND ${regular()}`;
  return r?.p ?? 0;
}

/** Per player: games where `predicate` held / games, before that player's date (streak start). */
export async function playerHitRates(
  ctx: EngineContext, predicate: string, before: { playerId: string; date: string }[],
): Promise<{ rates: Map<string, Rate>; pRef: number }> {
  if (before.length === 0) return { rates: new Map(), pRef: 0 };
  const rows = await sql<{ player_id: string; k: number; n: number }[]>`
    SELECT pb.player_id::text AS player_id,
           COUNT(*) FILTER (WHERE ${sql.unsafe(predicate)})::int AS k,
           COUNT(*)::int AS n
    FROM game_player_box_scores pb
    JOIN games g ON g.game_id = pb.game_id
    JOIN unnest(${before.map((b) => b.playerId)}::bigint[], ${before.map((b) => b.date)}::date[]) AS s(player_id, before_date)
      ON s.player_id = pb.player_id
    WHERE g.season_id >= ${ctx.season.id - 1} AND g.game_date < s.before_date AND g.game_date <= ${ctx.asOf}::date AND ${regular()}
    GROUP BY pb.player_id`;
  return { rates: new Map(rows.map((r) => [r.player_id, { k: r.k, n: r.n }])), pRef: await clippersPlayerRate(ctx, predicate) };
}

/** The Clippers' wins (or losses) / games before `beforeDate`, stats season and the one before. */
export async function teamResultRate(ctx: EngineContext, wins: boolean, beforeDate: string): Promise<Rate> {
  const lac = ctx.lac.teamId;
  const [r] = await sql<{ k: number; n: number }[]>`
    SELECT COUNT(*) FILTER (WHERE ((g.home_team_id = ${lac}::bigint) = (g.home_score > g.away_score)) = ${wins}::boolean)::int AS k,
           COUNT(*)::int AS n
    FROM games g
    WHERE ${lac}::bigint IN (g.home_team_id, g.away_team_id) AND g.status = 'final'
      AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
      AND g.season_id >= ${ctx.season.id - 1} AND g.game_date < ${beforeDate}::date AND g.game_date <= ${ctx.asOf}::date AND ${regular()}`;
  return { k: r?.k ?? 0, n: r?.n ?? 0 };
}

/** A player's earlier games (strictly before `factDate`, never past asOf) at or above `value` (k/n) and the Clippers-wide rate over the same games, excluding the fact's game. */
export async function playerValueRate(
  ctx: EngineContext, column: string, playerId: string, value: number, gameId: string, factDate: string,
): Promise<{ k: number; n: number; pRef: number }> {
  const col = sql.unsafe(`pb.${column}`);
  const lac = ctx.lac.teamId;
  const [r] = await sql<{ k: number; n: number; p_ref: number }[]>`
    SELECT COUNT(*) FILTER (WHERE pb.player_id = ${playerId}::bigint AND g.season_id >= ${ctx.season.id - 1} AND ${col} >= ${value}::float8)::int AS k,
           COUNT(*) FILTER (WHERE pb.player_id = ${playerId}::bigint AND g.season_id >= ${ctx.season.id - 1})::int AS n,
           COALESCE(AVG((${col} >= ${value}::float8)::int) FILTER (WHERE pb.team_id = ${lac}::bigint AND g.season_id >= ${recordsFrom(ctx)}), 0)::float8 AS p_ref
    FROM game_player_box_scores pb
    JOIN games g ON g.game_id = pb.game_id
    WHERE (pb.player_id = ${playerId}::bigint OR pb.team_id = ${lac}::bigint)
      AND pb.game_id <> ${gameId}::bigint AND g.game_date < ${factDate}::date AND g.game_date <= ${ctx.asOf}::date
      AND ${regular()} AND ${col} IS NOT NULL`;
  return { k: r?.k ?? 0, n: r?.n ?? 0, pRef: r?.p_ref ?? 0 };
}

/** Share of completed Clippers player-seasons (>= 20 games, since records start) whose total reached `threshold`; (k+1)/(n+2). */
export async function seasonTotalShare(ctx: EngineContext, expr: string, threshold: number): Promise<number> {
  const [r] = await sql<{ k: number; n: number }[]>`
    SELECT COUNT(*) FILTER (WHERE total >= ${threshold}::float8)::int AS k, COUNT(*)::int AS n
    FROM (
      SELECT pb.player_id, g.season_id, (${sql.unsafe(expr)})::float8 AS total
      FROM game_player_box_scores pb
      JOIN games g ON g.game_id = pb.game_id
      WHERE pb.team_id = ${ctx.lac.teamId}::bigint AND g.season_id >= ${recordsFrom(ctx)} AND g.season_id < ${ctx.season.id}
        AND g.game_date <= ${ctx.asOf}::date AND ${regular()}
      GROUP BY pb.player_id, g.season_id
      HAVING COUNT(*) >= 20
    ) s`;
  return ((r?.k ?? 0) + 1) / ((r?.n ?? 0) + 2);
}

/** Share of the Clippers' final regular-season games won (or lost) from records start through as-of, Laplace-smoothed (k+1)/(n+2) so it is strictly inside (0,1); the team streak's p_ref. */
export async function clippersTeamResultShare(ctx: EngineContext, wins: boolean): Promise<number> {
  const lac = ctx.lac.teamId;
  const [r] = await sql<{ k: number; n: number }[]>`
    SELECT COUNT(*) FILTER (WHERE ((g.home_team_id = ${lac}::bigint) = (g.home_score > g.away_score)) = ${wins}::boolean)::int AS k,
           COUNT(*)::int AS n
    FROM games g
    WHERE ${lac}::bigint IN (g.home_team_id, g.away_team_id) AND g.status = 'final'
      AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
      AND g.season_id >= ${recordsFrom(ctx)} AND g.game_date <= ${ctx.asOf}::date AND ${regular()}`;
  return ((r?.k ?? 0) + 1) / ((r?.n ?? 0) + 2);
}
