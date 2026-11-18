// scripts/lib/insights/engine/detectors/season-streaks.ts
// Active streaks (v1 streaks.ts on the v2 engine): consecutive qualifying
// games counted back from each Clipper's latest game of the stats season.
// Only the team's games count, so a team change ends a streak (as in
// rb_streaks); playoff games are excluded (regular-season baselines), the
// play-in (stored non-playoff, NBA ids 5xxxxxxx) counts. The team's win/losing streak is
// emitted while the season is being played.
import { runQuery } from '../query.js';
import { clippersTeamResultShare, playerHitRates, teamResultRate } from '../rates.js';
import { rosterSubquery } from '../sql.js';
import type { Detector, Fact, StreakGame } from '../types.js';

export interface StreakDef {
  key: 'scoring_20' | 'scoring_30' | 'rebounding_10' | 'threes_3' | 'hot_shooting';
  /** Boolean SQL over game_player_box_scores `pb`. */
  qualifies: string;
  minGames: number;
  metric: 'points' | 'rebounds' | 'fg3_made' | 'fg_pct';
  threshold: number;
  thing: string;
  best: string;
}

export const STREAKS: StreakDef[] = [
  { key: 'scoring_20', qualifies: 'pb.points >= 20', minGames: 3, metric: 'points', threshold: 20, thing: 'streak of 20+ points', best: 'longest streak of 20+ points' },
  { key: 'scoring_30', qualifies: 'pb.points >= 30', minGames: 3, metric: 'points', threshold: 30, thing: 'streak of 30+ points', best: 'longest streak of 30+ points' },
  { key: 'rebounding_10', qualifies: 'pb.rebounds >= 10', minGames: 4, metric: 'rebounds', threshold: 10, thing: 'streak of 10+ rebounds', best: 'longest streak of 10+ rebounds' },
  { key: 'threes_3', qualifies: 'pb.fg3_made >= 3', minGames: 4, metric: 'fg3_made', threshold: 3, thing: 'streak of 3+ threes', best: 'longest streak of 3+ threes' },
  { key: 'hot_shooting', qualifies: 'pb.fg_attempted >= 8 AND pb.fg_made * 2 >= pb.fg_attempted', minGames: 4, metric: 'fg_pct', threshold: 0.5, thing: '50% shooting streak', best: 'longest 50% shooting streak' },
];

/** $1 season, $2 team, $3 minimum length, $4 as-of. */
export function playerStreakSql(def: StreakDef): string {
  return `
WITH season_games AS (
  SELECT pb.player_id, g.game_id, g.game_date,
         pb.points, pb.rebounds, pb.fg3_made, pb.fg_made, pb.fg_attempted,
         COALESCE((${def.qualifies}), FALSE) AS qualifies,
         ROW_NUMBER() OVER (PARTITION BY pb.player_id ORDER BY g.game_date DESC, g.game_id DESC) AS recency
  FROM game_player_box_scores pb
  JOIN games g ON g.game_id = pb.game_id
  WHERE g.season_id = $1::int AND NOT g.is_playoffs AND g.game_date <= $4::date AND pb.team_id = $2::bigint
    AND pb.player_id IN ${rosterSubquery('$1', '$2', '$4')}
), first_miss AS (
  SELECT player_id, MIN(recency) FILTER (WHERE NOT qualifies) AS recency
  FROM season_games
  GROUP BY player_id
)
SELECT s.player_id::text AS player_id, p.display_name,
       COUNT(*)::int AS streak,
       MIN(s.game_date)::text AS streak_start,
       MAX(s.game_date)::text AS streak_end,
       json_agg(json_build_object(
         'game_date', s.game_date::text, 'points', s.points, 'rebounds', s.rebounds,
         'fg3_made', s.fg3_made, 'fg_made', s.fg_made, 'fg_attempted', s.fg_attempted
       ) ORDER BY s.game_date) AS games
FROM season_games s
JOIN first_miss f ON f.player_id = s.player_id
JOIN players p ON p.player_id = s.player_id
WHERE s.recency < COALESCE(f.recency, 2147483647)
GROUP BY s.player_id, p.display_name
HAVING COUNT(*) >= $3::int
ORDER BY streak DESC`.trim();
}

export function streakGames(def: StreakDef, games: Record<string, unknown>[]): StreakGame[] {
  return games.map((g) => {
    const value = def.metric === 'fg_pct'
      ? (Number(g.fg_attempted) > 0 ? Math.round((Number(g.fg_made) / Number(g.fg_attempted)) * 1000) / 1000 : 0)
      : Number(g[def.metric] ?? 0);
    return { date: String(g.game_date), value, hit: true };
  });
}

