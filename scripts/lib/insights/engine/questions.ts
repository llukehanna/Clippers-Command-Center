// scripts/lib/insights/engine/questions.ts
// The framer's questions (spec §2.3). Each builds one SQL statement (null when
// it doesn't apply) and interprets its rows into a frame. Pure: queries run
// through the framer's Runner.
import { MIN_FIRST_SINCE_GAMES } from '../../../../src/lib/insights/quality';
import type { Frame } from '../../../../src/lib/insights/types';
import { seasonLabel } from '../../schedule-utils.js';
import { REGULAR_SEASON } from '../../sql-fragments.js';
import { yearsBetween } from './dates.js';
import type { Question } from './framer.js';
import { withRef } from './proof.js';
import { recordsSeasons, seasonStartDate } from './records.js';
import { refAsOf, refsFor, type RefSpec } from './references.js';
import { FIXED_STRENGTH, clippersRankStrength, rankStrength, sinceStrength } from './strength.js';
import type { EngineContext, Fact, FactKind } from './types.js';

export const MIN_LEAGUE_SAMPLE = 2000;
const MIN_CAREER_GAMES = 10;
const MIN_SUBJECT_SEASON_GAMES = 3;
const MIN_PREV_SEASON_GAMES = 20;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
/**
 * A dated "first ... since" / "longest ... since" needs at least MIN_FIRST_SINCE_GAMES games strictly between the
 * previous occurrence and this one (Q1): "His first 23-point game since Nov 13" one game later is true but not news.
 * The count comes from the frame query's `games_since` column; a row without one fails closed.
 */
const gamesSince = (r: Record<string, unknown>): number | null => {
  const n = num(r.games_since);
  return n === null || !Number.isFinite(n) || n < MIN_FIRST_SINCE_GAMES ? null : n;
};
const round1 = (v: number) => Math.round(v * 10) / 10;
const better = (a: number, b: number, higher: boolean) => (higher ? a > b : a < b);
const cmp = (refs: RefSpec) => ({
  ge: refs.betterIsHigher ? '>=' : '<=',
  gt: refs.betterIsHigher ? '>' : '<',
  agg: refs.betterIsHigher ? 'MAX' : 'MIN',
  order: refs.betterIsHigher ? 'DESC' : 'ASC',
});
const frame = (type: Frame['type'], strength: number, who: Frame['who'], extra: Partial<Frame> = {}): Frame =>
  ({ type, strength, who, text: '', proof_rows: [], ...extra });

/** The fact's season is inside the records (a frame never cites an incomplete era). */
function seasonOk(fact: Fact, refs: RefSpec): boolean {
  return refs.start !== null && fact.seasonId !== null && fact.seasonId >= refs.start.season_id;
}

const gameOf = (fact: Fact) => fact.window.game_id ?? null;
/** The subject's own row in this game (other rows from the same game, e.g. teammates, stay in). */
const notOwn = (b: (v: string, type: string) => string, game: string, fact: Fact) =>
  `NOT (game_id = ${b(game, 'text')} AND subject_id = ${b(fact.subject.id, 'text')})`;
const recordsExtra = (fact: Fact, refs: RefSpec) => ({
  records_label: refs.start!.label,
  records_seasons: recordsSeasons(refs.start!, fact.seasonId ?? refs.start!.season_id),
});

// ── Game-level questions ────────────────────────────────────────────────────

export const careerHigh: Question = {
  name: 'career_high',
  build(fact, ctx) {
    const refs = refsFor(fact, ctx);
    const game = gameOf(fact);
    if (!refs?.subject || !refs.start || !refs.ordinal || fact.subject.type !== 'player' || !game) return null;
    const c = cmp(refs);
    return withRef(refs.subject, (b) => {
      const d = b(fact.context.date, 'text');
      return `SELECT ${c.agg}(value) FILTER (WHERE game_date < ${d})::float8 AS prev_best,
       MIN(season_id)::int AS first_season,
       (COUNT(*) FILTER (WHERE game_date < ${d}))::int AS games
FROM ref`;
    });
  },
  interpret(rows, fact, ctx) {
    const refs = refsFor(fact, ctx);
    const r = rows[0];
    if (!refs?.start || !r) return null;
    const prev = num(r.prev_best);
    const first = num(r.first_season);
    const games = num(r.games) ?? 0;
    if (prev === null || first === null || first <= refs.start.season_id || games < MIN_CAREER_GAMES) return null;
    if (!better(fact.value, prev, refs.betterIsHigher)) return null;
    return frame('career_high', FIXED_STRENGTH.career_high, 'subject', { prior_value: prev });
  },
};

