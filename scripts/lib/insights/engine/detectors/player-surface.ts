// scripts/lib/insights/engine/detectors/player-surface.ts
// Player pages (spec §2.2): each current Clipper's best game of the stats season (regular season, any team
// he played for that season) and the next milestone within two games' reach. Streaks, season milestones,
// league ranks and YoY reuse the season detectors on the player surface (registry).
import { fmtNum } from '../templates/shared.js';
import { nextThreshold, withinReach } from '../crossed.js';
import { lateJoiners } from '../games.js';
import { runQuery } from '../query.js';
import { careerTotalShare, refRate, seasonTotalShare } from '../rates.js';
import { careerComplete } from '../records.js';
import { PLAYER_GAME_STATS } from '../references.js';
import { REGULAR_SEASON, playerTotalSub, rosterSubquery } from '../sql.js';
import type { Detector, Fact } from '../types.js';
import { CAREER_MILESTONES } from './postgame-milestones.js';
import { MILESTONES } from './season-milestones.js';

export { nextThreshold, withinReach };

export const SEASON_BEST_FLOORS = { pts: 20, reb: 10, ast: 8 } as const;
const MIN_PROGRESS_GAMES = 5;

/**
 * $1 season, $2 LAC, $3 as-of. Each current Clipper's best regular-season game of the season for one stat, for any
 * team he played for (a season high is his, not the franchise's). Opponent, home and result are read from his own team's side.
 * A tie goes to the earliest game: that is the game that set it. `for_lac` is false for a game for a previous team.
 */
export function seasonBestSql(column: string): string {
  return `
SELECT DISTINCT ON (pb.player_id) pb.player_id::text AS player_id, p.display_name::text AS display_name, pb.game_id::text AS game_id,
       g.game_date::text AS game_date, pb.${column}::int AS value,
       (CASE WHEN g.home_team_id = pb.team_id THEN g.away_team_id ELSE g.home_team_id END)::text AS opponent_id,
       (g.home_team_id = pb.team_id) AS home,
       ((g.home_team_id = pb.team_id) = (g.home_score > g.away_score)) AS won,
       (pb.team_id = $2::bigint) AS for_lac
FROM game_player_box_scores pb
JOIN games g ON g.game_id = pb.game_id
JOIN players p ON p.player_id = pb.player_id
WHERE g.season_id = $1::int AND ${REGULAR_SEASON} AND g.game_date <= $3::date
  AND pb.player_id IN ${rosterSubquery('$1', '$2', '$3')} AND pb.${column} IS NOT NULL
ORDER BY pb.player_id, pb.${column} DESC, g.game_date ASC, g.game_id ASC`.trim();
}

export function seasonBestDetector(): Detector {
  return {
    name: 'player.season_bests',
    surface: 'player',
    categories: ['season_best'],
    async run(ctx) {
      const facts: Fact[] = [];
      // Incomplete league data: an acquired player's games for his old team may be missing, so his high may be wrong.
      const skip = ctx.league.complete ? new Set<string>() : await lateJoiners(ctx, ctx.season.id, ctx.asOf);
      for (const key of Object.keys(SEASON_BEST_FLOORS) as (keyof typeof SEASON_BEST_FLOORS)[]) {
        const stat = PLAYER_GAME_STATS[key];
        const q = { sql: seasonBestSql(stat.column), params: [ctx.season.id, ctx.lac.teamId, ctx.asOf] };
        for (const r of await runQuery(q)) {
          const value = Number(r.value);
          if (value < SEASON_BEST_FLOORS[key]) continue;
          const playerId = String(r.player_id);
          if (skip.has(playerId)) continue;
          const opp = String(r.opponent_id);
          const fact: Fact = {
            kind: 'season_best', surface: 'player', subject: { type: 'player', id: playerId, name: String(r.display_name) },
            stat: key, value, window: { type: 'game', game_id: String(r.game_id), season_id: ctx.season.id },
            context: { date: String(r.game_date), opponent_id: opp, opponent_name: ctx.teams.get(opp)?.fullName, home: r.home === true, result: r.won === true ? 'W' : 'L' },
            polarity: 'positive', proof: { ...q, match: { player_id: playerId } }, asOf: ctx.asOf, sample: { kind: 'context' },
            data: { thing: `${value}-${stat.noun} game`, best: `most ${stat.plural} in a game`, by: 'by a Clipper', label: stat.label, unit: stat.plural, for_lac: r.for_lac === true },
            gameId: null, seasonId: ctx.season.id,
          };
          const sample = await refRate(fact, ctx);
          if (sample) facts.push({ ...fact, sample });
        }
      }
      return { facts, gameIds: null };
    },
  };
}

