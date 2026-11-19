// scripts/lib/insights/engine/detectors/season-yoy.ts
// Year over year (v1 year-over-year.ts on the v2 engine): team rank moves of
// 5+ places, the record, and a current Clipper's sharp rise. Each proof also
// counts how many teams/players moved as much — the fact's share p.
import { isReportableLeagueRank, proofValue } from '../../proof-utils.js';
import { runQuery } from '../query.js';
import { REGULAR_SEASON, rosterSubquery } from '../sql.js';
import type { Detector, EngineContext, Fact } from '../types.js';
import { MIN_TEAM_GAMES, PLAYER_METRICS, TEAM_METRICS, type PlayerMetric, type TeamMetric } from './metrics.js';

const MIN_RANK_MOVE = 5;
const MIN_WIN_CHANGE = 5;
const MIN_WIN_PCT_CHANGE = 0.1;
const MIN_INSEASON_GAMES = 20;
const MIN_PREV_PLAYER_GAMES = 20;
const PLAYER_RISES: { key: string; minRise: number }[] = [
  { key: 'ppg', minRise: 3 }, { key: 'rpg', minRise: 2 }, { key: 'apg', minRise: 2 }, { key: 'ts_pct', minRise: 0.03 },
];
const YOY_TEAM_METRICS = TEAM_METRICS.filter((m) => ['off_rating', 'def_rating', 'net_rating'].includes(m.key));

/** $1 cur, $2 prev, $3 min games, $4 LAC, $5 as-of. */
export function yoyTeamRankSql(m: TeamMetric): string {
  return `
WITH team_values AS (
  SELECT g.season_id, a.team_id, ${proofValue(m.aggregate)} AS value
  FROM advanced_team_game_stats a
  JOIN games g ON g.game_id = a.game_id
  WHERE g.season_id IN ($1::int, $2::int) AND ${REGULAR_SEASON} AND g.game_date <= $5::date
  GROUP BY g.season_id, a.team_id
  HAVING COUNT(*) >= $3::int
), ranked AS (
  SELECT season_id, team_id, value,
         RANK() OVER (PARTITION BY season_id ORDER BY value ${m.higherIsBetter ? 'DESC' : 'ASC'})::int AS rank,
         (COUNT(*) OVER (PARTITION BY season_id, value) - 1)::int AS tied,
         COUNT(*) OVER (PARTITION BY season_id)::int AS total_teams
  FROM team_values
  WHERE value IS NOT NULL
), moves AS (
  SELECT c.team_id, (p.rank - c.rank)::int AS moved
  FROM ranked c
  JOIN ranked p ON p.team_id = c.team_id AND p.season_id = $2::int
  WHERE c.season_id = $1::int
), lac AS (
  SELECT moved FROM moves WHERE team_id = $4::bigint
)
SELECT r.season_id::int AS season_id, r.value, r.rank, r.tied, r.total_teams,
       (SELECT moved FROM lac) AS moved,
       (SELECT COUNT(*) FROM moves m, lac WHERE SIGN(m.moved) = SIGN(lac.moved) AND ABS(m.moved) >= ABS(lac.moved))::int AS as_big,
       (SELECT COUNT(*) FROM moves)::int AS teams
FROM ranked r
WHERE r.team_id = $4::bigint
ORDER BY r.season_id`.trim();
}