export const groupCompany: Question = {
  name: 'group_company',
  build(fact, ctx) {
    const refs = refsFor(fact, ctx);
    const game = gameOf(fact);
    if (!refs?.group || !seasonOk(fact, refs) || !game) return null;
    const c = cmp(refs);
    const value = refs.ordinal ? fact.value : 1;
    return withRef(refs.group, (b) => `SELECT subject_id, subject_name, value, game_id, game_date
FROM ref
WHERE value ${c.ge} ${b(value, 'float8')}
  AND (game_date < ${b(fact.context.date, 'text')} OR game_id = ${b(game, 'text')})
  AND ${notOwn(b, game, fact)}
ORDER BY value ${c.order}, game_date, game_id
LIMIT 4`);
  },
  interpret(rows, fact, ctx) {
    const refs = refsFor(fact, ctx);
    if (!refs?.start) return null;
    if (rows.length === 0) {
      // For a single-stat maximum, "nobody else" is records_best (groupFirstSince).
      return refs.ordinal ? null : frame('only_one', FIXED_STRENGTH.only_one, 'group', recordsExtra(fact, refs));
    }
    if (rows.length > 3 || fact.subject.type !== 'player') return null;
    const names = [...new Set(rows.filter((r) => String(r.subject_id) !== fact.subject.id).map((r) => String(r.subject_name)))];
    if (names.length === 0) return null;
    return frame('joins_company', FIXED_STRENGTH.joins_company, 'group', { names, count: rows.length, ...recordsExtra(fact, refs) });
  },
};

export const groupFirstSince: Question = {
  name: 'group_first_since',
  build(fact, ctx) {
    const refs = refsFor(fact, ctx);
    const game = gameOf(fact);
    if (!refs?.group || !seasonOk(fact, refs) || !game) return null;
    const c = cmp(refs);
    const value = refs.ordinal ? fact.value : 1;
    // Earlier games, plus same-game teammates (they sort first and veto the frame).
    // games_since: Clippers games strictly between the previous occurrence and this one (Q1).
    return withRef(refs.group, (b) => {
      const v = b(value, 'float8');
      const d = b(fact.context.date, 'text');
      return `SELECT p.subject_id, p.subject_name, p.value, p.game_id, p.game_date,
       (SELECT COUNT(DISTINCT r.game_id) FROM ref r WHERE r.game_date > p.game_date AND r.game_date < ${d})::int AS games_since
FROM (SELECT subject_id, subject_name, value, game_id, game_date FROM ref
      WHERE value ${c.ge} ${v}
        AND (game_date < ${d} OR game_id = ${b(game, 'text')})
        AND ${notOwn(b, game, fact)}
      ORDER BY game_date DESC, game_id DESC LIMIT 1) p`;
    });
  },
  interpret(rows, fact, ctx) {
    const refs = refsFor(fact, ctx);
    if (!refs?.start) return null;
    const r = rows[0];
    // A same-game teammate matched or beat it: neither "best" nor "first since" holds.
    if (r && String(r.game_date) >= fact.context.date) return null;
    if (!r) return refs.ordinal ? frame('records_best', FIXED_STRENGTH.records_best, 'group', recordsExtra(fact, refs)) : null;
    const since = String(r.game_date);
    const games = gamesSince(r);
    if (games === null) return null;
    const years = yearsBetween(since, fact.context.date);
    return frame('first_since', sinceStrength(years), 'group', { since_date: since, years: round1(years), games_since: games, records_label: refs.start.label });
  },
};

export const subjectFirstSince: Question = {
  name: 'subject_first_since',
  build(fact, ctx) {
    const refs = refsFor(fact, ctx);
    if (!refs?.subject || !refs.start || !seasonOk(fact, refs)) return null;
    const c = cmp(refs);
    const value = refs.ordinal ? fact.value : 1;
    // games_since: the subject's own games (any team) strictly between the previous occurrence and this one (Q1).
    return withRef(refs.subject, (b) => {
      const v = b(value, 'float8');
      const d = b(fact.context.date, 'text');
      return `SELECT p.subject_id, p.subject_name, p.value, p.game_id, p.game_date,
       (SELECT COUNT(DISTINCT r.game_id) FROM ref r WHERE r.game_date > p.game_date AND r.game_date < ${d})::int AS games_since
FROM (SELECT subject_id, subject_name, value, game_id, game_date FROM ref
      WHERE value ${c.ge} ${v} AND game_date < ${d}
        AND season_id >= ${b(refs.start!.season_id, 'int')}
      ORDER BY game_date DESC, game_id DESC LIMIT 1) p`;
    });
  },
  interpret(rows, fact) {
    const r = rows[0];
    if (!r) return null;
    const since = String(r.game_date);
    const games = gamesSince(r);
    if (games === null) return null;
    const years = yearsBetween(since, fact.context.date);
    return frame('first_since', sinceStrength(years), 'subject', { since_date: since, years: round1(years), games_since: games });
  },
};

