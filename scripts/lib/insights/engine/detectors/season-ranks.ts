// scripts/lib/insights/engine/detectors/season-ranks.ts
// League ranks, standings and recent form (v1 league-comparisons.ts on the v2
// engine). League-wide claims need complete league data (coverage guard).
import { fmt, isReportableLeagueRank, MIN_LEAGUE_TEAMS, proofValue } from '../../proof-utils.js';
import { runQuery } from '../query.js';
import { REGULAR_SEASON, rosterSubquery } from '../sql.js';
import { rankStrength } from '../strength.js';
import type { Detector, EngineContext, Fact } from '../types.js';
import { MIN_TEAM_GAMES, PLAYER_METRICS, TEAM_METRICS, type PlayerMetric, type TeamMetric } from './metrics.js';

const MIN_RANKED_PLAYERS = MIN_LEAGUE_TEAMS * 5;
const ROLLING_WINDOW = 10;

const seasonBase = (ctx: EngineContext, surface: 'season' | 'player') => ({
  surface,
  window: { type: 'season' as const, season_id: ctx.season.id },
  context: { date: ctx.season.lastGameDate },
  asOf: ctx.asOf,
  gameId: null,
  seasonId: ctx.season.id,
});
const clippers = (ctx: EngineContext) => ({ type: 'team' as const, id: ctx.lac.teamId, name: 'Clippers' });

/** $1 season, $2 min games, $3 LAC, $4 as-of. */
export function teamRankSql(m: TeamMetric): string {
  return `
WITH team_values AS (
  SELECT a.team_id, ${proofValue(m.aggregate)} AS value, COUNT(*)::int AS games
  FROM advanced_team_game_stats a
  JOIN games g ON g.game_id = a.game_id
  WHERE g.season_id = $1::int AND ${REGULAR_SEASON} AND g.game_date <= $4::date
  GROUP BY a.team_id
  HAVING COUNT(*) >= $2::int
), ranked AS (
  SELECT team_id, value, games,
         RANK() OVER (ORDER BY value ${m.higherIsBetter ? 'DESC' : 'ASC'})::int AS rank,
         COUNT(*) OVER ()::int AS total_teams
  FROM team_values
  WHERE value IS NOT NULL
)
SELECT team_id::text AS team_id, value, games, rank, total_teams
FROM ranked
WHERE team_id = $3::bigint`.trim();
}

/** $1 season, $2 min games, $3 top N, $4 LAC, $5 as-of. */
export function playerRanksSql(m: PlayerMetric): string {
  return `
WITH per_player AS (
  SELECT pb.player_id, COUNT(*)::int AS games, ${proofValue(m.expr)} AS value
  FROM game_player_box_scores pb
  JOIN games g ON g.game_id = pb.game_id
  WHERE g.season_id = $1::int AND ${REGULAR_SEASON} AND g.game_date <= $5::date
  GROUP BY pb.player_id
  HAVING COUNT(*) >= $2::int
), ranked AS (
  SELECT player_id, games, value,
         RANK() OVER (ORDER BY value DESC)::int AS rank,
         COUNT(*) OVER ()::int AS total_players
  FROM per_player
  WHERE value IS NOT NULL
)
SELECT r.player_id::text AS player_id, p.display_name, r.games, r.value, r.rank, r.total_players
FROM ranked r
JOIN players p ON p.player_id = r.player_id
WHERE r.rank <= $3::int
  AND r.player_id IN ${rosterSubquery('$1', '$4', '$5')}
ORDER BY r.rank`.trim();
}