/** $1 cur, $2 prev, $3 LAC, $4 as-of. */
export const YOY_RECORD_SQL = `
WITH results AS (
  SELECT g.season_id, g.home_team_id AS team_id, (g.home_score > g.away_score) AS won
  FROM games g
  WHERE g.season_id IN ($1::int, $2::int) AND ${REGULAR_SEASON} AND g.game_date <= $4::date
    AND g.status = 'final' AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
  UNION ALL
  SELECT g.season_id, g.away_team_id, (g.away_score > g.home_score)
  FROM games g
  WHERE g.season_id IN ($1::int, $2::int) AND ${REGULAR_SEASON} AND g.game_date <= $4::date
    AND g.status = 'final' AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
), recs AS (
  SELECT season_id, team_id,
         COUNT(*) FILTER (WHERE won)::int AS wins,
         COUNT(*) FILTER (WHERE NOT won)::int AS losses
  FROM results
  GROUP BY season_id, team_id
), chg AS (
  SELECT c.team_id,
         c.wins::float8 / NULLIF(c.wins + c.losses, 0) - p.wins::float8 / NULLIF(p.wins + p.losses, 0) AS change
  FROM recs c
  JOIN recs p ON p.team_id = c.team_id AND p.season_id = $2::int
  WHERE c.season_id = $1::int
), lac AS (
  SELECT change FROM chg WHERE team_id = $3::bigint
)
SELECT r.season_id::int AS season_id, r.wins, r.losses,
       ROUND((SELECT change FROM lac)::numeric, 6)::float8 AS change,
       (SELECT COUNT(*) FROM chg c, lac WHERE SIGN(c.change) = SIGN(lac.change) AND ABS(c.change) >= ABS(lac.change))::int AS as_big,
       (SELECT COUNT(*) FROM chg)::int AS teams
FROM recs r
WHERE r.team_id = $3::bigint
ORDER BY r.season_id`.trim();

/** $1 cur, $2 prev, $3 min games, $4 prev min games, $5 min rise, $6 LAC, $7 as-of. */
export function playerRiseSql(m: PlayerMetric): string {
  return `
WITH per_season AS (
  SELECT pb.player_id, g.season_id, COUNT(*)::int AS games, ${proofValue(m.expr)} AS value
  FROM game_player_box_scores pb
  JOIN games g ON g.game_id = pb.game_id
  WHERE g.season_id IN ($1::int, $2::int) AND ${REGULAR_SEASON} AND g.game_date <= $7::date
  GROUP BY pb.player_id, g.season_id
), rises AS (
  SELECT cur.player_id, cur.games, cur.value, prev.games AS prev_games, prev.value AS prev_value,
         (RANK() OVER (ORDER BY cur.value - prev.value DESC))::int AS rise_rank,
         (COUNT(*) OVER ())::int AS qualified
  FROM per_season cur
  JOIN per_season prev ON prev.player_id = cur.player_id AND prev.season_id = $2::int
  WHERE cur.season_id = $1::int AND cur.games >= $3::int AND prev.games >= $4::int
    AND cur.value IS NOT NULL AND prev.value IS NOT NULL
)
SELECT r.player_id::text AS player_id, p.display_name, r.games, r.value, r.prev_games, r.prev_value, r.rise_rank, r.qualified
FROM rises r
JOIN players p ON p.player_id = r.player_id
WHERE r.value - r.prev_value >= $5::float8
  AND r.player_id IN ${rosterSubquery('$1', '$6', '$7')}
ORDER BY r.value - r.prev_value DESC`.trim();
}

const base = (ctx: EngineContext, surface: 'season' | 'player') => ({
  kind: 'yoy_change' as const,
  surface,
  window: { type: 'season' as const, season_id: ctx.season.id },
  context: { date: ctx.season.lastGameDate },
  asOf: ctx.asOf,
  gameId: null,
  seasonId: ctx.season.id,
});