/** $1 season, $2 LAC, $3 as-of. True while the Clippers have a regular-season game of the season dated after as-of. */
export const LAC_GAMES_LEFT_SQL = `
SELECT EXISTS (
  SELECT 1 FROM games g
  WHERE g.season_id = $1::int AND ${REGULAR_SEASON} AND g.game_date > $3::date
    AND (g.home_team_id = $2::bigint OR g.away_team_id = $2::bigint)
)::boolean AS games_left`.trim();

/** $1 season, $2 LAC, $3 as-of. Season and career totals for each current Clipper (regular season, any team). */
export function progressSql(): string {
  const sub = (select: string, where: string) => playerTotalSub('r', select, where, '$3');
  return `
SELECT r.player_id::text AS player_id, p.display_name::text AS display_name,
       ${sub('MIN(g.season_id)::int', '')} AS first_season,
       ${sub('COUNT(*)::int', ' AND g.season_id = $1::int')} AS season_games,
       ${sub('COUNT(*)::int', '')} AS career_games,
       ${MILESTONES.map((m) => `COALESCE(${sub(`(${m.expr})::int`, ' AND g.season_id = $1::int')}, 0) AS ${m.key}`).join(',\n       ')},
       ${CAREER_MILESTONES.map((c) => `COALESCE(${sub(`SUM(pb.${c.column})::int`, '')}, 0) AS ${c.key}`).join(',\n       ')}
FROM ${rosterSubquery('$1', '$2', '$3')} AS r
JOIN players p ON p.player_id = r.player_id
ORDER BY p.display_name`.trim();
}

export function milestoneProgressDetector(): Detector {
  return {
    name: 'player.milestone_progress',
    surface: 'player',
    categories: ['milestone_progress'],
    async run(ctx) {
      if (!ctx.season.isCurrent) return { facts: [], gameIds: null };
      // With no regular-season game left (the season's end, then the playoffs) nothing is "within two games".
      const [left] = await runQuery({ sql: LAC_GAMES_LEFT_SQL, params: [ctx.season.id, ctx.lac.teamId, ctx.asOf] });
      if (left?.games_left !== true) return { facts: [], gameIds: null };
      const q = { sql: progressSql(), params: [ctx.season.id, ctx.lac.teamId, ctx.asOf] };
      // Incomplete league data: an acquired player's games for his old team may be missing from his season and career sums.
      // The progress is for the stats season, so only that season's coverage is known.
      const seasonId = ctx.season.id;
      const skip = ctx.league.complete ? new Set<string>() : await lateJoiners(ctx, seasonId, ctx.asOf);
      const facts: Fact[] = [];
      for (const r of await runQuery(q)) {
        const playerId = String(r.player_id);
        if (skip.has(playerId)) continue;
        const base = {
          kind: 'milestone_progress' as const, surface: 'player' as const,
          subject: { type: 'player' as const, id: playerId, name: String(r.display_name) },
          window: { type: 'season' as const, season_id: seasonId }, context: { date: ctx.season.lastGameDate },
          polarity: 'positive' as const, proof: { ...q, match: { player_id: playerId } }, asOf: ctx.asOf,
          gameId: null, seasonId,
        };
        const seasonGames = Number(r.season_games);
        if (seasonGames >= MIN_PROGRESS_GAMES) {
          for (const m of MILESTONES) {
            const total = Number(r[m.key]);
            const t = nextThreshold(total, m.thresholds);
            const perGame = total / seasonGames;
            if (t === null || !withinReach(t - total, perGame)) continue;
            facts.push({
              ...base, stat: m.key, value: t, keyExtra: String(t),
              sample: { kind: 'share', p: await seasonTotalShare(ctx, m.expr, t) },
              data: {
                threshold: t, step: m.thresholds.indexOf(t), total_value: total, remaining: t - total, per_game: perGame, games: seasonGames,
                unit: m.unit, label: m.noun(t), formatted: m.noun(total), career: false,
              },
            });
          }
        }
        const careerGames = Number(r.career_games);
        if (!careerComplete(r.first_season === null ? null : Number(r.first_season), ctx.recordsStart) || careerGames < MIN_PROGRESS_GAMES) continue;
        for (const c of CAREER_MILESTONES) {
          const total = Number(r[c.key]);
          const t = nextThreshold(total, c.thresholds);
          const perGame = total / careerGames;
          if (t === null || !withinReach(t - total, perGame)) continue;
          facts.push({
            ...base, stat: c.key, value: t, keyExtra: String(t),
            sample: { kind: 'share', p: await careerTotalShare(ctx, c.column, t) },
            data: {
              threshold: t, step: c.thresholds.indexOf(t), total_value: total, remaining: t - total, per_game: perGame, games: careerGames,
              unit: c.unit, label: `${fmtNum(t)} ${c.unit}`, formatted: `${fmtNum(total)} ${c.unit}`, career: true,
            },
          });
        }
      }
      return { facts, gameIds: null };
    },
  };
}