export const clippersRank: Question = {
  name: 'clippers_rank',
  build(fact, ctx) {
    const refs = refsFor(fact, ctx);
    const game = gameOf(fact);
    if (!refs?.group || !refs.ordinal || !seasonOk(fact, refs) || !game) return null;
    const c = cmp(refs);
    return withRef(refs.group, (b) => {
      const v = b(fact.value, 'float8');
      return `SELECT (COUNT(*) FILTER (WHERE value ${c.gt} ${v}) + 1)::int AS rank,
       (COUNT(*) FILTER (WHERE value = ${v}))::int AS ties,
       COUNT(*)::int AS total
FROM ref
WHERE ${notOwn(b, game, fact)}`;
    });
  },
  interpret(rows, fact, ctx) {
    const refs = refsFor(fact, ctx);
    const rank = num(rows[0]?.rank);
    const ties = num(rows[0]?.ties);
    const total = num(rows[0]?.total);
    // A tie is not a rank of its own: "the 4th-most" would hide the games it shares 4th with, so no frame (FW-1).
    if (!refs?.start || rank === null || total === null || ties === null || ties > 0) return null;
    const strength = clippersRankStrength(rank);
    return strength === null ? null : frame('clippers_rank', strength, 'group', { rank, total: total + 1, records_label: refs.start.label });
  },
};

function seasonHigh(who: 'group' | 'subject'): Question {
  return {
    name: `${who}_season_high`,
    build(fact, ctx) {
      const refs = refsFor(fact, ctx);
      const ref = who === 'group' ? refs?.group : refs?.subject;
      const game = gameOf(fact);
      if (!refs || !ref || !refs.ordinal || !seasonOk(fact, refs) || !game) return null;
      const c = cmp(refs);
      return withRef(ref, (b) => `SELECT ${c.agg}(value)::float8 AS best, COUNT(*)::int AS games
FROM ref
WHERE season_id = ${b(fact.seasonId!, 'int')} AND ${notOwn(b, game, fact)}`);
    },
    interpret(rows, fact, ctx) {
      const refs = refsFor(fact, ctx);
      const best = num(rows[0]?.best);
      const games = num(rows[0]?.games) ?? 0;
      if (!refs || best === null || games < (who === 'group' ? 1 : MIN_SUBJECT_SEASON_GAMES)) return null;
      // Strictly better: a tie with another game is not "the most" (FW-1).
      return better(fact.value, best, refs.betterIsHigher) ? frame('season_high', FIXED_STRENGTH.season_high, who) : null;
    },
  };
}
export const groupSeasonHigh = seasonHigh('group');
export const subjectSeasonHigh = seasonHigh('subject');

export const leagueRank: Question = {
  name: 'league_rank',
  build(fact, ctx) {
    const refs = refsFor(fact, ctx);
    const game = gameOf(fact);
    if (!refs?.league || !refs.ordinal || !game) return null;
    const c = cmp(refs);
    // The league set holds the fact's own row: it counts in the total, never as a tie.
    return withRef(refs.league, (b) => {
      const v = b(fact.value, 'float8');
      return `SELECT (COUNT(*) FILTER (WHERE value ${c.gt} ${v}) + 1)::int AS rank,
       (COUNT(*) FILTER (WHERE value = ${v} AND ${notOwn(b, game, fact)}))::int AS ties,
       COUNT(*)::int AS total
FROM ref`;
    });
  },
  interpret(rows, fact, ctx) {
    const rank = num(rows[0]?.rank);
    const ties = num(rows[0]?.ties);
    const total = num(rows[0]?.total);
    // A tie for a rank is not that rank alone ("the best ... in the NBA"): no frame (FW-1).
    if (rank === null || total === null || ties === null || ties > 0) return null;
    if (total < (refsFor(fact, ctx)?.leagueMin ?? MIN_LEAGUE_SAMPLE)) return null;
    const strength = rankStrength(rank);
    return strength === null ? null : frame('league_rank', strength, 'league', { rank, total });
  },
};

