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
  /** Minimum league sample for a league_rank frame (default MIN_LEAGUE_SAMPLE). */
  leagueMin?: number;
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

/** NULL-safe: a missing stat counts as not reaching the mark, never as an unknown that voids the whole sum. */
const atLeast = (col: string, n: number) => `COALESCE(pb.${col} >= ${n}, FALSE)`;
export const TENS = `(${['points', 'rebounds', 'assists', 'steals', 'blocks'].map((c) => `${atLeast(c, 10)}::int`).join(' + ')})`;

/** Two or more categories at 10 (NULL-safe like TENS). */
export const DOUBLE_DOUBLE = `${TENS} >= 2`;

/** Combined lines (non-ordinal: did it or didn't). */
export const COMBOS: ComboDef[] = [
  { key: 'pts30_reb10', cond: `${atLeast('points', 30)} AND ${atLeast('rebounds', 10)}`, thing: '30-point, 10-rebound game' },
  { key: 'pts30_ast10', cond: `${atLeast('points', 30)} AND ${atLeast('assists', 10)}`, thing: '30-point, 10-assist game' },
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

export interface TeamGameStat {
  /** SQL over game_team_box_scores t (Clippers) and o (opponent). */
  expr: string;
  betterIsHigher: boolean;
  /** At or past this value the fact is built (<= for lower-is-better). */
  floor: number;
  when: 'any' | 'W' | 'L';
  polarity: 'positive' | 'negative';
  thing: (v: number) => string;
  best: string;
  fmt: (v: number) => string;
}

const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;

/** FG% at display precision (3 decimals): the fact value and every reference set use this one expression, so ties and ranks agree with the copy. */
export const FG_PCT_EXPR = 'ROUND((t.fg_made::numeric / NULLIF(t.fg_attempted, 0)), 3)::float8';

export const TEAM_GAME_STATS: Record<'team_pts' | 'team_fg3m' | 'team_fg_pct' | 'margin' | 'loss_margin' | 'opp_pts_low', TeamGameStat> = {
  team_pts: { expr: 't.points', betterIsHigher: true, floor: 120, when: 'any', polarity: 'positive', thing: (v) => `${v}-point game`, best: 'most points in a game', fmt: String },
  team_fg3m: { expr: 't.fg3_made', betterIsHigher: true, floor: 18, when: 'any', polarity: 'positive', thing: (v) => `${v}-three game`, best: 'most threes in a game', fmt: String },
  team_fg_pct: { expr: FG_PCT_EXPR, betterIsHigher: true, floor: 0.55, when: 'any', polarity: 'positive', thing: (v) => `${pct1(v)} shooting game`, best: 'best shooting game', fmt: pct1 },
  margin: { expr: 't.points - o.points', betterIsHigher: true, floor: 20, when: 'W', polarity: 'positive', thing: (v) => `${v}-point win`, best: 'largest win', fmt: String },
  loss_margin: { expr: 'o.points - t.points', betterIsHigher: true, floor: 20, when: 'L', polarity: 'negative', thing: (v) => `${v}-point loss`, best: 'worst loss', fmt: String },
  opp_pts_low: { expr: 'o.points', betterIsHigher: false, floor: 95, when: 'any', polarity: 'positive', thing: (v) => `game allowing ${v}`, best: 'fewest points allowed', fmt: String },
};

/** $1 game, $2 LAC. Every team stat column is the stat's own expr, so a fact value and its reference sets cannot drift. */
export const TEAM_LINE_SQL = `
SELECT t.points::int AS team_pts, t.fg3_made::int AS team_fg3m, t.fg_attempted::int AS fga,
       ${TEAM_GAME_STATS.team_fg_pct.expr} AS team_fg_pct,
       (${TEAM_GAME_STATS.margin.expr})::int AS margin, (${TEAM_GAME_STATS.loss_margin.expr})::int AS loss_margin, (${TEAM_GAME_STATS.opp_pts_low.expr})::int AS opp_pts_low
FROM game_team_box_scores t
JOIN game_team_box_scores o ON o.game_id = t.game_id AND o.team_id <> t.team_id
WHERE t.game_id = $1::bigint AND t.team_id = $2::bigint`.trim();

const teamColumns = (expr: string) =>
  `(${expr})::float8 AS value, g.game_id::text AS game_id, g.game_date::text AS game_date,
       g.season_id::int AS season_id, t.team_id::text AS subject_id, tt.name AS subject_name`;
const teamFrom = `FROM game_team_box_scores t
JOIN game_team_box_scores o ON o.game_id = t.game_id AND o.team_id <> t.team_id
JOIN games g ON g.game_id = t.game_id
JOIN teams tt ON tt.team_id = t.team_id`;

export function clippersTeamRef(expr: string, lacTeamId: string, start: RecordsStart, asOf: string): ProofQuery {
  return {
    sql: `SELECT ${teamColumns(expr)}
${teamFrom}
WHERE t.team_id = $1::bigint AND ${REGULAR_SEASON} AND g.season_id >= $2::int AND g.game_date <= $3::date AND (${expr}) IS NOT NULL`,
    params: [lacTeamId, start.season_id, asOf],
  };
}

export function leagueSeasonTeamRef(expr: string, seasonId: number, asOf: string): ProofQuery {
  return {
    sql: `SELECT ${teamColumns(expr)}
${teamFrom}
WHERE g.season_id = $1::int AND ${REGULAR_SEASON} AND g.game_date <= $2::date AND (${expr}) IS NOT NULL`,
    params: [seasonId, asOf],
  };
}

function teamStatRefs(fact: Fact, ctx: EngineContext): RefSpec | null {
  const stat = TEAM_GAME_STATS[fact.stat as keyof typeof TEAM_GAME_STATS];
  if (!stat) return null;
  const asOf = refAsOf(fact, ctx);
  return {
    group: ctx.recordsStart ? clippersTeamRef(stat.expr, ctx.lac.teamId, ctx.recordsStart, asOf) : null,
    subject: null,
    // No league frame for losses by design (a league-wide worst-loss rank is not a Clippers claim); league coverage covers the stats season only.
    league: ctx.league.complete && fact.stat !== 'loss_margin' && (fact.seasonId ?? ctx.season.id) === ctx.season.id
      ? leagueSeasonTeamRef(stat.expr, ctx.season.id, asOf) : null,
    start: ctx.recordsStart,
    betterIsHigher: stat.betterIsHigher,
    ordinal: true,
    leagueMin: 500,
  };
}

// ── Game flow (play-by-play) ────────────────────────────────────────────────

export type FlowKey = 'comeback' | 'largest_lead' | 'blown_lead' | 'best_run' | 'lead_changes';

export interface FlowStat {
  /** SQL over game_flow gf and games g; `lac` is the bind placeholder holding the Clippers' team id ('$1', '$2'). */
  expr: (lac: string) => string;
  floor: number;
  when: 'any' | 'W' | 'L';
  polarity: 'positive' | 'negative' | 'neutral';
  thing: (v: number) => string;
  best: string;
  /** Who the stat belongs to: lead changes are a both-teams stat. */
  by: string;
}

const lacWon = (lac: string) => `((g.home_team_id = ${lac}::bigint) = (g.home_score > g.away_score))`;

export const FLOW_STATS: Record<FlowKey, FlowStat> = {
  comeback: { expr: () => 'COALESCE(gf.comeback_margin, 0)', floor: 10, when: 'W', polarity: 'positive', thing: (v) => `${v}-point comeback`, best: 'largest comeback win', by: 'by the Clippers' },
  largest_lead: { expr: (lac) => `CASE WHEN ${lacWon(lac)} THEN gf.lac_largest_lead ELSE 0 END`, floor: 20, when: 'W', polarity: 'positive', thing: (v) => `${v}-point lead in a win`, best: 'largest lead in a win', by: 'by the Clippers' },
  blown_lead: { expr: (lac) => `CASE WHEN ${lacWon(lac)} THEN 0 ELSE gf.lac_largest_lead END`, floor: 15, when: 'L', polarity: 'negative', thing: (v) => `blown ${v}-point lead`, best: 'largest blown lead', by: 'by the Clippers' },
  best_run: { expr: () => 'gf.lac_best_run', floor: 14, when: 'any', polarity: 'positive', thing: (v) => `${v}-0 run`, best: 'longest scoring run', by: 'by the Clippers' },
  lead_changes: { expr: () => 'gf.lead_changes', floor: 20, when: 'any', polarity: 'neutral', thing: (v) => `${v} lead changes`, best: 'most lead changes', by: 'in a Clippers game' },
};

/**
 * $1 game, $2 LAC. Each stat column is the stat's own expr (the expression its reference sets use too),
 * so the fact value and the frames cannot drift. The margin series rides along so the evidence is in the receipts.
 */
export const FLOW_SQL = `
SELECT ${(Object.entries(FLOW_STATS) as [FlowKey, FlowStat][]).map(([key, s]) => `(${s.expr('$2')})::int AS ${key}`).join(',\n       ')},
       gf.lac_largest_lead::int AS lac_lead, gf.lac_largest_deficit::int AS lac_deficit, gf.margin_series::jsonb AS margin_series
FROM game_flow gf
JOIN games g ON g.game_id = gf.game_id
WHERE gf.game_id = $1::bigint AND $2::bigint IN (g.home_team_id, g.away_team_id)`.trim();

/** Every Clippers regular-season game with play-by-play since `start`; `expr` is built with lac = '$1'. */
export function clippersFlowRef(expr: string, lacTeamId: string, start: RecordsStart, asOf: string): ProofQuery {
  return {
    sql: `SELECT (${expr})::float8 AS value, g.game_id::text AS game_id, g.game_date::text AS game_date, g.season_id::int AS season_id,
       ($1::bigint)::text AS subject_id, 'Clippers'::text AS subject_name
FROM game_flow gf
JOIN games g ON g.game_id = gf.game_id
WHERE $1::bigint IN (g.home_team_id, g.away_team_id) AND ${REGULAR_SEASON} AND g.season_id >= $2::int AND g.game_date <= $3::date
  AND (${expr}) IS NOT NULL`,
    params: [lacTeamId, start.season_id, asOf],
  };
}

function flowRefs(fact: Fact, ctx: EngineContext): RefSpec | null {
  const stat = FLOW_STATS[fact.stat as FlowKey];
  if (!stat || !ctx.pbpRecordsStart) return null;
  return {
    group: clippersFlowRef(stat.expr('$1'), ctx.lac.teamId, ctx.pbpRecordsStart, refAsOf(fact, ctx)),
    subject: null, league: null, start: ctx.pbpRecordsStart, betterIsHigher: true, ordinal: true,
  };
}

// ── Quarters, halves and clutch (play-by-play) ─────────────────────────────

/** Regulation only (period <= 4): overtime periods are neither quarters nor halves. $1 game, $2 LAC. */
export const PLAYER_PERIODS_SQL = `
SELECT pp.player_id::text AS player_id, p.display_name::text AS display_name, pp.period::int AS period, pp.pts::int AS pts
FROM period_player_stats pp
JOIN players p ON p.player_id = pp.player_id
WHERE pp.game_id = $1::bigint AND pp.team_id = $2::bigint AND pp.period <= 4
ORDER BY pp.player_id, pp.period`.trim();

/** $1 game, $2 LAC. */
export const TEAM_PERIODS_SQL = `
SELECT pt.period::int AS period, pt.pts::int AS pts
FROM period_team_stats pt
WHERE pt.game_id = $1::bigint AND pt.team_id = $2::bigint AND pt.period <= 4
ORDER BY pt.period`.trim();

/** Clutch: the last 5:00 of the 4th and overtime with the margin within 5. Player rows only. $1 game, $2 LAC. */
export const CLUTCH_SQL = `
SELECT c.player_id::text AS player_id, p.display_name::text AS display_name, c.pts::int AS pts, c.fgm::int AS fgm, c.fga::int AS fga,
       c.ftm::int AS ftm, c.fta::int AS fta
FROM clutch_stats c
JOIN players p ON p.player_id = c.player_id
WHERE c.game_id = $1::bigint AND c.team_id = $2::bigint AND c.player_id IS NOT NULL
ORDER BY c.pts DESC, p.display_name`.trim();

/** Season floor by season_id (the 2019-20 bubble ran into Oct 2020), regular season, through the as-of date. */
const pbpWhere = `${REGULAR_SEASON} AND g.season_id >= $2::int AND g.game_date <= $3::date`;

/** One row per Clippers player-game: that player's best regulation quarter. */
export function clippersQuarterRef(lacTeamId: string, start: RecordsStart, asOf: string): ProofQuery {
  return {
    sql: `SELECT MAX(pp.pts)::float8 AS value, g.game_id::text AS game_id, g.game_date::text AS game_date, g.season_id::int AS season_id,
       pp.player_id::text AS subject_id, p.display_name::text AS subject_name
FROM period_player_stats pp
JOIN games g ON g.game_id = pp.game_id
JOIN players p ON p.player_id = pp.player_id
WHERE pp.team_id = $1::bigint AND pp.period <= 4 AND ${pbpWhere}
GROUP BY g.game_id, g.game_date, g.season_id, pp.player_id, p.display_name`,
    params: [lacTeamId, start.season_id, asOf],
  };
}

/** One row per Clippers player-game: that player's better regulation half. */
export function clippersHalfRef(lacTeamId: string, start: RecordsStart, asOf: string): ProofQuery {
  return {
    sql: `SELECT GREATEST(COALESCE(SUM(pp.pts) FILTER (WHERE pp.period <= 2), 0),
                COALESCE(SUM(pp.pts) FILTER (WHERE pp.period BETWEEN 3 AND 4), 0))::float8 AS value,
       g.game_id::text AS game_id, g.game_date::text AS game_date, g.season_id::int AS season_id,
       pp.player_id::text AS subject_id, p.display_name::text AS subject_name
FROM period_player_stats pp
JOIN games g ON g.game_id = pp.game_id
JOIN players p ON p.player_id = pp.player_id
WHERE pp.team_id = $1::bigint AND pp.period <= 4 AND ${pbpWhere}
GROUP BY g.game_id, g.game_date, g.season_id, pp.player_id, p.display_name`,
    params: [lacTeamId, start.season_id, asOf],
  };
}

/** One row per Clippers game: the team's best regulation quarter. */
export function clippersTeamQuarterRef(lacTeamId: string, start: RecordsStart, asOf: string): ProofQuery {
  return {
    sql: `SELECT MAX(pt.pts)::float8 AS value, g.game_id::text AS game_id, g.game_date::text AS game_date, g.season_id::int AS season_id,
       pt.team_id::text AS subject_id, 'Clippers'::text AS subject_name
FROM period_team_stats pt
JOIN games g ON g.game_id = pt.game_id
WHERE pt.team_id = $1::bigint AND pt.period <= 4 AND ${pbpWhere}
GROUP BY g.game_id, g.game_date, g.season_id, pt.team_id`,
    params: [lacTeamId, start.season_id, asOf],
  };
}

/** One row per Clippers player-game with clutch rows: clutch points. */
export function clippersClutchRef(lacTeamId: string, start: RecordsStart, asOf: string): ProofQuery {
  return {
    sql: `SELECT c.pts::float8 AS value, g.game_id::text AS game_id, g.game_date::text AS game_date, g.season_id::int AS season_id,
       c.player_id::text AS subject_id, p.display_name::text AS subject_name
FROM clutch_stats c
JOIN games g ON g.game_id = c.game_id
JOIN players p ON p.player_id = c.player_id
WHERE c.team_id = $1::bigint AND c.player_id IS NOT NULL AND ${pbpWhere}`,
    params: [lacTeamId, start.season_id, asOf],
  };
}

const PBP_REFS: Record<string, (lac: string, start: RecordsStart, asOf: string) => ProofQuery> = {
  q_pts: clippersQuarterRef, half_pts: clippersHalfRef, team_q_pts: clippersTeamQuarterRef, clutch_pts: clippersClutchRef,
};

function pbpStatRefs(fact: Fact, ctx: EngineContext): RefSpec | null {
  const build = PBP_REFS[fact.stat];
  if (!build || !ctx.pbpRecordsStart) return null;
  return {
    group: build(ctx.lac.teamId, ctx.pbpRecordsStart, refAsOf(fact, ctx)),
    subject: null, league: null, start: ctx.pbpRecordsStart, betterIsHigher: true, ordinal: true,
  };
}

export function refsFor(fact: Fact, ctx: EngineContext): RefSpec | null {
  switch (fact.kind) {
    case 'player_game_stat':
      return playerStatRefs(fact, ctx);
    case 'player_combo':
      return comboRefs(fact, ctx);
    case 'team_game_stat':
      return teamStatRefs(fact, ctx);
    case 'game_flow':
      return flowRefs(fact, ctx);
    case 'player_period_stat':
    case 'team_period_stat':
    case 'clutch':
      return pbpStatRefs(fact, ctx);
    default:
      return null;
  }
}
