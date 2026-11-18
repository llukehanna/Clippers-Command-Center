// scripts/lib/insights/engine/detectors/season-milestones.ts
// Season milestones (v1 milestones.ts on the v2 engine): the highest threshold
// each current Clipper has reached; a new threshold is a new key (novelty).
// Totals are regular season, across teams for a mid-season acquisition.
import { lateJoiners } from '../games.js';
import { highestThreshold } from '../../proof-utils.js';
import { runQuery } from '../query.js';
import { seasonTotalShare } from '../rates.js';
import { REGULAR_SEASON, rosterSubquery } from '../sql.js';
import type { Detector, Fact } from '../types.js';

export interface MilestoneDef {
  key: 'season_points' | 'double_doubles' | 'season_threes';
  thresholds: readonly number[];
  /** Per-player season aggregate over game_player_box_scores `pb`. */
  expr: string;
  unit: string;
  noun: (n: number) => string;   // 1500 → "1,500 points"
  thing: (n: number) => string;  // 1500 → "1,500-point season"
}

const DOUBLE_DOUBLE = `((pb.points >= 10)::int + (pb.rebounds >= 10)::int + (pb.assists >= 10)::int
   + (pb.steals >= 10)::int + (pb.blocks >= 10)::int) >= 2`;
const thousands = (n: number) => n.toLocaleString('en-US');

export const MILESTONES: MilestoneDef[] = [
  { key: 'season_points', thresholds: [1000, 1250, 1500, 1750, 2000, 2500], expr: 'SUM(pb.points)', unit: 'points',
    noun: (n) => `${thousands(n)} points`, thing: (n) => `${thousands(n)}-point season` },
  { key: 'double_doubles', thresholds: [20, 30, 40, 50, 60], expr: `COUNT(*) FILTER (WHERE ${DOUBLE_DOUBLE})`, unit: 'double-doubles',
    noun: (n) => `${n} double-doubles`, thing: (n) => `${n}-double-double season` },
  { key: 'season_threes', thresholds: [150, 200, 250, 300], expr: 'SUM(pb.fg3_made)', unit: 'made threes',
    noun: (n) => `${n} made threes`, thing: (n) => `${n}-three season` },
];

/** $1 season, $2 LAC, $3 lowest threshold, $4 as-of. */
export function milestoneSql(m: MilestoneDef): string {
  return `
SELECT pb.player_id::text AS player_id, p.display_name,
       COUNT(*)::int AS games, (${m.expr})::int AS total
FROM game_player_box_scores pb
JOIN games g ON g.game_id = pb.game_id
JOIN players p ON p.player_id = pb.player_id
WHERE g.season_id = $1::int AND ${REGULAR_SEASON} AND g.game_date <= $4::date
  AND pb.player_id IN ${rosterSubquery('$1', '$2', '$4')}
GROUP BY pb.player_id, p.display_name
HAVING (${m.expr}) >= $3::int
ORDER BY total DESC`.trim();
}

export function milestoneDetector(surface: 'season' | 'player'): Detector {
  return {
    name: `${surface}.milestones`,
    surface,
    categories: ['milestone'],
    async run(ctx) {
      const facts: Fact[] = [];
      const shares = new Map<string, number>();
      // Incomplete league data: a mid-season acquisition's games for his old team may be missing, so his total undercounts.
      const skip = ctx.league.complete ? new Set<string>() : await lateJoiners(ctx);
      for (const m of MILESTONES) {
        const q = { sql: milestoneSql(m), params: [ctx.season.id, ctx.lac.teamId, Math.min(...m.thresholds), ctx.asOf] };
        for (const r of await runQuery(q)) {
          if (skip.has(String(r.player_id))) continue;
          const total = Number(r.total);
          const reached = highestThreshold(total, m.thresholds);
          if (reached === null) continue;
          const shareKey = `${m.key}:${reached}`;
          if (!shares.has(shareKey)) shares.set(shareKey, await seasonTotalShare(ctx, m.expr, reached));
          const playerId = String(r.player_id);
          facts.push({
            kind: 'milestone', surface,
            subject: { type: 'player', id: playerId, name: String(r.display_name) },
            stat: m.key, value: reached, keyExtra: String(reached),
            window: { type: 'season', season_id: ctx.season.id },
            context: { date: ctx.season.lastGameDate },
            polarity: 'positive',
            proof: { ...q, match: { player_id: playerId } },
            asOf: ctx.asOf,
            sample: { kind: 'share', p: shares.get(shareKey)! },
            data: {
              threshold: reached, step: m.thresholds.indexOf(reached), total_value: total, games: Number(r.games),
              expr: m.expr, label: m.noun(reached), formatted: m.noun(total), unit: m.unit,
              thing: m.thing(reached), best: `first ${m.thing(reached)}`, by: 'by a Clipper',
            },
            gameId: null,
            seasonId: ctx.season.id,
          });
        }
      }
      return { facts, gameIds: null };
    },
  };
}