export const nthTime: Question = {
  name: 'nth_time',
  build(fact, ctx) {
    const refs = refsFor(fact, ctx);
    if (!refs?.subject || !seasonOk(fact, refs)) return null;
    const c = cmp(refs);
    const value = refs.ordinal ? fact.value : 1;
    return withRef(refs.subject, (b) => `SELECT COUNT(*)::int AS n
FROM ref
WHERE season_id = ${b(fact.seasonId!, 'int')} AND value ${c.ge} ${b(value, 'float8')}
  AND game_date <= ${b(fact.context.date, 'text')}`);
  },
  interpret(rows) {
    const n = num(rows[0]?.n) ?? 0;
    return n >= 2 ? frame('nth_time', FIXED_STRENGTH.nth_time, 'subject', { count: n }) : null;
  },
};

export const GAME_QUESTIONS: readonly Question[] = [
  careerHigh, groupCompany, groupFirstSince, subjectFirstSince, clippersRank, groupSeasonHigh, subjectSeasonHigh, leagueRank, nthTime,
];

/** A season high is his season high by construction, so the subject's own season-high frame would only repeat the headline. */
export const SEASON_BEST_QUESTIONS: readonly Question[] = GAME_QUESTIONS.filter((q) => q.name !== subjectSeasonHigh.name);

/**
 * Quarters, halves and clutch: no clippers_rank. Their reference rows are one per player-game (or per game),
 * so a rank would count games while the copy ranks quarters and halves, and a game with two bigger quarters would understate it.
 */
export const PERIOD_QUESTIONS: readonly Question[] = GAME_QUESTIONS.filter((q) => q.name !== clippersRank.name);

// ── Streaks (rb_streaks holds every Clipper's streaks) ──────────────────────

const streakApplies = (fact: Fact, ctx: EngineContext) =>
  fact.kind === 'streak' && ctx.recordsStart !== null && !!fact.data.start_date
  && fact.data.start_date >= seasonStartDate(ctx.recordsStart.season_id);

export const streakLongestSince: Question = {
  name: 'streak_longest_since',
  build(fact, ctx) {
    if (!streakApplies(fact, ctx)) return null;
    return {
      sql: `SELECT s.entity_id::text AS subject_id, COALESCE(p.display_name, 'Clippers') AS subject_name, s.length::int AS length,
       s.start_date::text AS start_date, s.end_date::text AS end_date,
       (SELECT COUNT(*) FROM games g WHERE $3::bigint IN (g.home_team_id, g.away_team_id) AND ${REGULAR_SEASON}
          AND g.status = 'final' AND g.game_date > s.end_date AND g.game_date < $5::date AND g.game_date <= $7::date)::int AS games_since
FROM rb_streaks s
LEFT JOIN players p ON s.entity_type = 'player' AND p.player_id = s.entity_id
WHERE s.entity_type = $1::text AND s.streak_key = $2::text AND s.team_id = $3::bigint
  AND s.length >= $4::int AND s.end_date <= $7::date AND s.start_date >= $6::date
  AND NOT (s.entity_id::text = $8::text AND s.start_date = $5::date)
ORDER BY s.end_date DESC, s.start_date DESC
LIMIT 1`,
      params: [fact.subject.type, fact.stat, ctx.lac.teamId, fact.value, fact.data.start_date!, seasonStartDate(ctx.recordsStart!.season_id), ctx.asOf, fact.subject.id],
    };
  },
  interpret(rows, fact, ctx) {
    const start = ctx.recordsStart;
    if (!start) return null;
    const r = rows[0];
    if (!r) return frame('records_best', FIXED_STRENGTH.records_best, 'group', {
      records_label: start.label, records_seasons: recordsSeasons(start, fact.seasonId ?? start.season_id),
    });
    const since = String(r.end_date);
    // A longer-or-equal streak by another Clipper overlapping this one: not the longest.
    if (fact.data.start_date && since >= fact.data.start_date) return null;
    // Q1: Clippers games strictly between the previous streak's end and this streak's start.
    const games = gamesSince(r);
    if (games === null) return null;
    const years = yearsBetween(since, fact.data.start_date ?? fact.context.date);
    return frame('longest_since', sinceStrength(years), 'group', { since_date: since, years: round1(years), games_since: games, records_label: start.label });
  },
};