/** $1 season, $2 LAC, $3 as-of. */
export const TEAM_STREAK_SQL = `
WITH lac_games AS (
  SELECT g.game_id, g.game_date,
         ((g.home_team_id = $2::bigint) = (g.home_score > g.away_score)) AS won,
         ROW_NUMBER() OVER (ORDER BY g.game_date DESC, g.game_id DESC) AS recency
  FROM games g
  WHERE g.season_id = $1::int AND NOT g.is_playoffs AND g.game_date <= $3::date
    AND $2::bigint IN (g.home_team_id, g.away_team_id)
    AND g.status = 'final' AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
), latest AS (
  SELECT won FROM lac_games WHERE recency = 1
), first_change AS (
  SELECT MIN(recency) AS recency FROM lac_games WHERE won <> (SELECT won FROM latest)
)
SELECT (SELECT won FROM latest) AS winning,
       COUNT(*)::int AS streak,
       MIN(game_date)::text AS streak_start,
       MAX(game_date)::text AS streak_end
FROM lac_games
WHERE recency < COALESCE((SELECT recency FROM first_change), 2147483647)
HAVING COUNT(*) > 0`.trim();

export const TEAM_STREAK_MIN = { wins: 3, losses: 4 } as const;

export function streakDetector(surface: 'season' | 'player'): Detector {
  return {
    name: `${surface}.streaks`,
    surface,
    categories: ['streak'],
    async run(ctx) {
      const facts: Fact[] = [];
      for (const def of STREAKS) {
        const q = { sql: playerStreakSql(def), params: [ctx.season.id, ctx.lac.teamId, def.minGames, ctx.asOf] };
        const rows = await runQuery(q);
        if (rows.length === 0) continue;
        const { rates, pRef } = await playerHitRates(ctx, def.qualifies,
          rows.map((r) => ({ playerId: String(r.player_id), date: String(r.streak_start) })));
        for (const r of rows) {
          const playerId = String(r.player_id);
          const length = Number(r.streak);
          const rate = rates.get(playerId) ?? { k: 0, n: 0 };
          facts.push({
            kind: 'streak', surface,
            subject: { type: 'player', id: playerId, name: String(r.display_name) },
            stat: def.key, value: length,
            window: { type: 'streak', season_id: ctx.season.id },
            context: { date: String(r.streak_end) },
            polarity: 'positive',
            proof: { ...q, match: { player_id: playerId } },
            asOf: ctx.asOf,
            sample: { kind: 'rate', k: rate.k, n: rate.n, pRef, power: length },
            keyExtra: String(r.streak_start),
            data: {
              length, start_date: String(r.streak_start), end_date: String(r.streak_end),
              streak_games: streakGames(def, r.games as Record<string, unknown>[]), hit_threshold: def.threshold,
              thing: def.thing, best: def.best, by: 'by a Clipper',
            },
            gameId: null,
            seasonId: ctx.season.id,
          });
        }
      }

      if (surface === 'season' && ctx.season.isCurrent) {
        const q = { sql: TEAM_STREAK_SQL, params: [ctx.season.id, ctx.lac.teamId, ctx.asOf] };
        const [r] = await runQuery(q);
        if (r) {
          const winning = r.winning === true;
          const stat = winning ? 'wins' : 'losses';
          const length = Number(r.streak);
          if (length >= TEAM_STREAK_MIN[stat]) {
            const rate = await teamResultRate(ctx, winning, String(r.streak_start));
            const pRef = await clippersTeamResultShare(ctx, winning);
            facts.push({
              kind: 'streak', surface,
              subject: { type: 'team', id: ctx.lac.teamId, name: 'Clippers' },
              stat, value: length,
              window: { type: 'streak', season_id: ctx.season.id },
              context: { date: String(r.streak_end) },
              polarity: winning ? 'positive' : 'negative',
              proof: { ...q, match: {} },
              asOf: ctx.asOf,
              sample: { kind: 'rate', k: rate.k, n: rate.n, pRef, power: length },
              keyExtra: String(r.streak_start),
              data: {
                length, start_date: String(r.streak_start), end_date: String(r.streak_end),
                thing: winning ? 'winning streak' : 'losing streak',
                best: winning ? 'longest winning streak' : 'longest losing streak', by: 'by the Clippers',
              },
              gameId: null,
              seasonId: ctx.season.id,
            });
          }
        }
      }
      return { facts, gameIds: null };
    },
  };
}