export function yoyDetector(surface: 'season' | 'player'): Detector {
  return {
    name: `${surface}.yoy`,
    surface,
    categories: ['yoy_change'],
    async run(ctx) {
      if (!ctx.league.complete) return { facts: [], gameIds: null };
      const facts: Fact[] = [];
      const cur = ctx.season.id;
      const prev = cur - 1;
      const lacSubject = { type: 'team' as const, id: ctx.lac.teamId, name: 'Clippers' };

      if (surface === 'season') {
        for (const m of YOY_TEAM_METRICS) {
          const q = { sql: yoyTeamRankSql(m), params: [cur, prev, MIN_TEAM_GAMES, ctx.lac.teamId, ctx.asOf] };
          const rows = await runQuery(q);
          const p = rows.find((r) => Number(r.season_id) === prev);
          const c = rows.find((r) => Number(r.season_id) === cur);
          if (!p || !c) continue;
          const rank = Number(c.rank);
          const total = Number(c.total_teams);
          const prevRank = Number(p.rank);
          if (!isReportableLeagueRank(rank, total) || !isReportableLeagueRank(prevRank, Number(p.total_teams))) continue;
          const moved = prevRank - rank;
          if (Math.abs(moved) < MIN_RANK_MOVE) continue;
          const teams = Number(c.teams);
          facts.push({
            ...base(ctx, surface), subject: lacSubject, stat: `team_rank_${m.key}`, value: rank,
            polarity: moved > 0 ? 'positive' : 'negative', proof: { ...q, match: {} },
            sample: { kind: 'share', p: teams > 0 ? Number(c.as_big) / teams : 1 },
            data: {
              yoy: 'team_rank', rank, total, tied: Number(c.tied), prev_rank: prevRank, prev_tied: Number(p.tied), bottom: moved < 0 && rank > total - 5,
              label: m.label, formatted: m.format(Number(c.value)), prev_formatted: m.format(Number(p.value)),
              prev_value: Number(p.value), cur_value: Number(c.value), higherIsBetter: m.higherIsBetter,
            },
          });
        }

        const q = { sql: YOY_RECORD_SQL, params: [cur, prev, ctx.lac.teamId, ctx.asOf] };
        const rows = await runQuery(q);
        const p = rows.find((r) => Number(r.season_id) === prev);
        const c = rows.find((r) => Number(r.season_id) === cur);
        if (p && c && Number(p.wins) + Number(p.losses) >= MIN_INSEASON_GAMES) {
          const [w, l, pw, pl] = [Number(c.wins), Number(c.losses), Number(p.wins), Number(p.losses)];
          const curPct = w / (w + l);
          const prevPct = pw / (pw + pl);
          const notable = ctx.season.isCurrent
            ? w + l >= MIN_INSEASON_GAMES && Math.abs(curPct - prevPct) >= MIN_WIN_PCT_CHANGE
            : Math.abs(w - pw) >= MIN_WIN_CHANGE;
          if (notable) {
            const teams = Number(c.teams);
            facts.push({
              ...base(ctx, surface), subject: lacSubject, stat: 'record', value: Math.round(curPct * 1e6) / 1e6,
              polarity: curPct > prevPct ? 'positive' : 'negative', proof: { ...q, match: {} },
              sample: { kind: 'share', p: teams > 0 ? Number(c.as_big) / teams : 1 },
              data: { yoy: 'record', wins: w, losses: l, prev_wins: pw, prev_losses: pl, prev_value: prevPct, cur_value: curPct, higherIsBetter: true },
            });
          }
        }
      }

      for (const { key, minRise } of PLAYER_RISES) {
        const m = PLAYER_METRICS.find((pm) => pm.key === key)!;
        const q = { sql: playerRiseSql(m), params: [cur, prev, ctx.minPlayerGames, MIN_PREV_PLAYER_GAMES, minRise, ctx.lac.teamId, ctx.asOf] };
        for (const r of await runQuery(q)) {
          const playerId = String(r.player_id);
          const value = Number(r.value);
          const prevValue = Number(r.prev_value);
          facts.push({
            ...base(ctx, surface), subject: { type: 'player', id: playerId, name: String(r.display_name) },
            stat: `player_${key}`, value, polarity: 'positive', proof: { ...q, match: { player_id: playerId } },
            sample: { kind: 'share', p: Number(r.rise_rank) / Number(r.qualified) },
            data: {
              yoy: 'player', label: m.label, formatted: m.format(value), prev_formatted: m.format(prevValue),
              prev_value: prevValue, cur_value: value, games: Number(r.games), prev_games: Number(r.prev_games),
              expr: m.expr, higherIsBetter: true,
            },
          });
        }
      }
      return { facts, gameIds: null };
    },
  };
}