/** $1 season, $2 LAC, $3 as-of. */
export const STANDINGS_SQL = `
WITH results AS (
  SELECT g.home_team_id AS team_id, (g.home_score > g.away_score) AS won
  FROM games g
  WHERE g.season_id = $1::int AND ${REGULAR_SEASON} AND g.game_date <= $3::date
    AND g.status = 'final' AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
  UNION ALL
  SELECT g.away_team_id, (g.away_score > g.home_score)
  FROM games g
  WHERE g.season_id = $1::int AND ${REGULAR_SEASON} AND g.game_date <= $3::date
    AND g.status = 'final' AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
), records AS (
  SELECT r.team_id, t.conference,
         COUNT(*) FILTER (WHERE r.won)::int AS wins,
         COUNT(*) FILTER (WHERE NOT r.won)::int AS losses
  FROM results r
  JOIN teams t ON t.team_id = r.team_id
  GROUP BY r.team_id, t.conference
), ranked AS (
  SELECT team_id, conference, wins, losses,
         RANK() OVER (PARTITION BY conference ORDER BY wins::float8 / (wins + losses) DESC)::int AS conf_rank,
         COUNT(*) OVER (PARTITION BY conference)::int AS conf_teams,
         RANK() OVER (ORDER BY wins::float8 / (wins + losses) DESC)::int AS league_rank,
         COUNT(*) OVER ()::int AS league_teams
  FROM records
)
SELECT team_id::text AS team_id, conference, wins, losses, conf_rank, conf_teams, league_rank, league_teams
FROM ranked
WHERE team_id = $2::bigint`.trim();

/** $1 season, $2 LAC, $3 as-of. True once the Clippers have a play-in or playoff game. */
export const LAC_POSTSEASON_SQL = `
SELECT EXISTS (
  SELECT 1 FROM games g
  WHERE g.season_id = $1::int AND g.game_date <= $3::date AND NOT ${REGULAR_SEASON}
    AND (g.home_team_id = $2::bigint OR g.away_team_id = $2::bigint)
)::boolean AS postseason`.trim();

/** $1 season, $2 window, $3 LAC, $4 as-of. Rolling rows are capped at the last regular-season game date. */
export function rollingRankSql(metric: 'off_rating' | 'net_rating'): string {
  return `
WITH latest AS (
  SELECT DISTINCT ON (team_id) team_id, ${metric}::float8 AS value, as_of_game_date
  FROM rolling_team_stats
  WHERE season_id = $1::int AND window_games = $2::int AND ${metric} IS NOT NULL AND as_of_game_date <= $4::date
    AND as_of_game_date <= (
      SELECT MAX(g.game_date) FROM games g
      WHERE g.season_id = $1::int AND ${REGULAR_SEASON} AND g.status = 'final' AND g.game_date <= $4::date
    )
  ORDER BY team_id, as_of_game_date DESC
)
SELECT (SELECT COUNT(*) + 1 FROM latest l WHERE l.value > lac.value)::int AS rank,
       (SELECT COUNT(*) FROM latest)::int AS total_teams,
       lac.value,
       lac.as_of_game_date::text AS as_of_game_date
FROM latest lac
WHERE lac.team_id = $3::bigint`.trim();
}

export function leagueRankDetector(surface: 'season' | 'player', opts: { teams: boolean }): Detector {
  return {
    name: `${surface}.league_ranks`,
    surface,
    categories: ['league_rank'],
    async run(ctx) {
      if (!ctx.league.complete) return { facts: [], gameIds: null };
      const facts: Fact[] = [];
      if (opts.teams) {
        for (const m of TEAM_METRICS) {
          const q = { sql: teamRankSql(m), params: [ctx.season.id, MIN_TEAM_GAMES, ctx.lac.teamId, ctx.asOf] };
          const [r] = await runQuery(q);
          if (!r) continue;
          const rank = Number(r.rank);
          const total = Number(r.total_teams);
          const top = isReportableLeagueRank(rank, total, 5);
          const bottom = isReportableLeagueRank(rank, total) && rank > total - 5;
          if (!top && !bottom) continue;
          facts.push({
            ...seasonBase(ctx, surface), kind: 'league_rank', subject: clippers(ctx),
            stat: `team_${m.key}`, value: rank, polarity: top ? 'positive' : 'negative',
            proof: { ...q, match: {} },
            sample: { kind: 'share', p: (top ? rank : total - rank + 1) / total },
            data: { rank, total, bottom: !top, label: m.label, formatted: m.format(Number(r.value)), higherIsBetter: m.higherIsBetter },
          });
        }
      }
      for (const m of PLAYER_METRICS) {
        const q = { sql: playerRanksSql(m), params: [ctx.season.id, ctx.minPlayerGames, m.topN, ctx.lac.teamId, ctx.asOf] };
        for (const r of await runQuery(q)) {
          const total = Number(r.total_players);
          if (total < MIN_RANKED_PLAYERS) continue;
          const rank = Number(r.rank);
          // A rank with no frame strength (beyond 10th) is a bare rank, not an insight.
          if (rankStrength(rank) === null) continue;
          const playerId = String(r.player_id);
          facts.push({
            ...seasonBase(ctx, surface), kind: 'league_rank',
            subject: { type: 'player', id: playerId, name: String(r.display_name) },
            stat: `player_${m.key}`, value: rank, polarity: 'positive',
            proof: { ...q, match: { player_id: playerId } },
            sample: { kind: 'share', p: rank / total },
            data: { rank, total, label: m.label, formatted: m.format(Number(r.value)), higherIsBetter: true, min_games: ctx.minPlayerGames },
          });
        }
      }
      return { facts, gameIds: null };
    },
  };
}

