// scripts/lib/insights/engine/detectors/postgame-team-lines.ts
// The Clippers' team line in each postgame game (spec §2.2): points, threes,
// FG%, margin (wins), loss margin (losses) and opponent points, past a floor.
// Framed by the Plan 2 game questions over the Clippers' own games (no subject
// set: team "career" is the group); rarity from prior games (refRate).
import { gameFactBase, postgameGames } from '../games.js';
import { runQuery } from '../query.js';
import { refRate } from '../rates.js';
import { TEAM_GAME_STATS, TEAM_LINE_SQL } from '../references.js';

export { TEAM_LINE_SQL };
import type { Detector, Fact } from '../types.js';

/** A percentage needs a real sample of shots. */
const MIN_FGA_FOR_PCT = 70;

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
