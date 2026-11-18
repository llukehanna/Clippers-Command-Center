// scripts/lib/insights/engine/detectors/postgame-flow.ts
// Game flow from play-by-play (spec §2.2): comeback, largest lead (wins), blown
// lead (losses), best run, lead changes, past a floor. Framed only inside
// complete play-by-play records (insights.pbp_records_start); without them, or
// for a game without play-by-play, nothing. Rarity from prior games (refRate).
import { gameFactBase, postgameGames } from '../games.js';
import { runQuery } from '../query.js';
import { refRate } from '../rates.js';
import { FLOW_SQL, FLOW_STATS, type FlowKey, type FlowStat } from '../references.js';
import type { Detector, Fact } from '../types.js';

export { FLOW_SQL };

export function flowDetector(): Detector {
  return {
    name: 'postgame.flow',
    surface: 'postgame',
    categories: ['game_flow'],
    async run(ctx) {
      if (!ctx.pbpRecordsStart) return { facts: [], gameIds: [] };
      const games = await postgameGames(ctx);
      const facts: Fact[] = [];
      for (const g of games) {
        const q = { sql: FLOW_SQL, params: [g.gameId, ctx.lac.teamId] };
        const [r] = await runQuery(q);
        if (!r) continue; // no play-by-play for this game: no flow claims from partial data
        for (const [key, stat] of Object.entries(FLOW_STATS) as [FlowKey, FlowStat][]) {
          if (stat.when !== 'any' && stat.when !== g.result) continue;
          const value = Number(r[key]);
          if (value < stat.floor) continue;
          const fact: Fact = {
            ...gameFactBase(g, ctx), kind: 'game_flow', subject: { type: 'team', id: ctx.lac.teamId, name: 'Clippers' },
            stat: key, value, polarity: stat.polarity, proof: { ...q, match: {} }, sample: { kind: 'context' },
            data: {
              thing: stat.thing(value), best: stat.best, by: 'by the Clippers',
              lead: Number(r.lac_lead), deficit: Number(r.lac_deficit),
              margin_series: r.margin_series as [number, number][],
            },
          };
          const sample = await refRate(fact, ctx);
          if (sample) facts.push({ ...fact, sample });
        }
      }
      return { facts, gameIds: ctx.gameId ? [ctx.gameId] : games.map((g) => g.gameId) };
    },
  };
}
