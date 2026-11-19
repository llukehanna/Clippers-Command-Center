// scripts/lib/insights/engine/detectors/postgame-player-lines.ts
// Every Clippers player's line in each postgame game (spec §2.2): single stats
// at or above a floor, and combined lines. Framed by the Plan 2 game questions
// (career high, joins company, first since, Clippers rank, season high, league
// rank, nth time); rarity from prior games (refRate). Subsumes v1 rare events.
import { gameFactBase, postgameGames } from '../games.js';
import { runQuery } from '../query.js';
import { refRate } from '../rates.js';
import { COMBOS, PLAYER_GAME_STATS } from '../references.js';
import type { Detector, Fact } from '../types.js';

export const PLAYER_FLOORS: Record<keyof typeof PLAYER_GAME_STATS, number> = { pts: 20, reb: 10, ast: 8, fg3m: 4, stl: 4, blk: 4 };

/** $1 game, $2 LAC. Every Clippers line of one game; each fact matches its own player's row. */
export const PLAYER_LINES_SQL = `
SELECT pb.player_id::text AS player_id, p.display_name,
       pb.points::int AS pts, pb.rebounds::int AS reb, pb.assists::int AS ast, pb.fg3_made::int AS fg3m,
       pb.steals::int AS stl, pb.blocks::int AS blk,
       ${COMBOS.map((c) => `COALESCE((${c.cond}), FALSE) AS ${c.key}`).join(',\n       ')}
FROM game_player_box_scores pb
JOIN players p ON p.player_id = pb.player_id
WHERE pb.game_id = $1::bigint AND pb.team_id = $2::bigint
ORDER BY pb.points DESC NULLS LAST, p.display_name`.trim();

/** The categories at 10 or more, e.g. "12 pts, 11 reb, 10 blk" (the line a combo is built from). */
export function bigCategories(r: Record<string, unknown>): string {
  return (['pts', 'reb', 'ast', 'stl', 'blk'] as const)
    .filter((k) => r[k] !== null && r[k] !== undefined && Number(r[k]) >= 10)
    .map((k) => `${Number(r[k])} ${k}`)
    .join(', ');
}

export function playerLinesDetector(): Detector {
  return {
    name: 'postgame.player_lines',
    surface: 'postgame',
    categories: ['player_game_stat', 'player_combo'],
    async run(ctx) {
      const games = await postgameGames(ctx);
      const facts: Fact[] = [];
      for (const g of games) {
        const q = { sql: PLAYER_LINES_SQL, params: [g.gameId, ctx.lac.teamId] };
        for (const r of await runQuery(q)) {
          const playerId = String(r.player_id);
          const subject = { type: 'player' as const, id: playerId, name: String(r.display_name) };
          const proof = { ...q, match: { player_id: playerId } };
          for (const key of Object.keys(PLAYER_FLOORS) as (keyof typeof PLAYER_FLOORS)[]) {
            if (r[key] === null || Number(r[key]) < PLAYER_FLOORS[key]) continue;
            const value = Number(r[key]);
            const stat = PLAYER_GAME_STATS[key];
            const fact: Fact = {
              ...gameFactBase(g, ctx), kind: 'player_game_stat', subject, stat: key, value, polarity: 'positive', proof,
              sample: { kind: 'context' },
              data: { thing: stat.thing(value), best: `most ${stat.plural} in a game`, by: 'by a Clipper', label: stat.label, unit: stat.plural },
            };
            const sample = await refRate(fact, ctx);
            if (sample) facts.push({ ...fact, sample });
          }
          for (const combo of COMBOS) {
            if (r[combo.key] !== true) continue;
            const fact: Fact = {
              ...gameFactBase(g, ctx), kind: 'player_combo', subject, stat: combo.key, value: 1, polarity: 'positive', proof,
              sample: { kind: 'context' },
              data: { thing: combo.thing, best: combo.thing, by: 'by a Clipper', line: bigCategories(r) },
            };
            const sample = await refRate(fact, ctx);
            if (sample) facts.push({ ...fact, sample });
          }
        }
      }
      return { facts, gameIds: ctx.gameId ? [ctx.gameId] : games.map((g) => g.gameId) };
    },
  };
}