export function standingsDetector(): Detector {
  return {
    name: 'season.standings',
    surface: 'season',
    categories: ['standings'],
    async run(ctx) {
      if (!ctx.league.complete) return { facts: [], gameIds: null };
      const q = { sql: STANDINGS_SQL, params: [ctx.season.id, ctx.lac.teamId, ctx.asOf] };
      const [r] = await runQuery(q);
      if (!r) return { facts: [], gameIds: null };
      const confRank = Number(r.conf_rank);
      const confTeams = Number(r.conf_teams);
      const wins = Number(r.wins);
      const losses = Number(r.losses);
      const top = confRank <= 5;
      const bottom = confRank > confTeams - 5;
      if (Number(r.league_teams) < MIN_LEAGUE_TEAMS || wins + losses < MIN_TEAM_GAMES || (!top && !bottom)) return { facts: [], gameIds: null };
      return {
        gameIds: null,
        facts: [{
          ...seasonBase(ctx, 'season'), kind: 'standings', subject: clippers(ctx), stat: 'conf_rank', value: confRank,
          polarity: top ? 'positive' : 'negative', proof: { ...q, match: {} },
          sample: { kind: 'share', p: (top ? confRank : confTeams - confRank + 1) / confTeams },
          data: {
            rank: confRank, total: confTeams, bottom: !top, wins, losses, conference: (r.conference as string | null) ?? null,
            league_rank: Number(r.league_rank), league_teams: Number(r.league_teams),
          },
        }],
      };
    },
  };
}

export function recentFormDetector(): Detector {
  return {
    name: 'season.recent_form',
    surface: 'season',
    categories: ['recent_form'],
    async run(ctx) {
      if (!ctx.league.complete || !ctx.season.isCurrent) return { facts: [], gameIds: null };
      // rolling_team_stats mixes in postseason games; once LAC is in the play-in or playoffs, no recent-form claim.
      const [post] = await runQuery({ sql: LAC_POSTSEASON_SQL, params: [ctx.season.id, ctx.lac.teamId, ctx.asOf] });
      if (post?.postseason === true) return { facts: [], gameIds: null };
      const facts: Fact[] = [];
      for (const metric of ['off_rating', 'net_rating'] as const) {
        const q = { sql: rollingRankSql(metric), params: [ctx.season.id, ROLLING_WINDOW, ctx.lac.teamId, ctx.asOf] };
        const [r] = await runQuery(q);
        if (!r) continue;
        const rank = Number(r.rank);
        const total = Number(r.total_teams);
        if (!isReportableLeagueRank(rank, total, 5)) continue;
        const value = Number(r.value);
        facts.push({
          ...seasonBase(ctx, 'season'), kind: 'recent_form', subject: clippers(ctx),
          stat: `last10_${metric}`, value: rank, context: { date: String(r.as_of_game_date) },
          polarity: 'positive', proof: { ...q, match: {} }, sample: { kind: 'share', p: rank / total },
          data: {
            rank, total, label: metric === 'off_rating' ? 'offensive rating' : 'net rating',
            formatted: metric === 'net_rating' && value > 0 ? `+${fmt(value)}` : fmt(value), higherIsBetter: true,
          },
        });
      }
      return { facts, gameIds: null };
    },
  };
}
