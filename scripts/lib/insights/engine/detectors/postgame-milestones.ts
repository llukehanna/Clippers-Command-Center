// scripts/lib/insights/engine/detectors/postgame-milestones.ts
// Milestones passed in a postgame game (spec §2.2): season thresholds for
// every Clipper; career thresholds only when the whole career is inside the
// records (first season after records start) — a veteran's partial totals are
// not his career. While league data is incomplete, players acquired mid-season
// get no milestone at all: games for their previous team may be missing from
// both their season and career sums.
import { fmtNum } from '../templates/shared.js';
import { CAREER_MILESTONES, crossedThreshold, type CareerMilestoneDef } from '../crossed.js';
import { gameFactBase, lateJoiners, postgameGames } from '../games.js';
import { runQuery } from '../query.js';
import { careerTotalShare, seasonTotalShare } from '../rates.js';
import { careerComplete } from '../records.js';
import { playerTotalSub } from '../sql.js';
import type { Detector, Fact } from '../types.js';
import { MILESTONES } from './season-milestones.js';

export { CAREER_MILESTONES, crossedThreshold, type CareerMilestoneDef };

/** $1 game, $2 LAC, $3 the game's season, $4 the game date. Totals run through the game date; "before" drops only this game. */
export function crossedSql(): string {
  const sub = (select: string, where: string) => playerTotalSub('x', select, where);
  const season = MILESTONES.flatMap((m) => [
    `COALESCE(${sub(`(${m.expr})::int`, ' AND g.season_id = $3::int')}, 0) AS ${m.key}`,
    `COALESCE(${sub(`(${m.expr})::int`, ' AND g.season_id = $3::int AND pb.game_id <> $1::bigint')}, 0) AS ${m.key}_before`,
  ]);
  const career = CAREER_MILESTONES.flatMap((c) => [
    `COALESCE(${sub(`SUM(pb.${c.column})::int`, '')}, 0) AS ${c.key}`,
    `COALESCE(${sub(`SUM(pb.${c.column})::int`, ' AND pb.game_id <> $1::bigint')}, 0) AS ${c.key}_before`,
  ]);
  return `
WITH in_game AS (
  SELECT pb.player_id FROM game_player_box_scores pb WHERE pb.game_id = $1::bigint AND pb.team_id = $2::bigint
)
SELECT x.player_id::text AS player_id, p.display_name,
       (SELECT MIN(g.season_id) FROM game_player_box_scores pb JOIN games g ON g.game_id = pb.game_id WHERE pb.player_id = x.player_id)::int AS first_season,
       ${[...season, ...career].join(',\n       ')}
FROM in_game x
JOIN players p ON p.player_id = x.player_id
ORDER BY p.display_name`.trim();
}

export function milestonesCrossedDetector(): Detector {
  return {
    name: 'postgame.milestones',
    surface: 'postgame',
    categories: ['milestone_crossed'],
    async run(ctx) {
      const games = await postgameGames(ctx);
      const facts: Fact[] = [];
      const shares = new Map<string, number>();
      const share = async (key: string, fn: () => Promise<number>) => {
        if (!shares.has(key)) shares.set(key, await fn());
        return shares.get(key)!;
      };
      // Incomplete league data: an acquired player's games for his old team may be missing from his sums.
      const skip = ctx.league.complete || games.length === 0 ? new Set<string>() : await lateJoiners(ctx);
      for (const g of games) {
        const q = { sql: crossedSql(), params: [g.gameId, ctx.lac.teamId, g.seasonId, g.date] };
        for (const r of await runQuery(q)) {
          const playerId = String(r.player_id);
          if (skip.has(playerId)) continue;
          const base = { ...gameFactBase(g, ctx), kind: 'milestone_crossed' as const, subject: { type: 'player' as const, id: playerId, name: String(r.display_name) }, polarity: 'positive' as const, proof: { ...q, match: { player_id: playerId } } };
          for (const m of MILESTONES) {
            const through = Number(r[m.key]);
            const t = crossedThreshold(Number(r[`${m.key}_before`]), through, m.thresholds);
            if (t === null) continue;
            facts.push({
              ...base, stat: m.key, value: t, keyExtra: String(t),
              sample: { kind: 'share', p: await share(`${m.key}:${t}`, () => seasonTotalShare(ctx, m.expr, t)) },
              data: {
                threshold: t, step: m.thresholds.indexOf(t), total_value: through, unit: m.unit, label: m.noun(t), formatted: m.noun(through),
                thing: m.thing(t), best: `first ${m.thing(t)}`, by: 'by a Clipper', expr: m.expr, career: false,
              },
            });
          }
          if (!careerComplete(r.first_season === null ? null : Number(r.first_season), ctx.recordsStart)) continue;
          for (const c of CAREER_MILESTONES) {
            const through = Number(r[c.key]);
            const t = crossedThreshold(Number(r[`${c.key}_before`]), through, c.thresholds);
            if (t === null) continue;
            facts.push({
              ...base, stat: c.key, value: t, keyExtra: String(t),
              sample: { kind: 'share', p: await share(`${c.key}:${t}`, () => careerTotalShare(ctx, c.column, t)) },
              data: {
                threshold: t, step: c.thresholds.indexOf(t), total_value: through, unit: c.unit,
                label: `${fmtNum(t)} ${c.unit}`, formatted: `${fmtNum(through)} ${c.unit}`,
                thing: `${fmtNum(t)}-${c.unit} career`, best: `${fmtNum(t)}-${c.unit} career`, by: 'by a Clipper', career: true,
              },
            });
          }
        }
      }
      return { facts, gameIds: ctx.gameId ? [ctx.gameId] : games.map((g) => g.gameId) };
    },
  };
}