export const streakSeasonHigh: Question = {
  name: 'streak_season_high',
  build(fact, ctx) {
    const start = ctx.recordsStart;
    if (fact.kind !== 'streak' || !start || fact.seasonId === null || fact.seasonId < start.season_id || !fact.data.start_date) return null;
    return {
      sql: `SELECT COALESCE(MAX(s.length), 0)::int AS best, COUNT(*)::int AS streaks
FROM rb_streaks s
WHERE s.entity_type = $1::text AND s.streak_key = $2::text AND s.team_id = $3::bigint
  AND s.start_date >= $4::date AND s.end_date <= $5::date
  AND NOT (s.entity_id::text = $6::text AND s.start_date = $7::date)`,
      params: [fact.subject.type, fact.stat, ctx.lac.teamId, seasonStartDate(fact.seasonId), ctx.asOf, fact.subject.id, fact.data.start_date],
    };
  },
  interpret(rows, fact) {
    const best = num(rows[0]?.best) ?? 0;
    const streaks = num(rows[0]?.streaks) ?? 0;
    return streaks >= 1 && fact.value > best ? frame('season_high', FIXED_STRENGTH.season_high, 'group') : null;
  },
};

// ── Season totals ───────────────────────────────────────────────────────────

export const milestoneFirstSince: Question = {
  name: 'milestone_first_since',
  build(fact, ctx) {
    const start = ctx.recordsStart;
    const { expr, threshold } = fact.data;
    if ((fact.kind !== 'milestone' && fact.kind !== 'milestone_crossed') || fact.data.career === true || !start || fact.seasonId === null || start.season_id >= fact.seasonId || !expr || threshold === undefined) return null;
    // The fact's own season counts too, for other Clippers: a teammate who got there first (before tonight's game for a
    // crossing, as of the run for a season milestone) means this is not the first. The subject's own row is excluded.
    const sameSeasonDate = fact.kind === 'milestone_crossed' ? '<' : '<=';
    const seasons = `g.season_id < $3::int OR (g.season_id = $3::int AND pb.player_id <> $6::bigint AND g.game_date ${sameSeasonDate} $5::date)`;
    // The fact's total is cross-team (a mid-season acquisition), so the references total the same expression
    // over every team's games, for players who played for the Clippers that season.
    return {
      sql: `SELECT pb.player_id::text AS subject_id, p.display_name AS subject_name, g.season_id::int AS season_id, (${expr})::int AS total
FROM game_player_box_scores pb
JOIN games g ON g.game_id = pb.game_id
JOIN players p ON p.player_id = pb.player_id
WHERE ${REGULAR_SEASON} AND g.season_id >= $2::int AND (${seasons})
  AND g.game_date <= $5::date
  AND EXISTS (SELECT 1 FROM game_player_box_scores cp JOIN games cg ON cg.game_id = cp.game_id
              WHERE cp.player_id = pb.player_id AND cp.team_id = $1::bigint AND cg.season_id = g.season_id AND cg.game_date <= $5::date
                AND ${REGULAR_SEASON.replace(/\bg\./g, 'cg.')})
GROUP BY pb.player_id, p.display_name, g.season_id
HAVING (${expr}) >= $4::int
ORDER BY 3 DESC, 4 DESC, 1
LIMIT 1`,
      params: [ctx.lac.teamId, start.season_id, fact.seasonId, threshold, refAsOf(fact, ctx), fact.subject.id],
    };
  },
  interpret(rows, fact, ctx) {
    const start = ctx.recordsStart;
    if (!start || fact.seasonId === null) return null;
    const r = rows[0];
    if (!r) return frame('records_best', FIXED_STRENGTH.records_best, 'group', {
      records_label: start.label, records_seasons: recordsSeasons(start, fact.seasonId),
    });
    const season = Number(r.season_id);
    // Another Clipper already reached it this season: not a first, the milestone frame stands.
    if (season === fact.seasonId) return null;
    const years = fact.seasonId - season;
    return frame('first_since', sinceStrength(years), 'group', { since_label: seasonLabel(season), years, records_label: start.label });
  },
};

// ── Year over year ──────────────────────────────────────────────────────────

