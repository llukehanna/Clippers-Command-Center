// scripts/lib/insights/engine/references.ts
// Reference sets the framer compares a game-level fact against (spec §2.3).
// Each is a SELECT of (value, game_id, game_date, season_id, subject_id,
// subject_name), regular season only, as of the cutoff. `group` starts at
// records start, so no frame cites an incomplete era. Pure.
import { REGULAR_SEASON } from '../../sql-fragments.js';
import type { EngineContext, Fact, ProofQuery, RecordsStart } from './types.js';

export interface RefSpec {
  /** Every Clippers occurrence since `start` (null: no records). */
  group: ProofQuery | null;
  /** The subject's own games, all teams, all data (career-high / nth-time questions). */
  subject: ProofQuery | null;
  /** League-wide this season (null: league data incomplete). */
  league: ProofQuery | null;
  start: RecordsStart | null;
  betterIsHigher: boolean;
  /** false for 0/1 facts (combos): no ranks, highs or career highs. */
  ordinal: boolean;
}

export interface PlayerGameStat { column: string; noun: string; plural: string; label: string }

export const PLAYER_GAME_STATS: Record<'pts' | 'reb' | 'ast' | 'fg3m' | 'stl' | 'blk', PlayerGameStat> = {
  pts: { column: 'points', noun: 'point', plural: 'points', label: 'scoring' },
  reb: { column: 'rebounds', noun: 'rebound', plural: 'rebounds', label: 'rebounding' },
  ast: { column: 'assists', noun: 'assist', plural: 'assists', label: 'assist' },
  fg3m: { column: 'fg3_made', noun: 'three', plural: 'threes', label: 'three-point' },
  stl: { column: 'steals', noun: 'steal', plural: 'steals', label: 'steal' },
  blk: { column: 'blocks', noun: 'block', plural: 'blocks', label: 'shot-blocking' },
};

const playerColumns = (valueExpr: string) =>
  `(${valueExpr})::float8 AS value, g.game_id::text AS game_id, g.game_date::text AS game_date,
       g.season_id::int AS season_id, pb.player_id::text AS subject_id, p.display_name AS subject_name`;

const playerFrom = `FROM game_player_box_scores pb
JOIN games g ON g.game_id = pb.game_id
JOIN players p ON p.player_id = pb.player_id`;

export function clippersPlayerRef(valueExpr: string, lacTeamId: string, start: RecordsStart, asOf: string): ProofQuery {
  return {
    sql: `SELECT ${playerColumns(valueExpr)}
${playerFrom}
WHERE pb.team_id = $1::bigint AND ${REGULAR_SEASON} AND g.season_id >= $2::int AND g.game_date <= $3::date
  AND (${valueExpr}) IS NOT NULL`,
    params: [lacTeamId, start.season_id, asOf],
  };
}

export function playerCareerRef(valueExpr: string, playerId: string, asOf: string): ProofQuery {
  return {
    sql: `SELECT ${playerColumns(valueExpr)}
${playerFrom}
WHERE pb.player_id = $1::bigint AND ${REGULAR_SEASON} AND g.game_date <= $2::date AND (${valueExpr}) IS NOT NULL`,
    params: [playerId, asOf],
  };
}

export function leagueSeasonPlayerRef(valueExpr: string, seasonId: number, asOf: string): ProofQuery {
  return {
    sql: `SELECT ${playerColumns(valueExpr)}
${playerFrom}
WHERE g.season_id = $1::int AND ${REGULAR_SEASON} AND g.game_date <= $2::date AND (${valueExpr}) IS NOT NULL`,
    params: [seasonId, asOf],
  };
}

/**
 * The as-of for a fact's reference sets. Postgame claims freeze after their
 * window, so they are measured at the time of the game: a later, higher game
 * must not falsify "most points since ...". Everything else reads as of the run.
 */
export function refAsOf(fact: Fact, ctx: EngineContext): string {
  return fact.surface === 'postgame' && fact.context.date < ctx.asOf ? fact.context.date : ctx.asOf;
}

function playerStatRefs(fact: Fact, ctx: EngineContext): RefSpec | null {
  const stat = PLAYER_GAME_STATS[fact.stat as keyof typeof PLAYER_GAME_STATS];
  if (!stat) return null;
  const expr = `pb.${stat.column}`;
  const asOf = refAsOf(fact, ctx);
  return {
    group: ctx.recordsStart ? clippersPlayerRef(expr, ctx.lac.teamId, ctx.recordsStart, asOf) : null,
    subject: playerCareerRef(expr, fact.subject.id, asOf),
    // League coverage is only assessed for the stats season: a fact in another season gets no league frames.
    league: ctx.league.complete && (fact.seasonId ?? ctx.season.id) === ctx.season.id
      ? leagueSeasonPlayerRef(expr, ctx.season.id, asOf) : null,
    start: ctx.recordsStart,
    betterIsHigher: true,
    ordinal: true,
  };
}

export interface ComboDef { key: 'pts30_reb10' | 'pts30_ast10' | 'triple_double'; cond: string; thing: string }

const TENS = `((pb.points >= 10)::int + (pb.rebounds >= 10)::int + (pb.assists >= 10)::int + (pb.steals >= 10)::int + (pb.blocks >= 10)::int)`;

/** Combined lines (non-ordinal: did it or didn't). */
export const COMBOS: ComboDef[] = [
  { key: 'pts30_reb10', cond: 'pb.points >= 30 AND pb.rebounds >= 10', thing: '30-point, 10-rebound game' },
  { key: 'pts30_ast10', cond: 'pb.points >= 30 AND pb.assists >= 10', thing: '30-point, 10-assist game' },
  { key: 'triple_double', cond: `${TENS} >= 3`, thing: 'triple-double' },
];

function comboRefs(fact: Fact, ctx: EngineContext): RefSpec | null {
  const combo = COMBOS.find((c) => c.key === fact.stat);
  if (!combo) return null;
  const expr = `CASE WHEN ${combo.cond} THEN 1 ELSE 0 END`;
  const asOf = refAsOf(fact, ctx);
  return {
    group: ctx.recordsStart ? clippersPlayerRef(expr, ctx.lac.teamId, ctx.recordsStart, asOf) : null,
    subject: playerCareerRef(expr, fact.subject.id, asOf),
    league: null,
    start: ctx.recordsStart,
    betterIsHigher: true,
    ordinal: false,
  };
}

export function refsFor(fact: Fact, ctx: EngineContext): RefSpec | null {
  switch (fact.kind) {
    case 'player_game_stat':
      return playerStatRefs(fact, ctx);
    case 'player_combo':
      return comboRefs(fact, ctx);
    default:
      return null;
  }
}
