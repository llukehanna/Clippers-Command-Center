// scripts/lib/insights/engine/detectors/postgame-periods.ts
// Quarter, half and clutch bests from play-by-play (spec §2.2), framed only inside
// complete play-by-play records (insights.pbp_records_start; the record frames are
// gated by pbpRecordsComplete). Without records, or for a game without period or
// clutch rows, nothing. Rarity from prior games (refRate).
import { gameFactBase, postgameGames } from '../games.js';
import { bestPeriods, type PeriodRow } from '../periods.js';
import { runQuery } from '../query.js';
import { refRate } from '../rates.js';
import { CLUTCH_SQL, PLAYER_PERIODS_SQL, TEAM_PERIODS_SQL } from '../references.js';
import type { Detector, EngineContext, Fact } from '../types.js';

export { CLUTCH_SQL, PLAYER_PERIODS_SQL, TEAM_PERIODS_SQL };

const FLOORS = { q_pts: 12, half_pts: 20, team_q_pts: 38, clutch_pts: 7 } as const;

async function push(facts: Fact[], fact: Fact, ctx: EngineContext): Promise<void> {
  const sample = await refRate(fact, ctx);
  if (sample) facts.push({ ...fact, sample });
}

export function periodsDetector(): Detector {
  return {
    name: 'postgame.periods',
    surface: 'postgame',
    categories: ['player_period_stat', 'team_period_stat'],
    async run(ctx) {
      if (!ctx.pbpRecordsStart) return { facts: [], gameIds: [] };
      const games = await postgameGames(ctx);
      const facts: Fact[] = [];
      for (const g of games) {
        const base = gameFactBase(g, ctx);
        const pq = { sql: PLAYER_PERIODS_SQL, params: [g.gameId, ctx.lac.teamId] };
        const lines = ((await runQuery(pq)) as unknown as PeriodRow[]).map((r) => ({ ...r, pts: Number(r.pts), period: Number(r.period) }));
        for (const p of bestPeriods(lines)) {
          const subject = { type: 'player' as const, id: p.playerId, name: p.name };
          if (p.quarter.pts >= FLOORS.q_pts) {
            await push(facts, {
              ...base, kind: 'player_period_stat', subject, stat: 'q_pts', value: p.quarter.pts,
              window: { type: 'period', game_id: g.gameId, season_id: g.seasonId, period: p.quarter.period },
              polarity: 'positive', proof: { ...pq, match: { player_id: p.playerId, period: p.quarter.period } }, sample: { kind: 'context' },
              data: { thing: `${p.quarter.pts}-point quarter`, best: 'most points in a quarter', by: 'by a Clipper', unit: 'points' },
            }, ctx);
          }
          if (p.half.pts >= FLOORS.half_pts) {
            await push(facts, {
              ...base, kind: 'player_period_stat', subject, stat: 'half_pts', value: p.half.pts,
              window: { type: 'half', game_id: g.gameId, season_id: g.seasonId, period: p.half.half },
              polarity: 'positive', proof: { ...pq, match: { player_id: p.playerId } }, sample: { kind: 'context' },
              data: { thing: `${p.half.pts}-point half`, best: 'most points in a half', by: 'by a Clipper', unit: 'points' },
            }, ctx);
          }
        }
        const tq = { sql: TEAM_PERIODS_SQL, params: [g.gameId, ctx.lac.teamId] };
        const quarters = await runQuery(tq);
        const top = quarters.reduce<Record<string, unknown> | null>((b, r) => (!b || Number(r.pts) > Number(b.pts) ? r : b), null);
        if (top && Number(top.pts) >= FLOORS.team_q_pts) {
          await push(facts, {
            ...base, kind: 'team_period_stat', subject: { type: 'team', id: ctx.lac.teamId, name: 'Clippers' },
            stat: 'team_q_pts', value: Number(top.pts),
            window: { type: 'period', game_id: g.gameId, season_id: g.seasonId, period: Number(top.period) },
            polarity: 'positive', proof: { ...tq, match: { period: Number(top.period) } }, sample: { kind: 'context' },
            data: { thing: `${top.pts}-point quarter`, best: 'most points in a quarter', by: 'by the Clippers' },
          }, ctx);
        }
      }
      return { facts, gameIds: ctx.gameId ? [ctx.gameId] : games.map((g) => g.gameId) };
    },
  };
}

export function clutchDetector(): Detector {
  return {
    name: 'postgame.clutch',
    surface: 'postgame',
    categories: ['clutch'],
    async run(ctx) {
      if (!ctx.pbpRecordsStart) return { facts: [], gameIds: [] };
      const games = await postgameGames(ctx);
      const facts: Fact[] = [];
      for (const g of games) {
        const q = { sql: CLUTCH_SQL, params: [g.gameId, ctx.lac.teamId] };
        for (const r of await runQuery(q)) {
          const value = Number(r.pts);
          if (value < FLOORS.clutch_pts) continue;
          const playerId = String(r.player_id);
          await push(facts, {
            ...gameFactBase(g, ctx), kind: 'clutch', subject: { type: 'player', id: playerId, name: String(r.display_name) },
            stat: 'clutch_pts', value, polarity: 'positive', proof: { ...q, match: { player_id: playerId } }, sample: { kind: 'context' },
            data: {
              thing: `${value}-point clutch performance`, best: 'most clutch points in a game', by: 'by a Clipper',
              fgm: Number(r.fgm), fga: Number(r.fga), ftm: Number(r.ftm), fta: Number(r.fta),
            },
          }, ctx);
        }
      }
      return { facts, gameIds: ctx.gameId ? [ctx.gameId] : games.map((g) => g.gameId) };
    },
  };
}