export const yoyPlayerBest: Question = {
  name: 'yoy_player_best',
  build(fact, ctx) {
    const { expr } = fact.data;
    if (fact.kind !== 'yoy_change' || fact.data.yoy !== 'player' || !ctx.recordsStart || !expr || fact.seasonId === null) return null;
    return {
      sql: `SELECT g.season_id::int AS season_id, COUNT(*)::int AS games, ROUND((${expr})::numeric, 6)::float8 AS value,
       (SELECT MIN(g2.season_id) FROM game_player_box_scores pb2 JOIN games g2 ON g2.game_id = pb2.game_id
        WHERE pb2.player_id = $1::bigint AND ${REGULAR_SEASON.replace(/\bg\./g, 'g2.')})::int AS first_season
FROM game_player_box_scores pb
JOIN games g ON g.game_id = pb.game_id
WHERE pb.player_id = $1::bigint AND ${REGULAR_SEASON} AND g.season_id < $2::int
GROUP BY g.season_id
HAVING COUNT(*) >= $3::int
ORDER BY g.season_id`,
      params: [fact.subject.id, fact.seasonId, MIN_PREV_SEASON_GAMES],
    };
  },
  interpret(rows, fact, ctx) {
    const start = ctx.recordsStart;
    if (!start || fact.seasonId === null) return null;
    const prior = rows.filter((r) => num(r.value) !== null);
    if (prior.length === 0) return null;
    const first = num(prior[0].first_season) ?? start.season_id;
    const maxPrior = Math.max(...prior.map((r) => Number(r.value)));
    if (first > start.season_id && fact.value > maxPrior) {
      return frame('career_high', FIXED_STRENGTH.career_high, 'subject', { prior_value: maxPrior });
    }
    const last = [...prior].reverse().find((r) => Number(r.value) >= fact.value);
    if (!last || Number(last.season_id) < start.season_id) return null;
    const years = fact.seasonId - Number(last.season_id);
    return frame('first_since', sinceStrength(years), 'subject', { since_label: seasonLabel(Number(last.season_id)), years });
  },
};

export const yoyRecordBest: Question = {
  name: 'yoy_record_best',
  build(fact, ctx) {
    if (fact.kind !== 'yoy_change' || fact.data.yoy !== 'record' || fact.polarity !== 'positive' || !ctx.recordsStart || fact.seasonId === null) return null;
    return {
      sql: `SELECT season_id, wins, games, ROUND((wins::numeric / games), 6)::float8 AS win_pct
FROM (
  SELECT g.season_id::int AS season_id,
         COUNT(*) FILTER (WHERE (g.home_team_id = $1::bigint) = (g.home_score > g.away_score))::int AS wins,
         COUNT(*)::int AS games
  FROM games g
  WHERE $1::bigint IN (g.home_team_id, g.away_team_id) AND ${REGULAR_SEASON} AND g.status = 'final'
    AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
    AND g.season_id >= $2::int AND g.season_id < $3::int
  GROUP BY g.season_id
) s
WHERE games >= 20
ORDER BY season_id`,
      params: [ctx.lac.teamId, ctx.recordsStart.season_id, fact.seasonId],
    };
  },
  interpret(rows, fact, ctx) {
    const start = ctx.recordsStart;
    if (!start || fact.seasonId === null || rows.length === 0) return null;
    const last = [...rows].reverse().find((r) => Number(r.win_pct) >= fact.value);
    if (!last) return frame('records_best', FIXED_STRENGTH.records_best, 'group', {
      records_label: start.label, records_seasons: recordsSeasons(start, fact.seasonId),
    });
    const years = fact.seasonId - Number(last.season_id);
    return frame('first_since', sinceStrength(years), 'group', { since_label: seasonLabel(Number(last.season_id)), years, records_label: start.label });
  },
};

export const QUESTIONS_BY_KIND: Record<FactKind, readonly Question[]> = {
  streak: [streakLongestSince, streakSeasonHigh],
  milestone: [milestoneFirstSince],
  milestone_crossed: [milestoneFirstSince],
  league_rank: [],
  standings: [],
  recent_form: [],
  yoy_change: [yoyPlayerBest, yoyRecordBest],
  opp_rank: [],
  h2h: [],
  last_meeting: [],
  player_game_stat: GAME_QUESTIONS,
  player_combo: GAME_QUESTIONS,
  team_game_stat: GAME_QUESTIONS,
  game_flow: GAME_QUESTIONS,
  player_period_stat: PERIOD_QUESTIONS,
  team_period_stat: PERIOD_QUESTIONS,
  clutch: PERIOD_QUESTIONS,
  opp_form: [],
  vs_opponent: [],
  opp_hot_player: [],
  rest: [],
  line: [],
  season_best: SEASON_BEST_QUESTIONS,
  milestone_progress: [],
};

export function questionsFor(fact: Fact): readonly Question[] {
  return QUESTIONS_BY_KIND[fact.kind] ?? [];
}

