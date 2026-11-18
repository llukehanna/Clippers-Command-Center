// scripts/lib/insights/engine/detectors/postgame-team-lines.ts
// The Clippers' team line in each postgame game (spec §2.2): points, threes,
// FG%, margin (wins), loss margin (losses) and opponent points, past a floor.
// Framed by the Plan 2 game questions over the Clippers' own games (no subject
// set: team "career" is the group); rarity from prior games (refRate).
import { gameFactBase, postgameGames } from '../games.js';
import { runQuery } from '../query.js';
import { refRate } from '../rates.js';
import { TEAM_GAME_STATS } from '../references.js';
import type { Detector, Fact } from '../types.js';

/** A percentage needs a real sample of shots. */
const MIN_FGA_FOR_PCT = 70;

/** $1 game, $2 LAC. */
export const TEAM_LINE_SQL = `
SELECT t.points::int AS team_pts, t.fg3_made::int AS team_fg3m, t.fg_attempted::int AS fga,
       ROUND((t.fg_made::numeric / NULLIF(t.fg_attempted, 0)), 6)::float8 AS team_fg_pct,
       (t.points - o.points)::int AS margin, (o.points - t.points)::int AS loss_margin, o.points::int AS opp_pts_low
FROM game_team_box_scores t
JOIN game_team_box_scores o ON o.game_id = t.game_id AND o.team_id <> t.team_id
WHERE t.game_id = $1::bigint AND t.team_id = $2::bigint`.trim();

export function teamLinesDetector(): Detector {
  return {
    name: 'postgame.team_lines',
    surface: 'postgame',
    categories: ['team_game_stat'],
    async run(ctx) {
      const games = await postgameGames(ctx);
      const facts: Fact[] = [];
      for (const g of games) {
        const q = { sql: TEAM_LINE_SQL, params: [g.gameId, ctx.lac.teamId] };
        const [r] = await runQuery(q);
        if (!r) continue;
        for (const [key, stat] of Object.entries(TEAM_GAME_STATS)) {
          if (r[key] === null || r[key] === undefined) continue;
          if (stat.when !== 'any' && stat.when !== g.result) continue;
          const value = Number(r[key]);
          if (stat.betterIsHigher ? value < stat.floor : value > stat.floor) continue;
          if (key === 'team_fg_pct' && Number(r.fga) < MIN_FGA_FOR_PCT) continue;
          const fact: Fact = {
            ...gameFactBase(g, ctx), kind: 'team_game_stat',
            subject: { type: 'team', id: ctx.lac.teamId, name: 'Clippers' },
            stat: key, value, polarity: stat.polarity, proof: { ...q, match: {} }, sample: { kind: 'context' },
            data: { thing: stat.thing(value), best: stat.best, by: 'by the Clippers', formatted: stat.fmt(value), higherIsBetter: stat.betterIsHigher },
          };
          const sample = await refRate(fact, ctx);
          if (sample) facts.push({ ...fact, sample });
        }
      }
      return { facts, gameIds: ctx.gameId ? [ctx.gameId] : games.map((g) => g.gameId) };
    },
  };
}
