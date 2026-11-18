// scripts/lib/insights/engine.integration.test.ts
// The v2 insight engine against a LOCAL Postgres seeded with the synthetic
// league (scripts/dev/seed-fixture-league.ts), with stats and the record book
// built. Skipped unless FIXTURE_DATABASE_URL is set. The database is WIPED.
//   FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55496/fixture npx vitest run scripts/lib/insights/engine.integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { laToday } from './engine/dates';
import { REGULAR_SEASON } from '../sql-fragments';
import { makeFact } from './engine/__fixtures__/facts';
import { seedGameFlows } from './engine/__fixtures__/flows';
import type { EngineContext, InsightDraft } from './engine/types';

const url = process.env.FIXTURE_DATABASE_URL;
const TIMEOUT = 300_000;

function run(script: string, args: string[] = []): string {
  return execFileSync('npx', ['tsx', script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: url, FIXTURE_DATABASE_URL: url },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** A postgame Star Clipper points fact dated `date`, for reference-rate tests. */
const pointsFact = (ctx: EngineContext, gameId: string, date: string) => ({
  kind: 'player_game_stat' as const, surface: 'postgame' as const, stat: 'pts',
  window: { type: 'game' as const, game_id: gameId, season_id: ctx.season.id }, context: { date },
  gameId, seasonId: ctx.season.id, data: {},
});

describe.skipIf(!url)('insight engine v2 (fixture DB)', () => {
  // Imported lazily: scripts/lib/db.ts exits the process without DATABASE_URL.
  let sql: typeof import('../db').sql;

  beforeAll(async () => {
    run('scripts/dev/seed-fixture-league.ts');
    run('scripts/compute-stats.ts');
    run('scripts/build-record-book.ts');
    process.env.DATABASE_URL = url;
    ({ sql } = await import('../db'));
  }, TIMEOUT);

  afterAll(async () => {
    await sql?.end();
  });

  async function ctxAt(asOf: string): Promise<EngineContext> {
    const { loadEngineContext } = await import('./engine/context');
    const ctx = await loadEngineContext({ asOf, withPrior: false });
    if (!ctx) throw new Error(`no engine context as of ${asOf}`);
    return ctx;
  }

  describe('storage', () => {
    const draft = (over: Partial<InsightDraft> = {}): InsightDraft => ({
      key: 'store-test-1', detector: 'test', surface: 'postgame', scope: 'historical', category: 'player_game_stat',
      team_id: '1', game_id: '1', player_id: '1', season_id: 2025,
      headline: 'Star Clipper scored 30 vs the Warriors', detail: 'First 30-point game by a Clipper since Oct 2024', importance: 50,
      proof_sql: 'SELECT 1 AS one', proof_params: {}, proof_result: [{ part: 'fact', data: { one: 1 } }],
      frame: { type: 'first_since', strength: 0.5, who: 'group', text: 'First 30-point game by a Clipper since Oct 2024', proof_rows: [] },
      evidence: null, entities: [{ type: 'player', id: '1', name: 'Star Clipper' }],
      score_parts: {
        p: 0.1, k: 1, n: 60, p_ref: 0.05, power: 1, rarity: 0.33, frame_strength: 0.5, base: 0.4, salience: 1,
        salience_class: 'roster_core', age_days: 0, half_life_days: 3, recency: 1, polarity: 1, novelty: 0.1,
        unchanged_since: '2026-02-25', importance: 50,
      },
      ...over,
    });

    afterAll(async () => {
      await sql`DELETE FROM insights WHERE proof_hash LIKE 'store-%' OR proof_hash IN ('legacy-store-test', 'live-store-test')`;
    });

    it('has the v2 columns', async () => {
      const cols = await sql<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'insights'`;
      expect(cols.map((c) => c.column_name)).toEqual(
        expect.arrayContaining(['surface', 'frame', 'evidence', 'entities', 'score_parts', 'first_emitted_at']));
    });

    it('upserts in place, reactivates, and never moves first_emitted_at', async () => {
      const { upsertInsight } = await import('./engine/store');
      await upsertInsight(draft());
      const [a] = await sql<{ first: string }[]>`SELECT first_emitted_at::text AS first FROM insights WHERE proof_hash = 'store-test-1'`;
      await sql`UPDATE insights SET is_active = FALSE WHERE proof_hash = 'store-test-1'`;
      await upsertInsight(draft({ headline: 'Updated', importance: 60 }));
      const rows = await sql<{ first: string; headline: string; is_active: boolean; frame_type: string }[]>`
        SELECT first_emitted_at::text AS first, headline, is_active, frame->>'type' AS frame_type
        FROM insights WHERE proof_hash = 'store-test-1'`;
      expect(rows).toEqual([{ first: a.first, headline: 'Updated', is_active: true, frame_type: 'first_since' }]);
    });

    it('deactivates stale rows only inside the detector scope', async () => {
      const { upsertInsight, deactivateStale } = await import('./engine/store');
      await upsertInsight(draft({ key: 'store-g1-a', game_id: '1' }));
      await upsertInsight(draft({ key: 'store-g1-b', game_id: '1' }));
      await upsertInsight(draft({ key: 'store-g2-a', game_id: '2' }));
      await upsertInsight(draft({ key: 'store-season', surface: 'season', scope: 'between_games', game_id: null }));
      // store-test-1 (game 1) and store-g1-b are in scope and not kept.
      expect(await deactivateStale({ surface: 'postgame', categories: ['player_game_stat'], gameIds: ['1'] }, ['store-g1-a'])).toBe(2);
      const active = await sql<{ proof_hash: string }[]>`
        SELECT proof_hash FROM insights WHERE is_active AND proof_hash LIKE 'store-%' ORDER BY 1`;
      expect(active.map((r) => r.proof_hash)).toEqual(['store-g1-a', 'store-g2-a', 'store-season']);
      expect(await deactivateStale({ surface: 'postgame', categories: ['player_game_stat'], gameIds: [] }, [])).toBe(0);
    });

    it('clean cut: legacy batch rows go inactive, live rows stay; prior state reads back', async () => {
      await sql`
        INSERT INTO insights (scope, category, headline, importance, proof_sql, proof_params, proof_result, proof_hash) VALUES
          ('between_games', 'streak', 'Legacy claim', 50, 'SELECT 1 AS one', '{}'::jsonb, '[{"one":1}]'::jsonb, 'legacy-store-test'),
          ('live', 'run', 'Live claim', 50, 'SELECT 1 AS one', '{}'::jsonb, '[{"one":1}]'::jsonb, 'live-store-test')`;
      const { deactivateLegacy, loadPrior } = await import('./engine/store');
      expect(await deactivateLegacy()).toBe(1);
      const rows = await sql<{ proof_hash: string; is_active: boolean }[]>`
        SELECT proof_hash, is_active FROM insights WHERE proof_hash IN ('legacy-store-test', 'live-store-test') ORDER BY 1`;
      expect(rows).toEqual([{ proof_hash: 'legacy-store-test', is_active: false }, { proof_hash: 'live-store-test', is_active: true }]);
      const prior = await loadPrior();
      expect(prior.get('store-g1-a')).toMatchObject({
        headline: 'Star Clipper scored 30 vs the Warriors', frameType: 'first_since', unchangedSince: '2026-02-25',
      });
      expect(prior.has('legacy-store-test')).toBe(false);
    });

    it('deactivateRetired touches only batch rows of retired categories, never live ones', async () => {
      const { RETIRED_CATEGORIES, deactivateRetired, upsertInsight } = await import('./engine/store');
      const category = 'zz_retired_test' as InsightDraft['category'];
      RETIRED_CATEGORIES.push(category);
      try {
        await upsertInsight(draft({ key: 'retired-batch', category }));
        await upsertInsight(draft({ key: 'retired-live', category, surface: 'live', scope: 'live' }));
        expect(await deactivateRetired()).toBe(1);
        const rows = await sql<{ proof_hash: string; is_active: boolean }[]>`
          SELECT proof_hash, is_active FROM insights WHERE proof_hash IN ('retired-batch', 'retired-live')`;
        expect(Object.fromEntries(rows.map((r) => [r.proof_hash, r.is_active]))).toEqual({ 'retired-batch': false, 'retired-live': true });
        expect(await deactivateRetired()).toBe(0);
      } finally {
        RETIRED_CATEGORIES.splice(RETIRED_CATEGORIES.indexOf(category), 1);
        await sql`DELETE FROM insights WHERE proof_hash IN ('retired-batch', 'retired-live')`;
      }
    });

    it('the record book holds every Clipper’s streaks', async () => {
      const [r] = await sql<{ n: number }[]>`
        SELECT COUNT(DISTINCT entity_id)::int AS n FROM rb_streaks WHERE entity_type = 'player' AND team_id = 1`;
      expect(r.n).toBeGreaterThan(1);
    });
  });

  describe('context', () => {
    it('in season: current, records start, complete league, roster without the traded player', async () => {
      const ctx = await ctxAt('2026-02-25');
      expect(ctx.season).toMatchObject({ id: 2025, label: '2025-26', isCurrent: true, phrase: 'this season' });
      expect(ctx.recordsStart).toEqual({ season_id: 2024, label: '2024-25' });
      expect(ctx.pbpRecordsStart).toBeNull();
      expect(ctx.league).toEqual({ complete: true, reason: null });
      expect(ctx.roster.has('1')).toBe(true);
      expect(ctx.roster.has('2')).toBe(true);
      expect(ctx.roster.has('3')).toBe(false);
      expect(ctx.roster.get('1')!.mpg).toBeGreaterThan(20);
      expect(ctx.minPlayerGames).toBe(30);
      expect(ctx.prior.size).toBe(0);
    }, TIMEOUT);

    it('as of today: the completed season, worded in the past', async () => {
      const ctx = await ctxAt(laToday());
      expect(ctx.season).toMatchObject({ id: 2025, isCurrent: false, phrase: 'in 2025-26' });
    }, TIMEOUT);

    it('as of a date before any box score: nothing to say', async () => {
      const { loadEngineContext } = await import('./engine/context');
      expect(await loadEngineContext({ asOf: '2024-01-01', withPrior: false })).toBeNull();
    }, TIMEOUT);

    it('rates count prior games only', async () => {
      const { playerHitRates, seasonTotalShare, refRate } = await import('./engine/rates');
      const ctx = await ctxAt('2026-02-25');
      const { rates, pRef } = await playerHitRates(ctx, 'pb.points >= 30', [{ playerId: '1', date: '2026-02-13' }]);
      const star = rates.get('1')!;
      expect(star.n).toBeGreaterThan(100);
      expect(star.k).toBeLessThan(star.n);
      expect(pRef).toBeGreaterThan(0);
      expect(pRef).toBeLessThan(0.2);
      const share = await seasonTotalShare(ctx, 'SUM(pb.points)', 1000);
      expect(share).toBeGreaterThan(0);
      expect(share).toBeLessThan(1);
      const [g] = await sql<{ game_id: string; d: string }[]>`SELECT pb.game_id::text, g.game_date::text AS d FROM game_player_box_scores pb JOIN games g ON g.game_id = pb.game_id WHERE pb.player_id = 1 AND pb.points = 55`;
      const fact = makeFact({ ...pointsFact(ctx, g.game_id, g.d), value: 55 });
      expect(await refRate(fact, ctx)).toMatchObject({ kind: 'rate', k: 0, power: 1 });
    }, TIMEOUT);

    it('hit-rate n is exactly the player\'s games strictly before the date', async () => {
      const { playerHitRates } = await import('./engine/rates');
      const ctx = await ctxAt('2026-02-25');
      const countBefore = async (date: string) => {
        const [r] = await sql<{ n: number }[]>`
          SELECT COUNT(*)::int AS n FROM game_player_box_scores pb JOIN games g ON g.game_id = pb.game_id
          WHERE pb.player_id = 1 AND g.season_id >= ${ctx.season.id - 1} AND g.game_date < ${date}::date
            AND ${sql.unsafe(REGULAR_SEASON)}`;
        return r.n;
      };
      const [last] = await sql<{ d: string }[]>`
        SELECT MAX(g.game_date)::text AS d FROM game_player_box_scores pb JOIN games g ON g.game_id = pb.game_id
        WHERE pb.player_id = 1 AND g.game_date <= ${ctx.asOf}::date AND ${sql.unsafe(REGULAR_SEASON)}`;
      const dayAfter = new Date(new Date(`${last.d}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
      const at = (await playerHitRates(ctx, 'pb.points >= 0', [{ playerId: '1', date: last.d }])).rates.get('1')!;
      const after = (await playerHitRates(ctx, 'pb.points >= 0', [{ playerId: '1', date: dayAfter }])).rates.get('1')!;
      expect(at.n).toBe(await countBefore(last.d));
      expect(after.n).toBe(await countBefore(dayAfter));
      // The game on the date itself is not counted at that date, only the day after.
      expect(after.n).toBe(at.n + 1);
    }, TIMEOUT);

    it('refRate n counts only games strictly before the fact date (k/n ignore the fact game and later ones)', async () => {
      const { refRate } = await import('./engine/rates');
      const ctx = await ctxAt('2026-02-25');
      const countBefore = async (date: string) => {
        const [r] = await sql<{ n: number }[]>`
          SELECT COUNT(*)::int AS n FROM game_player_box_scores pb JOIN games g ON g.game_id = pb.game_id
          WHERE pb.player_id = 1 AND g.season_id >= ${ctx.season.id - 1} AND g.game_date < ${date}::date
            AND g.game_date <= ${ctx.asOf}::date AND ${sql.unsafe(REGULAR_SEASON)}`;
        return r.n;
      };
      const dates = await sql<{ d: string }[]>`
        SELECT g.game_date::text AS d FROM game_player_box_scores pb JOIN games g ON g.game_id = pb.game_id
        WHERE pb.player_id = 1 AND g.season_id >= ${ctx.season.id - 1} AND g.game_date <= ${ctx.asOf}::date AND ${sql.unsafe(REGULAR_SEASON)}
        ORDER BY g.game_date`;
      const mid = dates[Math.floor(dates.length / 2)].d;
      const last = dates[dates.length - 1].d;
      const rate = async (date: string) => (await refRate(makeFact({ ...pointsFact(ctx, '0', date), value: 0 }), ctx))!;
      const atMid = await rate(mid);
      const atLast = await rate(last);
      expect(atMid.kind === 'rate' && atMid.n).toBe(await countBefore(mid));
      expect(atLast.kind === 'rate' && atLast.n).toBe(await countBefore(last));
      expect(atLast.kind === 'rate' && atLast.n).toBeGreaterThan(atMid.kind === 'rate' ? atMid.n : 0);
      // A game on the fact date is not counted at that date: a fact dated the day after counts exactly one more.
      const dayAfter = new Date(new Date(`${last}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
      const after = await rate(dayAfter);
      expect(after.kind === 'rate' && after.n).toBe(await countBefore(dayAfter));
      expect(after.kind === 'rate' && after.n).toBe(atLast.kind === 'rate' ? atLast.n + 1 : -1);
      // The earliest game has no prior games to count.
      const early = await rate(dates[0].d);
      expect(early.kind === 'rate' && early.n).toBe(0);
    }, TIMEOUT);
  });

  describe('season detectors: streaks and milestones', () => {
    it('finds the seeded closing streaks (LAC games only) with prior hit rates', async () => {
      const { streakDetector } = await import('./engine/detectors/season-streaks');
      const ctx = await ctxAt('2026-02-25');
      const { facts, gameIds } = await streakDetector('season').run(ctx);
      expect(gameIds).toBeNull();
      const star = facts.find((f) => f.subject.name === 'Star Clipper' && f.stat === 'scoring_30');
      expect(star).toMatchObject({ kind: 'streak', surface: 'season', value: 5, polarity: 'positive' });
      expect(star!.keyExtra).toBe(star!.data.start_date);
      expect(star!.keyExtra).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(star!.sample).toMatchObject({ kind: 'rate', power: 5 });
      expect((star!.sample as { n: number }).n).toBeGreaterThan(50);
      expect(star!.data.streak_games).toHaveLength(5);
      expect(star!.proof.match).toEqual({ player_id: '1' });
      expect(facts.find((f) => f.subject.name === 'Big Clipper' && f.stat === 'rebounding_10')?.value).toBe(6);
      const team = facts.find((f) => f.subject.type === 'team' && ['wins', 'losses'].includes(f.stat));
      expect(team).toBeDefined();
      expect(team!.keyExtra).toBe(team!.data.start_date);
      // Seeded: the Clippers' last 12 regular-season games (since 2026-01-27) were all wins.
      expect(team).toMatchObject({ stat: 'wins', value: 12, polarity: 'positive' });
      const pRef = (team!.sample as { pRef: number }).pRef;
      expect(pRef).toBeGreaterThan(0);
      expect(pRef).toBeLessThan(1);
      expect(facts.some((f) => f.subject.name === 'LAC Player 3')).toBe(false);
    }, TIMEOUT);

    it('clippersTeamResultShare is a proper share of final regular-season games', async () => {
      const { clippersTeamResultShare } = await import('./engine/rates');
      const ctx = await ctxAt('2026-02-25');
      const w = await clippersTeamResultShare(ctx, true);
      const l = await clippersTeamResultShare(ctx, false);
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThan(1);
      expect(w + l).toBeCloseTo(1, 6);
    }, TIMEOUT);

    it('playoff games neither extend nor break a streak', async () => {
      const { streakDetector } = await import('./engine/detectors/season-streaks');
      const ctx = await ctxAt('2026-02-25');
      const starStreak = async () => (await streakDetector('season').run(ctx)).facts
        .find((f) => f.subject.name === 'Star Clipper' && f.stat === 'scoring_30')!.value;
      const before = await starStreak();
      const [last] = await sql<{ game_id: string; d: string }[]>`
        SELECT g.game_id::text AS game_id, g.game_date::text AS d FROM game_player_box_scores pb JOIN games g ON g.game_id = pb.game_id
        WHERE pb.player_id = 1 AND g.season_id = ${ctx.season.id} AND g.game_date <= ${ctx.asOf}::date
        ORDER BY g.game_date DESC, g.game_id DESC LIMIT 1`;
      expect(last.d < ctx.asOf).toBe(true);
      const ids: string[] = [];
      try {
        // Two Clippers playoff games after the streak: Star scores 40 (would extend), then 0 (would break).
        for (const [i, pts] of [40, 0].entries()) {
          const [g] = await sql<{ game_id: string }[]>`
            INSERT INTO all_games (nba_game_id, season_id, game_date, status, home_team_id, away_team_id, home_score, away_score, is_playoffs)
            VALUES (${42_500_001 + i}, ${ctx.season.id}, ${ctx.asOf}::date, 'final', ${ctx.lac.teamId}::bigint, ${3 + i}, 100, 90, true)
            RETURNING game_id::text AS game_id`;
          ids.push(g.game_id);
          await sql`
            INSERT INTO game_player_box_scores (game_id, team_id, player_id, minutes, points, rebounds, fg3_made, fg_made, fg_attempted)
            VALUES (${g.game_id}::bigint, ${ctx.lac.teamId}::bigint, 1, '30:00', ${pts}::int, 12, 4, ${pts >= 30 ? 14 : 0}::int, 20)`;
        }
        expect(await starStreak()).toBe(before);
      } finally {
        if (ids.length) await sql`DELETE FROM all_games WHERE game_id = ANY(${ids}::bigint[])`;
      }
      expect(await starStreak()).toBe(before);
    }, TIMEOUT);

    it('no team streak after the season or on the player surface', async () => {
      const { streakDetector } = await import('./engine/detectors/season-streaks');
      const done = await ctxAt(laToday());
      expect((await streakDetector('season').run(done)).facts.some((f) => f.subject.type === 'team')).toBe(false);
      const player = await streakDetector('player').run(await ctxAt('2026-02-25'));
      expect(player.facts.length).toBeGreaterThan(0);
      expect(player.facts.every((f) => f.subject.type === 'player' && f.surface === 'player')).toBe(true);
    }, TIMEOUT);

    it('emits the highest season milestone reached, regular season only', async () => {
      const { milestoneDetector } = await import('./engine/detectors/season-milestones');
      const facts = (await milestoneDetector('season').run(await ctxAt(laToday()))).facts;
      const pts = facts.find((f) => f.subject.name === 'Star Clipper' && f.stat === 'season_points');
      expect(pts).toBeDefined();
      expect(pts!.keyExtra).toBe(String(pts!.value));
      expect(pts!.data.games).toBe(60);
      expect(pts!.data.total_value!).toBeGreaterThanOrEqual(pts!.value);
      expect(pts!.data.expr).toBe('SUM(pb.points)');
      expect(pts!.sample.kind).toBe('share');
      const { MILESTONES } = await import('./engine/detectors/season-milestones');
      const def = MILESTONES.find((m) => m.key === 'season_points')!;
      expect(pts!.value).toBe(Math.max(...def.thresholds.filter((t) => t <= pts!.data.total_value!)));
      expect(facts.some((f) => f.subject.name === 'LAC Player 3')).toBe(false);
    }, TIMEOUT);
  });

  describe('incomplete league data: roster and season-total guards', () => {
    const LATE_ID = 9001;
    const incomplete = (ctx: EngineContext): EngineContext => ({ ...ctx, league: { complete: false, reason: 'test' } });

    // A player whose only LAC box score is the Clippers' last regular-season game of the season, with 1,100 points
    // (as if the rest of his season were missing): first LAC game after LAC's first game, so a late joiner.
    // The Clippers' last regular-season game of the stats season (with box scores) as of the cutoff.
    async function lastLacGameId(ctx: EngineContext): Promise<string> {
      const [last] = await sql<{ game_id: string }[]>`
        SELECT g.game_id::text AS game_id FROM games g
        WHERE ${ctx.lac.teamId}::bigint IN (g.home_team_id, g.away_team_id) AND g.season_id = ${ctx.season.id}
          AND ${sql.unsafe(REGULAR_SEASON)} AND g.game_date <= ${ctx.asOf}::date
          AND EXISTS (SELECT 1 FROM game_player_box_scores b WHERE b.game_id = g.game_id AND b.team_id = ${ctx.lac.teamId}::bigint)
        ORDER BY g.game_date DESC, g.game_id DESC LIMIT 1`;
      return last.game_id;
    }

    async function withLateJoiner(ctx: EngineContext, body: () => Promise<void>): Promise<void> {
      const last = { game_id: await lastLacGameId(ctx) };
      try {
        await sql`
          INSERT INTO players (player_id, nba_player_id, nba_person_id, first_name, last_name, display_name)
          VALUES (${LATE_ID}, ${LATE_ID}, ${1_000_000 + LATE_ID}, 'Late', 'Joiner', 'Late Joiner')`;
        await sql`
          INSERT INTO game_player_box_scores (game_id, team_id, player_id, minutes, points, rebounds, fg3_made, fg_made, fg_attempted)
          VALUES (${last.game_id}::bigint, ${ctx.lac.teamId}::bigint, ${LATE_ID}, '30:00', 1100, 5, 2, 400, 800)`;
        await body();
      } finally {
        await sql`DELETE FROM game_player_box_scores WHERE player_id = ${LATE_ID}`;
        await sql`DELETE FROM players WHERE player_id = ${LATE_ID}`;
      }
    }

    it('lateJoiners: players whose first LAC game came after the Clippers\' first', async () => {
      const { lateJoiners } = await import('./engine/games');
      const ctx = await ctxAt(laToday());
      const before = await lateJoiners(ctx);
      // The fixture's one genuine late joiner: player 11, first LAC game 2026-01-29 (checked against the DB by hand).
      expect(before).toEqual(new Set(['11']));
      await withLateJoiner(ctx, async () => {
        expect(await lateJoiners(ctx)).toEqual(new Set(['11', '9001']));
      });
    }, TIMEOUT);

    it('season milestones: a late joiner\'s total is skipped only when league data is incomplete', async () => {
      const { milestoneDetector } = await import('./engine/detectors/season-milestones');
      const ctx = await ctxAt(laToday());
      await withLateJoiner(ctx, async () => {
        const full = (await milestoneDetector('season').run(ctx)).facts;
        const lateFull = full.find((f) => f.subject.id === String(LATE_ID) && f.stat === 'season_points');
        expect(lateFull?.value).toBe(1000);
        const guarded = (await milestoneDetector('season').run(incomplete(ctx))).facts;
        expect(guarded.some((f) => f.subject.id === String(LATE_ID))).toBe(false);
        expect(guarded.some((f) => f.subject.name === 'Star Clipper' && f.stat === 'season_points')).toBe(true);
      });
    }, TIMEOUT);

    // The Clippers' last regular-season game, as a postgame ctx for it alone.
    async function lastGameCtx(): Promise<EngineContext> {
      const ctx = await ctxAt(laToday());
      return { ...ctx, gameId: await lastLacGameId(ctx) };
    }

    it('crossedSql: every total is bounded at the game date, every bind is used', async () => {
      const { crossedSql } = await import('./engine/detectors/postgame-milestones');
      const { playerTotalSub } = await import('./engine/sql');
      const q = crossedSql();
      for (const n of [1, 2, 3, 4]) expect(q).toContain(`$${n}`);
      expect(q).not.toMatch(/\$5/);
      // 3 season + 4 career milestones, each a total and a "before" total
      expect(q.split('g.game_date <= $4::date').length - 1).toBe(2 * (3 + 4) + 1); // + first_season
      expect(q.split('pb.game_id <> $1::bigint').length - 1).toBe(3 + 4);
      const s = playerTotalSub('x', 'SUM(pb.points)::int', ' AND g.season_id = $3::int');
      expect(s).toContain('pb.player_id = x.player_id');
      expect(s).toContain('g.game_date <= $4::date');
      expect(playerTotalSub('x', 'SUM(pb.points)::int', '', '$7')).toContain('g.game_date <= $7::date');
    });

    it('milestone first_since: with two Clippers over a threshold this season, neither is "first"', async () => {
      const { milestoneDetector } = await import('./engine/detectors/season-milestones');
      const { milestoneFirstSince } = await import('./engine/questions');
      const { runQuery } = await import('./engine/query');
      const ctx = await ctxAt(laToday());
      const facts = (await milestoneDetector('season').run(ctx)).facts.filter((f) => f.stat === 'season_points');
      const over = facts.filter((f) => Number(f.data.total_value) >= 1000);
      expect(over.length).toBeGreaterThanOrEqual(2);
      for (const f of over.filter((x) => x.value === 1000)) {
        const q = milestoneFirstSince.build(f, ctx)!;
        expect(q).not.toBeNull();
        expect(milestoneFirstSince.interpret(await runQuery(q), f, ctx)).toBeNull();
      }
      expect(over.some((f) => f.value === 1000)).toBe(true);
    }, TIMEOUT);

    it('postgame milestones: the game where a player passed a season total; no career claims in the fixture', async () => {
      const [g] = await sql<{ game_id: string }[]>`
        SELECT game_id FROM (
          SELECT pb.game_id::text AS game_id, SUM(pb.points) OVER (ORDER BY gg.game_date, gg.game_id) AS total
          FROM game_player_box_scores pb JOIN games gg ON gg.game_id = pb.game_id
          WHERE pb.player_id = 1 AND gg.season_id = 2025 AND ${sql.unsafe(REGULAR_SEASON.replace(/\bg\./g, 'gg.'))}
        ) x WHERE total >= 1000 ORDER BY total LIMIT 1`;
      const { milestonesCrossedDetector } = await import('./engine/detectors/postgame-milestones');
      const ctx = { ...(await ctxAt(laToday())), gameId: g.game_id };
      const facts = (await milestonesCrossedDetector().run(ctx)).facts.filter((f) => f.subject.id === '1');
      expect(facts.length).toBeGreaterThan(0);
      expect(facts.find((f) => f.stat === 'season_points')).toMatchObject({ kind: 'milestone_crossed', value: 1000, keyExtra: '1000', data: { career: false } });
      // nobody in the fixture reaches 5,000 career points, so no career fact; the career-complete rule itself is pinned by careerComplete's unit test
      expect(facts.some((f) => f.data.career)).toBe(false);
    }, TIMEOUT);

    it('postgame milestones: a late joiner gets no season or career crossing while league data is incomplete', async () => {
      const { milestonesCrossedDetector } = await import('./engine/detectors/postgame-milestones');
      const ctx = await lastGameCtx();
      await withLateJoiner(ctx, async () => {
        // 5,200 points on one line: crosses 1,000 ... 2,500 for the season and 5,000 for his career
        await sql`UPDATE game_player_box_scores SET points = 5200 WHERE player_id = ${LATE_ID}`;
        const full = (await milestonesCrossedDetector().run(ctx)).facts.filter((f) => f.subject.id === String(LATE_ID));
        expect(full.find((f) => f.stat === 'season_points')).toMatchObject({ value: 2500, data: { career: false } });
        expect(full.find((f) => f.stat === 'career_points')).toMatchObject({ value: 5000, data: { career: true } });
        const guarded = (await milestonesCrossedDetector().run(incomplete(ctx))).facts;
        expect(guarded.some((f) => f.subject.id === String(LATE_ID))).toBe(false);
        // positive control: another Clipper's crossing survives the incomplete-league ctx
        const [row] = await sql<{ points: number }[]>`SELECT points::int AS points FROM game_player_box_scores WHERE game_id = ${ctx.gameId}::bigint AND player_id = 1`;
        try {
          await sql`UPDATE game_player_box_scores SET points = 5200 WHERE game_id = ${ctx.gameId}::bigint AND player_id = 1`;
          const others = (await milestonesCrossedDetector().run(incomplete(ctx))).facts.filter((f) => f.subject.id === '1');
          expect(others.some((f) => f.stat === 'season_points')).toBe(true);
        } finally {
          await sql`UPDATE game_player_box_scores SET points = ${row.points} WHERE game_id = ${ctx.gameId}::bigint AND player_id = 1`;
        }
      });
    }, TIMEOUT);

    it('postgame milestones: a game outside the stats season counts as incomplete league data', async () => {
      const { milestonesCrossedDetector } = await import('./engine/detectors/postgame-milestones');
      const ctx = await lastGameCtx();
      await withLateJoiner(ctx, async () => {
        await sql`UPDATE game_player_box_scores SET points = 5200 WHERE player_id = ${LATE_ID}`;
        // the stats season is a different one: coverage for the game's season is unknown, so the late joiner is skipped
        const other = { ...ctx, season: { ...ctx.season, id: ctx.season.id + 1 } };
        const facts = (await milestonesCrossedDetector().run(other)).facts;
        expect(facts.some((f) => f.subject.id === String(LATE_ID))).toBe(false);
      });
    }, TIMEOUT);

    it('postgame milestones: a veteran (first season = records start) gets season but no career crossing', async () => {
      const { milestonesCrossedDetector } = await import('./engine/detectors/postgame-milestones');
      const ctx = await lastGameCtx();
      const [row] = await sql<{ points: number }[]>`SELECT points::int AS points FROM game_player_box_scores WHERE game_id = ${ctx.gameId}::bigint AND player_id = 1`;
      try {
        await sql`UPDATE game_player_box_scores SET points = 5200 WHERE game_id = ${ctx.gameId}::bigint AND player_id = 1`;
        const facts = (await milestonesCrossedDetector().run(ctx)).facts.filter((f) => f.subject.id === '1');
        expect(facts.some((f) => f.stat === 'season_points')).toBe(true);
        expect(facts.some((f) => f.stat === 'career_points')).toBe(false);
      } finally {
        await sql`UPDATE game_player_box_scores SET points = ${row.points} WHERE game_id = ${ctx.gameId}::bigint AND player_id = 1`;
      }
    }, TIMEOUT);

    it('loadEngineContext: a roster snapshot changes nothing while the league is complete', async () => {
      const { loadEngineContext } = await import('./engine/context');
      const base = await ctxAt('2026-02-25');
      expect(base.league.complete).toBe(true);
      try {
        await sql`
          INSERT INTO app_kv (key, value) VALUES ('roster:LAC',
            ${sql.json({ team: 'LAC', source: 'espn', synced_at: '2026-02-25T08:00:00Z', players: [{ player_id: '1', name: 'Star Clipper' }] })}::jsonb)
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
        const ctx = await loadEngineContext({ asOf: '2026-02-25', withPrior: false });
        expect([...ctx!.roster.keys()].sort()).toEqual([...base.roster.keys()].sort());
        expect(ctx!.roster.size).toBeGreaterThan(1);
      } finally {
        await sql`DELETE FROM app_kv WHERE key = 'roster:LAC'`;
      }
    }, TIMEOUT);
  });

  describe('pregame matchup', () => {
    // 2026-01-10 is a fixture off day: the next Clippers game (2026-01-11, 2025-26) is against the Spurs, who have
    // a last 10 of 8-2 and three hot scorers, so every opponent fact is exercised on real data.
    const IN_SEASON = '2026-01-10';
    const nextAt = async (asOf: string) => {
      const { nextClippersGame } = await import('./engine/games');
      const next = await nextClippersGame(await ctxAt(asOf));
      if (!next) throw new Error(`no next game as of ${asOf}`);
      return next;
    };
    const insertGame = (nbaGameId: number, date: string, home: number, away: number, playoffs = false) => sql<{ game_id: string }[]>`
      INSERT INTO games (nba_game_id, season_id, game_date, start_time_utc, status, home_team_id, away_team_id, home_score, away_score, is_playoffs)
      VALUES (${nbaGameId}, 2025, ${date}::date, ${date + 'T03:00:00Z'}::timestamptz, 'final', ${home}, ${away}, 110, 100, ${playoffs})
      RETURNING game_id::text AS game_id`;
    /** Runs the proof query and returns the rows that match the fact's `match` (an unused bind makes Postgres error). */
    const proofRows = async (f: { proof: { sql: string; params: (string | number | boolean | null)[]; match: Record<string, string | number | boolean> } }) => {
      const rows = await sql.unsafe(f.proof.sql, f.proof.params as never[]);
      return rows.filter((r) => Object.entries(f.proof.match).every(([k, v]) => String(r[k]) === String(v)));
    };

    it('opponent form and hot players describe the next game\'s season, are proven, and hold only the opponent\'s players', async () => {
      const { matchupDetector } = await import('./engine/detectors/pregame-matchup');
      const ctx = await ctxAt(IN_SEASON);
      const next = await nextAt(IN_SEASON);
      expect(next).toMatchObject({ seasonId: 2025, isPlayoffs: false });
      const { facts, gameIds } = await matchupDetector().run(ctx);
      expect(gameIds).toBeNull();
      const opp = facts.filter((f) => f.kind === 'opp_form' || f.kind === 'opp_hot_player');
      expect(opp.some((f) => f.kind === 'opp_form'), 'an opponent form fact').toBe(true);
      expect(opp.some((f) => f.kind === 'opp_hot_player'), 'an opponent hot player').toBe(true);
      for (const f of opp) {
        expect(f).toMatchObject({ surface: 'pregame', gameId: next.gameId, seasonId: next.seasonId });
        expect(f.context.opponent_id).toBe(next.opponentId);
        expect(f.window.season_id).toBe(next.seasonId);
        expect(f.proof.params).toContain(next.seasonId);
        expect((await proofRows(f)).length, `${f.stat} proof`).toBeGreaterThan(0);
        if (f.kind === 'opp_form') expect(f.subject).toMatchObject({ type: 'team', id: next.opponentId });
        else {
          expect(f.data.opponent_player).toBe(true);
          expect(ctx.roster.has(f.subject.id)).toBe(false);
          const [row] = await sql<{ team_id: string }[]>`
            SELECT pb.team_id::text AS team_id FROM game_player_box_scores pb JOIN games g ON g.game_id = pb.game_id
            WHERE pb.player_id = ${f.subject.id}::bigint AND g.game_date <= ${IN_SEASON}::date ORDER BY g.game_date DESC, g.game_id DESC LIMIT 1`;
          expect(row.team_id).toBe(next.opponentId);
        }
      }
      expect(opp.find((f) => f.stat === 'opp_last10')).toMatchObject({ value: 8, sample: { kind: 'share' } });
    }, TIMEOUT);

    it('the opponent streak is rated from the opponent\'s own record, on one shared form rule', async () => {
      const { matchupDetector } = await import('./engine/detectors/pregame-matchup');
      const { clippersTeamResultShare, teamResultRate } = await import('./engine/rates');
      const { TEAM_FORM_SQL } = await import('./engine/detectors/season-streaks');
      // 2026-02-06: the next opponent (Raptors) has lost 20 straight.
      const ctx = await ctxAt('2026-02-06');
      const next = await nextAt('2026-02-06');
      const { facts } = await matchupDetector().run(ctx);
      const streak = facts.find((f) => f.stat === 'opp_streak');
      expect(streak, 'an opponent streak').toBeDefined();
      expect(streak!.data).toMatchObject({ winning: false, length: 20 });
      expect(streak!.proof.sql).toBe(TEAM_FORM_SQL);
      const last10 = facts.find((f) => f.stat === 'opp_last10')!;
      expect(last10.proof.sql).toBe(TEAM_FORM_SQL);
      // One proof row holds every number both facts word (streak and last 10).
      const [row] = await proofRows(streak!);
      expect(row).toMatchObject({ streak: 20, last10_wins: 0, last10_games: 10, streak_start: streak!.data.start_date, streak_end: streak!.data.end_date });
      expect(last10.data).toMatchObject({ wins: 0, losses: 10, length: 20 });
      const pRef = await clippersTeamResultShare(ctx, false, next.opponentId);
      const rate = await teamResultRate(ctx, false, streak!.data.start_date!, next.opponentId);
      expect(streak!.sample).toEqual({ kind: 'rate', k: rate.k, n: rate.n, pRef, power: 20 });
      expect(pRef).not.toBe(0.5);
      expect(pRef).not.toBe(await clippersTeamResultShare(ctx, false));
      // The helpers keep their as-of bound for any team.
      expect(rate.n).toBeGreaterThan(0);
      expect((await teamResultRate({ ...ctx, asOf: '2025-11-01' }, false, '2026-02-06', next.opponentId)).n).toBeLessThan(rate.n);
    }, TIMEOUT);

    it('a next game in another season than the stats season gets no opponent facts, even with complete league data', async () => {
      const { matchupDetector } = await import('./engine/detectors/pregame-matchup');
      const ctx = await ctxAt(laToday());
      const next = await nextAt(laToday());
      expect(ctx.league.complete).toBe(true);
      expect(next.seasonId).not.toBe(ctx.season.id);
      const { facts } = await matchupDetector().run(ctx);
      expect(facts.filter((f) => ['opp_form', 'opp_hot_player'].includes(f.kind))).toEqual([]);

      // The same with data in the next game's season: league coverage is unknown for it, so the facts stay out.
      const inSeason = await ctxAt(IN_SEASON);
      const { facts: open } = await matchupDetector().run(inSeason);
      expect(open.some((f) => f.kind === 'opp_hot_player')).toBe(true);
      const { facts: lagging } = await matchupDetector().run({ ...inSeason, season: { ...inSeason.season, id: inSeason.season.id - 1 } });
      expect(lagging.filter((f) => ['opp_form', 'opp_hot_player'].includes(f.kind))).toEqual([]);
    }, TIMEOUT);

    it('no opponent form, hot players or rest facts for a playoff game or an opponent already in the postseason', async () => {
      const { matchupDetector } = await import('./engine/detectors/pregame-matchup');
      const ctx = await ctxAt(IN_SEASON);
      const next = await nextAt(IN_SEASON);
      const gated = (facts: { kind: string }[]) => facts.filter((f) => ['opp_form', 'opp_hot_player', 'rest'].includes(f.kind));
      const created: string[] = [];
      try {
        // A game against the Clippers on the as-of day: both teams on the second night of a back-to-back.
        const [b2b] = await insertGame(90_000_001, IN_SEASON, Number(ctx.lac.teamId), Number(next.opponentId));
        created.push(b2b.game_id);
        const open = await matchupDetector().run(ctx);
        expect(open.facts.filter((f) => f.kind === 'rest').map((f) => f.stat).sort()).toEqual(['lac_b2b', 'opp_b2b']);
        expect(open.facts.some((f) => f.kind === 'opp_hot_player'), 'hot opponents before the gate').toBe(true);

        // The opponent has played a playoff game this season.
        const [po] = await insertGame(90_000_002, '2026-01-09', Number(next.opponentId), 5, true);
        created.push(po.game_id);
        expect(gated((await matchupDetector().run(ctx)).facts)).toEqual([]);
        await sql`DELETE FROM games WHERE game_id = ${po.game_id}::bigint`;
        created.pop();
        expect(gated((await matchupDetector().run(ctx)).facts).length).toBeGreaterThan(0);

        // The next game itself is a playoff game.
        await sql`UPDATE games SET is_playoffs = TRUE WHERE game_id = ${next.gameId}::bigint`;
        expect(gated((await matchupDetector().run(ctx)).facts)).toEqual([]);
      } finally {
        await sql`UPDATE games SET is_playoffs = FALSE WHERE game_id = ${next.gameId}::bigint`;
        for (const id of created) await sql`DELETE FROM games WHERE game_id = ${id}::bigint`;
      }
    }, TIMEOUT);

    it('rest: a back-to-back is a Clippers-side fact; the opponent\'s rest needs complete league data', async () => {
      const { matchupDetector } = await import('./engine/detectors/pregame-matchup');
      const ctx = await ctxAt(IN_SEASON);
      const next = await nextAt(IN_SEASON);
      let id: string | undefined;
      try {
        [{ game_id: id }] = await insertGame(90_000_003, IN_SEASON, Number(ctx.lac.teamId), Number(next.opponentId));
        const full = await matchupDetector().run(ctx);
        const rest = full.facts.filter((f) => f.kind === 'rest');
        expect(rest.map((f) => f.stat).sort()).toEqual(['lac_b2b', 'opp_b2b']);
        for (const f of rest) {
          expect(f).toMatchObject({ surface: 'pregame', gameId: next.gameId, sample: { kind: 'context' } });
          expect((await proofRows(f)).length, f.stat).toBeGreaterThan(0);
        }
        expect(rest.find((f) => f.stat === 'lac_b2b')).toMatchObject({ value: 0, data: { lac_rest: 0, lac_last_game: IN_SEASON } });
        const partial = await matchupDetector().run({ ...ctx, league: { complete: false, reason: 'x' } });
        expect(partial.facts.map((f) => `${f.kind}/${f.stat}`)).toEqual(['rest/lac_b2b']);
      } finally {
        if (id) await sql`DELETE FROM games WHERE game_id = ${id}::bigint`;
      }
    }, TIMEOUT);

    it('rest counts the opponent\'s scheduled game between as-of and the next game (the schedule is known)', async () => {
      const { matchupDetector } = await import('./engine/detectors/pregame-matchup');
      const ctx = await ctxAt(IN_SEASON);
      const next = await nextAt(IN_SEASON);
      expect(next.date).toBe('2026-01-11');
      let id: string | undefined;
      try {
        // The opponent plays the night before the next game, but that game is not final yet (no score).
        [{ game_id: id }] = await sql<{ game_id: string }[]>`
          INSERT INTO games (nba_game_id, season_id, game_date, status, home_team_id, away_team_id)
          VALUES (90000004, 2025, ${IN_SEASON}::date, 'scheduled', ${next.opponentId}::bigint, 5)
          RETURNING game_id::text AS game_id`;
        const { facts } = await matchupDetector().run(ctx);
        const rest = facts.filter((f) => f.kind === 'rest');
        expect(rest.map((f) => f.stat)).toEqual(['opp_b2b']);
        expect(rest[0].data).toMatchObject({ opp_rest: 0, opp_last_game: IN_SEASON });
        expect((await proofRows(rest[0])).length).toBeGreaterThan(0);
      } finally {
        if (id) await sql`DELETE FROM games WHERE game_id = ${id}::bigint`;
      }
    }, TIMEOUT);

    it('the line: the latest snapshot by the end of the as-of day in Los Angeles; Clippers-side only without league data', async () => {
      const { matchupDetector, LINE_SQL } = await import('./engine/detectors/pregame-matchup');
      const ctx = await ctxAt(IN_SEASON);
      const next = await nextAt(IN_SEASON);
      const snap = (at: string, spread: number, total: number) => sql`
        INSERT INTO odds_snapshots (game_id, provider, captured_at, spread_home, spread_away, total_points)
        VALUES (${next.gameId}::bigint, 'test', ${at}::timestamptz, ${spread}, ${-spread}, ${total})`;
      try {
        await snap('2026-01-09T12:00:00-08:00', -3, 220);
        // 18:00 PT on the as-of day is 02:00 UTC the next day: a UTC-midnight cutoff would miss it.
        await snap('2026-01-10T18:00:00-08:00', -4.5, 228.5);
        // A later snapshot with no spread must not hide the valid one.
        await sql`
          INSERT INTO odds_snapshots (game_id, provider, captured_at, total_points)
          VALUES (${next.gameId}::bigint, 'test', '2026-01-10T20:00:00-08:00'::timestamptz, 230)`;
        // 00:30 PT the day after is after the as-of day.
        await snap('2026-01-11T00:30:00-08:00', -9, 240);
        const { facts } = await matchupDetector().run(ctx);
        const line = facts.find((f) => f.kind === 'line');
        const lacSpread = next.home ? -4.5 : 4.5;
        expect(line).toMatchObject({
          surface: 'pregame', gameId: next.gameId, subject: { type: 'team', id: ctx.lac.teamId }, value: lacSpread,
          data: { spread: lacSpread, total_points: 228.5 },
        });
        expect(line!.proof.sql).toBe(LINE_SQL);
        expect((await proofRows(line!)).length).toBeGreaterThan(0);
        const partial = await matchupDetector().run({ ...ctx, league: { complete: false, reason: 'x' } });
        expect(partial.facts.map((f) => f.kind)).toEqual(['line']);
      } finally {
        await sql`DELETE FROM odds_snapshots WHERE provider = 'test'`;
      }
    }, TIMEOUT);

    it('buildDraft: opponent players are scored as opponents, not dropped as former players; every fact builds', async () => {
      const { matchupDetector } = await import('./engine/detectors/pregame-matchup');
      const { buildDraft } = await import('./engine/run');
      const { factKey } = await import('./engine/keys');
      const ctx = await ctxAt(IN_SEASON);
      const { facts } = await matchupDetector().run(ctx);
      const hot = facts.filter((f) => f.kind === 'opp_hot_player');
      expect(hot.length).toBeGreaterThan(0);
      for (const f of facts) {
        const draft = await buildDraft(f, factKey(f), 'pregame.matchup', ctx);
        if ('reason' in draft) expect(['trivial'], `${f.kind}/${f.stat}`).toContain(draft.reason);
        else {
          expect(draft.headline.length).toBeLessThanOrEqual(90);
          if (f.kind === 'opp_hot_player') expect(draft.score_parts).toMatchObject({ salience_class: 'opponent', salience: 0.8 });
        }
      }
      const built = await Promise.all(hot.map((f) => buildDraft(f, factKey(f), 'pregame.matchup', ctx)));
      expect(built.filter((d) => !('reason' in d)).length, 'at least one hot opponent survives scoring').toBeGreaterThan(0);
    }, TIMEOUT);
  });

  describe('season detectors: ranks and year over year', () => {
    it('ranks the Clippers and their players league-wide, only with complete league data', async () => {
      const { leagueRankDetector } = await import('./engine/detectors/season-ranks');
      const ctx = await ctxAt(laToday());
      const facts = (await leagueRankDetector('season', { teams: true }).run(ctx)).facts;
      expect(facts.some((f) => f.subject.type === 'team' && f.data.rank! <= 5 && f.polarity === 'positive')).toBe(true);
      expect(facts.some((f) => f.subject.name === 'Star Clipper' && f.stat === 'player_ppg')).toBe(true);
      for (const f of facts) expect(f.sample.kind).toBe('share');
      expect((await leagueRankDetector('season', { teams: true }).run({ ...ctx, league: { complete: false, reason: 'test' } })).facts).toEqual([]);
      const players = (await leagueRankDetector('player', { teams: false }).run(ctx)).facts;
      expect(players.length).toBeGreaterThan(0);
      expect(players.every((f) => f.subject.type === 'player' && f.surface === 'player')).toBe(true);
      // Controller ruling F4: a player rank without a frame strength (rank > 10) is a bare rank.
      expect(players.every((f) => f.kind === 'league_rank' && f.value <= 10)).toBe(true);
      expect(facts.filter((f) => f.subject.type === 'player').length).toBeGreaterThan(0);
      expect(facts.filter((f) => f.subject.type === 'player').every((f) => f.value <= 10)).toBe(true);
    }, TIMEOUT);

    it('standings only when notable; regular season only; recent form only in season', async () => {
      const { standingsDetector, recentFormDetector } = await import('./engine/detectors/season-ranks');
      const ctx = await ctxAt(laToday());
      const facts = (await standingsDetector().run(ctx)).facts;
      expect(facts).toHaveLength(1);
      expect(facts[0].data.wins! + facts[0].data.losses!).toBe(60);
      expect(facts[0].data.rank!).toBeLessThanOrEqual(5);
      expect(facts[0].data.conference).toBe('West');
      expect((await recentFormDetector().run(ctx)).facts).toEqual([]);
      const incomplete = { ...ctx, season: { ...ctx.season, isCurrent: true }, league: { complete: false as const, reason: 'test' } };
      expect((await standingsDetector().run(incomplete)).facts).toEqual([]);
      expect((await recentFormDetector().run(incomplete)).facts).toEqual([]);
    }, TIMEOUT);

    it('recent form is suppressed once the Clippers play a postseason game, and rolling rows stop at the regular season', async () => {
      const { recentFormDetector, rollingRankSql, LAC_POSTSEASON_SQL } = await import('./engine/detectors/season-ranks');
      // The fixture already has one LAC play-in game (2026-02-21): before it, LAC has no postseason game.
      const done = await ctxAt('2026-02-20');
      const forced = { ...done, season: { ...done.season, isCurrent: true } };
      const baseline = (await recentFormDetector().run(forced)).facts;
      expect(baseline.length).toBeGreaterThan(0);
      const ids: string[] = [];
      try {
        const pre = await sql.unsafe(LAC_POSTSEASON_SQL, [done.season.id, done.lac.teamId, done.asOf] as never[]);
        expect(pre[0].postseason).toBe(false);
        const [g] = await sql<{ game_id: string }[]>`
          INSERT INTO all_games (nba_game_id, season_id, game_date, status, home_team_id, away_team_id, home_score, away_score, is_playoffs)
          VALUES (${42_500_011}, ${done.season.id}, ${done.asOf}::date, 'final', ${done.lac.teamId}::bigint, 3, 100, 90, true)
          RETURNING game_id::text AS game_id`;
        ids.push(g.game_id);
        const post = await sql.unsafe(LAC_POSTSEASON_SQL, [done.season.id, done.lac.teamId, done.asOf] as never[]);
        expect(post[0].postseason).toBe(true);
        expect((await recentFormDetector().run(forced)).facts).toEqual([]);
        const late = await ctxAt(laToday());
        expect((await recentFormDetector().run({ ...late, season: { ...late.season, isCurrent: true } })).facts).toEqual([]);
        expect(rollingRankSql('net_rating')).toContain('MAX(g.game_date)');
      } finally {
        if (ids.length) await sql`DELETE FROM all_games WHERE game_id = ANY(${ids}::bigint[])`;
      }
    }, TIMEOUT);

    it('year over year: record, net rating, the star’s scoring', async () => {
      const { yoyDetector } = await import('./engine/detectors/season-yoy');
      const facts = (await yoyDetector('season').run(await ctxAt(laToday()))).facts;
      expect(facts.find((f) => f.stat === 'record')).toMatchObject({ polarity: 'positive', data: { yoy: 'record' } });
      expect(facts.some((f) => f.stat === 'team_rank_net_rating' && f.polarity === 'positive')).toBe(true);
      const star = facts.find((f) => f.subject.name === 'Star Clipper' && f.stat === 'player_ppg');
      expect(star!.data.prev_value!).toBeLessThan(star!.value);
      expect(star!.data.expr).toBe('AVG(pb.points)');
      for (const f of facts) {
        expect(f.sample.kind).toBe('share');
        expect((f.sample as { p: number }).p).toBeGreaterThan(0);
      }
      const { yoyDetector: yd } = await import('./engine/detectors/season-yoy');
      const ctx = await ctxAt(laToday());
      expect((await yd('season').run({ ...ctx, league: { complete: false, reason: 'test' } })).facts).toEqual([]);
    }, TIMEOUT);
  });

  describe('ported pregame and postgame detectors', () => {
    it('pregame: opponent ranks, season series and last meeting, all for the next game', async () => {
      const { opponentDetector } = await import('./engine/detectors/pregame-opponent');
      const ctx = await ctxAt(laToday());
      const [next] = await sql<{ game_id: string }[]>`SELECT game_id::text FROM games WHERE status <> 'final' ORDER BY game_date LIMIT 1`;
      const { facts, gameIds } = await opponentDetector().run(ctx);
      expect(gameIds).toBeNull();
      expect(facts.map((f) => f.kind).sort()).toEqual(['h2h', 'last_meeting', 'opp_rank', 'opp_rank']);
      for (const f of facts) {
        expect(f).toMatchObject({ surface: 'pregame', gameId: next.game_id, window: { game_id: next.game_id } });
        expect(f.context.opponent_id).toBe('2');
      }
      expect(facts.find((f) => f.kind === 'h2h')!.sample).toEqual({ kind: 'context' });
    }, TIMEOUT);

    it('postgame: every big line and combo of a game, framed and rated from prior games', async () => {
      const { playerLinesDetector } = await import('./engine/detectors/postgame-player-lines');
      const [g] = await sql<{ game_id: string }[]>`SELECT game_id::text FROM game_player_box_scores WHERE player_id = 1 AND points = 55`;
      const ctx = { ...(await ctxAt(laToday())), gameId: g.game_id };
      const { facts, gameIds } = await playerLinesDetector().run(ctx);
      expect(gameIds).toEqual([g.game_id]);
      const pts = facts.find((f) => f.subject.name === 'Star Clipper' && f.stat === 'pts');
      expect(pts).toMatchObject({ kind: 'player_game_stat', surface: 'postgame', value: 55, gameId: g.game_id, window: { game_id: g.game_id } });
      expect(pts!.sample).toMatchObject({ kind: 'rate', k: 0, power: 1 });
      expect((pts!.sample as { n: number }).n).toBeGreaterThan(0);
      expect(facts.every((f) => f.gameId === g.game_id && (f.kind === 'player_game_stat' || f.kind === 'player_combo'))).toBe(true);
      const empty = await playerLinesDetector().run({ ...ctx, gameId: null });
      expect(empty).toEqual({ facts: [], gameIds: [] });
    }, TIMEOUT);

    it('postgame team lines: emits the team stats past their floors for one game, rated from prior games', async () => {
      const { teamLinesDetector } = await import('./engine/detectors/postgame-team-lines');
      const [g] = await sql<{ game_id: string; pts: number }[]>`
        SELECT t.game_id::text AS game_id, t.points::int AS pts FROM game_team_box_scores t JOIN games g ON g.game_id = t.game_id
        WHERE t.team_id = 1 AND g.season_id = 2025 AND NOT g.is_playoffs AND g.nba_game_id < 50000000 AND t.points >= 120
        ORDER BY t.points DESC LIMIT 1`;
      expect(g, 'the fixture has a Clippers regular-season game of 120+ points').toBeDefined();
      const ctx = { ...(await ctxAt(laToday())), gameId: g.game_id };
      const { facts, gameIds } = await teamLinesDetector().run(ctx);
      expect(gameIds).toEqual([g.game_id]);
      expect(facts.length).toBeGreaterThan(0);
      for (const f of facts) {
        expect(f).toMatchObject({ kind: 'team_game_stat', surface: 'postgame', subject: { type: 'team', id: '1' }, gameId: g.game_id });
        expect(f.sample.kind).toBe('rate');
      }
      expect(facts.find((f) => f.stat === 'team_pts')?.value).toBe(g.pts);
      const empty = await teamLinesDetector().run({ ...ctx, gameId: null, postgameDays: 0 });
      expect(empty.facts).toEqual([]);
    }, TIMEOUT);

    it('registry: unique names, unique categories per surface', async () => {
      const { DETECTORS } = await import('./engine/detectors/index');
      expect(new Set(DETECTORS.map((d) => d.name)).size).toBe(DETECTORS.length);
      const { RETIRED_CATEGORIES } = await import('./engine/store');
      for (const d of DETECTORS) {
        expect(d.categories.filter((c) => RETIRED_CATEGORIES.includes(c)), d.name).toEqual([]);
      }
      for (const surface of ['season', 'pregame', 'postgame', 'player'] as const) {
        const cats = DETECTORS.filter((d) => d.surface === surface).flatMap((d) => d.categories);
        expect(new Set(cats).size, surface).toBe(cats.length);
      }
    });
  });

  describe('combos end to end', () => {
    type Box = { points: number | null; rebounds: number | null; assists: number | null; steals: number | null; blocks: number | null };
    const GET = (gameId: string) => sql<(Box & { game_id: string })[]>`
      SELECT game_id::text, points::int, rebounds::int, assists::int, steals::int, blocks::int
      FROM game_player_box_scores WHERE player_id = 1 AND game_id = ${gameId}::bigint`;
    const SET = (gameId: string, b: Box) => sql`
      UPDATE game_player_box_scores SET points = ${b.points}, rebounds = ${b.rebounds}, assists = ${b.assists},
        steals = ${b.steals}, blocks = ${b.blocks}
      WHERE player_id = 1 AND game_id = ${gameId}::bigint`;
    const rerun = async (d: InsightDraft) => {
      const params = Object.entries(d.proof_params).sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1))).map(([, v]) => v);
      return (await sql.unsafe(d.proof_sql, params as never[])).map((r) => ({ ...r }));
    };

    it('an earlier triple-double with NULL steals and blocks counts; a later one is framed and its proof verifies', async () => {
      const games = await sql<{ game_id: string; d: string }[]>`
        SELECT g.game_id::text, g.game_date::text AS d FROM game_player_box_scores pb JOIN games g ON g.game_id = pb.game_id
        WHERE pb.player_id = 1 AND pb.team_id = 1 AND g.season_id = 2025 AND g.status = 'final' AND ${sql.unsafe(REGULAR_SEASON)}
        ORDER BY g.game_date`;
      const early = games[5];
      const late = games[games.length - 1];
      const [origEarly] = await GET(early.game_id);
      const [origLate] = await GET(late.game_id);
      const { runEngine } = await import('./engine/run');
      const { refRate } = await import('./engine/rates');
      try {
        await SET(early.game_id, { points: 10, rebounds: 10, assists: 10, steals: null, blocks: null });
        await SET(late.game_id, { points: 12, rebounds: 11, assists: 10, steals: 1, blocks: 0 });
        const ctx = await ctxAt(laToday());
        const tdFact = (date: string, gameId: string) => makeFact({
          kind: 'player_combo', surface: 'postgame', stat: 'triple_double', value: 1,
          window: { type: 'game', game_id: gameId, season_id: 2025 }, context: { date }, gameId, seasonId: 2025, data: {},
        });
        // p_ref counts only games strictly before the fact date, and the NULL-steals triple-double is a hit.
        const day = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
        const at = await refRate(tdFact(early.d, '0'), ctx);
        const after = await refRate(tdFact(day(early.d, 1), '0'), ctx);
        expect(at).toMatchObject({ kind: 'rate', k: 0 });
        expect((at as { pRef: number }).pRef).toBe(0);
        expect((after as { pRef: number }).pRef).toBeGreaterThan(0);

        // The earlier triple-double (NULL steals) is the one the later game is "first since".
        const withEarlier = await runEngine({ surfaces: ['postgame'], asOf: laToday(), write: false, gameId: late.game_id });
        const combo = withEarlier.drafts.find((d) => d.category === 'player_combo' && d.entities.some((e) => e.id === '1'));
        expect(combo, 'triple-double combo draft').toBeDefined();
        expect(combo!.frame.type).toBe('first_since');
        expect(combo!.frame.since_date).toBe(early.d);
        expect(combo!.headline).toMatch(/^Star Clipper posted a triple-double|^Star Clipper had 12 pts, 11 reb, 10 ast/);

        // With no earlier one, it is the only one, and the stored proof re-runs to the same rows.
        await SET(early.game_id, origEarly);
        const alone = await runEngine({ surfaces: ['postgame'], asOf: laToday(), write: false, gameId: late.game_id });
        const only = alone.drafts.find((d) => d.category === 'player_combo' && d.entities.some((e) => e.id === '1'));
        expect(only!.frame.type).toBe('only_one');
        expect(only!.detail).toMatch(/only triple-double by a Clipper since \d{4}-\d{2}|^12 pts, 11 reb, 10 ast/);
        const again = await rerun(only!);
        // The stored rows (this player's fact row plus the frame rows) are all still produced by the proof.
        const norm = (rows: unknown[]) => rows.map((r) => JSON.stringify(JSON.parse(JSON.stringify(r))));
        const live = new Set(norm(again));
        for (const row of norm(only!.proof_result)) expect(live.has(row), row).toBe(true);
        expect(only!.proof_result.some((r) => (r as { part: string; data: { player_id?: string; triple_double?: boolean } }).part === 'fact'
          && (r as { data: { player_id?: string } }).data.player_id === '1'
          && (r as { data: { triple_double?: boolean } }).data.triple_double === true)).toBe(true);
        expect(only!.proof_result.some((r) => (r as { part: string }).part === 'fact')).toBe(true);
      } finally {
        await SET(early.game_id, origEarly);
        await SET(late.game_id, origLate);
      }
    }, TIMEOUT);
  });

  describe('postgame window', () => {
    it('covers the last N days of regular-season finals, or one game', async () => {
      const { loadEngineContext } = await import('./engine/context');
      const { postgameGames } = await import('./engine/games');
      const at = async (postgameDays: number, gameId: string | null = null) =>
        postgameGames((await loadEngineContext({ asOf: '2026-02-17', withPrior: false, postgameDays, gameId }))!);
      const three = await at(3);
      expect(three.map((g) => g.date)).toEqual(['2026-02-16']);
      expect(three[0].seasonId).toBe(2025);
      expect(['W', 'L']).toContain(three[0].result);
      expect(three[0].lacScore).toBeGreaterThan(0);
      // The upper edge is inclusive: a game dated exactly on as-of is covered.
      const onEdge = await postgameGames((await loadEngineContext({ asOf: '2026-02-16', withPrior: false, postgameDays: 1 }))!);
      expect(onEdge.map((g) => g.date)).toEqual(['2026-02-16']);
      expect((await at(5)).map((g) => g.date)).toEqual(['2026-02-14', '2026-02-16']);
      const [first] = await sql<{ game_id: string }[]>`
        SELECT game_id::text FROM games WHERE season_id = 2025 AND 1 IN (home_team_id, away_team_id) ORDER BY game_date LIMIT 1`;
      expect((await at(3, first.game_id)).map((g) => g.gameId)).toEqual([first.game_id]);
    }, TIMEOUT);
  });

  describe('postgame flow, quarters and clutch (play-by-play)', () => {
    let comebackGame: string;
    beforeAll(async () => {
      comebackGame = await seedGameFlows(sql);
      run('scripts/build-record-book.ts');
    }, TIMEOUT);

    it('frames game flow since play-by-play records start, and skips without them', async () => {
      const { flowDetector } = await import('./engine/detectors/postgame-flow');
      const ctx = await ctxAt(laToday());
      expect(ctx.pbpRecordsStart).toEqual({ season_id: 2025, label: '2025-26' });
      const out = await flowDetector().run({ ...ctx, gameId: comebackGame });
      expect(out.facts.map((f) => f.stat)).toEqual(['comeback']);
      expect(out.facts[0]).toMatchObject({
        kind: 'game_flow', value: 15, polarity: 'positive', gameId: comebackGame,
        data: { margin_series: [[0, 0], [1440, -15], [2880, 3]], lead: 8, deficit: 15 },
      });
      expect(out.facts[0].sample).toMatchObject({ kind: 'rate', k: 0 });
      expect(await flowDetector().run({ ...ctx, gameId: comebackGame, pbpRecordsStart: null })).toEqual({ facts: [], gameIds: [] });
    }, TIMEOUT);

    it('a game with no play-by-play yields no flow facts', async () => {
      const { flowDetector } = await import('./engine/detectors/postgame-flow');
      const [row] = await sql<{ j: unknown }[]>`SELECT to_jsonb(gf) AS j FROM game_flow gf WHERE game_id = ${comebackGame}::bigint`;
      try {
        await sql`DELETE FROM game_flow WHERE game_id = ${comebackGame}::bigint`;
        const out = await flowDetector().run({ ...(await ctxAt(laToday())), gameId: comebackGame });
        expect(out).toEqual({ facts: [], gameIds: [comebackGame] });
      } finally {
        await sql`INSERT INTO game_flow SELECT * FROM jsonb_populate_record(NULL::game_flow, ${sql.json(row.j as never)})`;
      }
    }, TIMEOUT);

    it('bounds an older flow fact\'s references at its own game date (R2)', async () => {
      const { flowDetector } = await import('./engine/detectors/postgame-flow');
      const { refsFor } = await import('./engine/references');
      const ctx = await ctxAt(laToday());
      const { facts } = await flowDetector().run({ ...ctx, gameId: comebackGame });
      expect(facts.length).toBeGreaterThan(0);
      const fact = facts[0];
      expect(fact.context.date < ctx.asOf).toBe(true);
      const refs = refsFor(fact, ctx)!;
      expect(refs.group!.params[2]).toBe(fact.context.date);
      expect(refs.group!.params[2]).not.toBe(ctx.asOf);
    }, TIMEOUT);

    it('bounds the gate by season: an earlier-season game dated after the start date does not close it (bubble)', async () => {
      const { pbpRecordsComplete } = await import('./engine/pbp-coverage');
      const { runQuery } = await import('./engine/query');
      const [old] = await sql<{ game_id: string; d: string }[]>`
        SELECT g.game_id::text, g.game_date::text AS d FROM games g
        WHERE g.season_id = 2024 AND 1 IN (g.home_team_id, g.away_team_id) AND g.status = 'final' AND ${sql.unsafe(REGULAR_SEASON)}
          AND NOT EXISTS (SELECT 1 FROM game_flow gf WHERE gf.game_id = g.game_id)
        ORDER BY g.game_date DESC LIMIT 1`;
      expect(old, 'a season-2024 Clippers final without play-by-play').toBeDefined();
      const ctx = await ctxAt(laToday());
      expect(ctx.pbpRecordsStart?.season_id).toBe(2025);
      try {
        // Dated inside the 2025-26 date range (after Aug 1 2025) but belonging to the previous season.
        await sql`UPDATE games SET game_date = '2025-09-01' WHERE game_id = ${old.game_id}::bigint`;
        expect(await pbpRecordsComplete(ctx, laToday(), runQuery)).toBe(true);
      } finally {
        await sql`UPDATE games SET game_date = ${old.d}::date WHERE game_id = ${old.game_id}::bigint`;
      }
    }, TIMEOUT);

    /** pbpRecordsComplete caches per context object, so each read after a data change needs a fresh one. */
    const makeCtxCopy = <T extends object>(c: T): T => ({ ...c });

    describe('quarters, halves and clutch', () => {
      beforeAll(async () => {
        await sql`
          INSERT INTO period_player_stats (game_id, player_id, team_id, period, pts, reb, ast, fg3m, fgm, fga, stl, blk)
          SELECT ${comebackGame}::bigint, 1, 1, p, pts, 0, 0, 0, pts / 2, pts, 0, 0
          FROM (VALUES (1, 8), (2, 15), (3, 6), (4, 10), (5, 30)) AS v(p, pts)`;
        await sql`
          INSERT INTO period_team_stats (game_id, team_id, period, pts, fgm, fga, fg3m, fg3a, ftm, fta, reb, ast, tov)
          SELECT ${comebackGame}::bigint, 1, p, pts, 10, 22, 3, 8, 4, 5, 11, 6, 3
          FROM (VALUES (1, 40), (2, 25), (3, 30), (4, 28), (5, 50)) AS v(p, pts)`;
        await sql`
          INSERT INTO clutch_stats (game_id, team_id, player_id, pts, fgm, fga, fg3m, ftm, fta, tov)
          VALUES (${comebackGame}::bigint, 1, NULL, 12, 4, 9, 1, 3, 4, 1), (${comebackGame}::bigint, 1, 1, 9, 3, 5, 0, 3, 4, 0)`;
      }, TIMEOUT);
      afterAll(async () => {
        await sql`DELETE FROM period_player_stats WHERE game_id = ${comebackGame}::bigint`;
        await sql`DELETE FROM period_team_stats WHERE game_id = ${comebackGame}::bigint`;
        await sql`DELETE FROM clutch_stats WHERE game_id = ${comebackGame}::bigint`;
      }, TIMEOUT);

      it('frames the best quarter, half and clutch line of a game (overtime periods ignored)', async () => {
        const { periodsDetector, clutchDetector } = await import('./engine/detectors/postgame-periods');
        const ctx = { ...(await ctxAt(laToday())), gameId: comebackGame };
        const periods = (await periodsDetector().run(ctx)).facts;
        expect(periods.length).toBeGreaterThan(0);
        expect(periods.map((f) => `${f.stat}:${f.value}:${f.window.period}`).sort()).toEqual(['half_pts:23:1', 'q_pts:15:2', 'team_q_pts:40:1']);
        const clutch = (await clutchDetector().run(ctx)).facts;
        expect(clutch).toHaveLength(1);
        expect(clutch[0]).toMatchObject({ kind: 'clutch', stat: 'clutch_pts', value: 9, data: { fgm: 3, fga: 5, ftm: 3, fta: 4 } });
        expect(await periodsDetector().run({ ...ctx, pbpRecordsStart: null })).toEqual({ facts: [], gameIds: [] });
        expect(await clutchDetector().run({ ...ctx, pbpRecordsStart: null })).toEqual({ facts: [], gameIds: [] });
      }, TIMEOUT);

      it('a game with no period or clutch rows yields no facts', async () => {
        const { periodsDetector, clutchDetector } = await import('./engine/detectors/postgame-periods');
        const [other] = await sql<{ game_id: string }[]>`
          SELECT game_id::text FROM game_flow WHERE game_id <> ${comebackGame}::bigint LIMIT 1`;
        const ctx = { ...(await ctxAt(laToday())), gameId: other.game_id };
        expect(await periodsDetector().run(ctx)).toEqual({ facts: [], gameIds: [other.game_id] });
        expect(await clutchDetector().run(ctx)).toEqual({ facts: [], gameIds: [other.game_id] });
      }, TIMEOUT);

      it('values each fact with the expression its reference set uses, and bounds the sets at the game date (R2)', async () => {
        const { periodsDetector, clutchDetector } = await import('./engine/detectors/postgame-periods');
        const { refsFor } = await import('./engine/references');
        const { runQuery } = await import('./engine/query');
        const ctx = { ...(await ctxAt(laToday())), gameId: comebackGame };
        const facts = [...(await periodsDetector().run(ctx)).facts, ...(await clutchDetector().run(ctx)).facts];
        expect(facts.length).toBeGreaterThan(0);
        for (const f of facts) {
          expect(f.context.date < ctx.asOf).toBe(true);
          const refs = refsFor(f, ctx)!;
          expect(refs.group!.params[2], `${f.stat} refs bound at the game date`).toBe(f.context.date);
          const own = (await runQuery(refs.group!)).filter((r) => r.game_id === comebackGame && r.subject_id === f.subject.id);
          expect(own, `${f.stat} own row in its reference set`).toHaveLength(1);
          expect(Number(own[0].value), `${f.stat} fact value equals its reference value`).toBe(f.value);
        }
      }, TIMEOUT);

      it('drops the record frames when an earlier game\'s player rows do not add up to its team rows (dropped players)', async () => {
        const { runEngine } = await import('./engine/run');
        const { pbpRecordsComplete } = await import('./engine/pbp-coverage');
        const { runQuery } = await import('./engine/query');
        const { PBP_RECORD_FRAMES } = await import('./engine/framer');
        const ctx = await ctxAt(laToday());
        const [early] = await sql<{ game_id: string }[]>`
          SELECT g.game_id::text FROM games g
          WHERE g.season_id = 2025 AND 1 IN (g.home_team_id, g.away_team_id) AND g.status = 'final' AND ${sql.unsafe(REGULAR_SEASON)}
            AND g.game_id <> ${comebackGame}::bigint AND g.game_date < (SELECT game_date FROM games WHERE game_id = ${comebackGame}::bigint)
          ORDER BY g.game_date LIMIT 1`;
        expect(early, 'a Clippers game before this one').toBeDefined();
        const [{ d }] = await sql<{ d: string }[]>`SELECT game_date::text AS d FROM games WHERE game_id = ${comebackGame}::bigint`;
        const drafts = async () => {
          const res = await runEngine({ surfaces: ['postgame'], asOf: laToday(), write: false, gameId: comebackGame });
          const mine = res.drafts.filter((x) => ['player_period_stat', 'team_period_stat', 'clutch'].includes(x.category));
          expect(mine.length, 'period and clutch drafts').toBeGreaterThanOrEqual(4);
          return mine;
        };
        try {
          // A consistent earlier game: player period points equal the team's, player clutch equals the team clutch row.
          await sql`INSERT INTO period_team_stats (game_id, team_id, period, pts, fgm, fga, fg3m, fg3a, ftm, fta, reb, ast, tov)
            SELECT ${early.game_id}::bigint, 1, p, 10, 4, 9, 1, 3, 1, 2, 5, 2, 1 FROM generate_series(1, 4) AS p`;
          await sql`INSERT INTO period_player_stats (game_id, player_id, team_id, period, pts, reb, ast, fg3m, fgm, fga, stl, blk)
            SELECT ${early.game_id}::bigint, 1, 1, p, 10, 0, 0, 0, 4, 9, 0, 0 FROM generate_series(1, 4) AS p`;
          await sql`INSERT INTO clutch_stats (game_id, team_id, player_id, pts, fgm, fga, fg3m, ftm, fta, tov)
            VALUES (${early.game_id}::bigint, 1, NULL, 5, 2, 4, 0, 1, 2, 0), (${early.game_id}::bigint, 1, 1, 5, 2, 4, 0, 1, 2, 0)`;
          expect(await pbpRecordsComplete(ctx, d, runQuery)).toBe(true);
          const complete = await drafts();
          expect(complete.filter((x) => x.frame.type === 'records_best').length, 'record frames while complete').toBeGreaterThan(0);

          // A dropped player: his period row is gone (zeroed) while the team row stands.
          const [pp] = await sql<{ pts: number }[]>`
            SELECT pts::int FROM period_player_stats WHERE game_id = ${early.game_id}::bigint AND player_id = 1 AND period = 2`;
          try {
            await sql`UPDATE period_player_stats SET pts = 0 WHERE game_id = ${early.game_id}::bigint AND player_id = 1 AND period = 2`;
            expect(await pbpRecordsComplete(makeCtxCopy(ctx), d, runQuery)).toBe(false);
            for (const x of await drafts()) expect(PBP_RECORD_FRAMES.has(x.frame.type), `${x.category} ${x.frame.type}`).toBe(false);
          } finally {
            await sql`UPDATE period_player_stats SET pts = ${pp.pts} WHERE game_id = ${early.game_id}::bigint AND player_id = 1 AND period = 2`;
          }
          expect(await pbpRecordsComplete(makeCtxCopy(ctx), d, runQuery)).toBe(true);

          // A dropped clutch player: the team clutch row counts more than the players' rows.
          try {
            await sql`UPDATE clutch_stats SET pts = 3 WHERE game_id = ${early.game_id}::bigint AND player_id = 1`;
            expect(await pbpRecordsComplete(makeCtxCopy(ctx), d, runQuery)).toBe(false);
            for (const x of await drafts()) expect(PBP_RECORD_FRAMES.has(x.frame.type), `${x.category} ${x.frame.type}`).toBe(false);
          } finally {
            await sql`UPDATE clutch_stats SET pts = 5 WHERE game_id = ${early.game_id}::bigint AND player_id = 1`;
          }
          expect(await pbpRecordsComplete(makeCtxCopy(ctx), d, runQuery)).toBe(true);
        } finally {
          await sql`DELETE FROM period_player_stats WHERE game_id = ${early.game_id}::bigint`;
          await sql`DELETE FROM period_team_stats WHERE game_id = ${early.game_id}::bigint`;
          await sql`DELETE FROM clutch_stats WHERE game_id = ${early.game_id}::bigint`;
        }
      }, TIMEOUT);

      it('drops the record frames of a quarter, half and clutch fact when an earlier game has no play-by-play', async () => {
        const { runEngine } = await import('./engine/run');
        const { PBP_RECORD_FRAMES } = await import('./engine/framer');
        const drafts = async () => {
          const res = await runEngine({ surfaces: ['postgame'], asOf: laToday(), write: false, gameId: comebackGame });
          const by = (category: string, re: RegExp) => res.drafts.find((d) => d.category === category && re.test(d.headline));
          return {
            quarter: by('player_period_stat', /in the 2nd quarter/), half: by('player_period_stat', /first half/),
            team: by('team_period_stat', /1st quarter/), clutch: by('clutch', /clutch time/),
          };
        };
        const [early] = await sql<{ game_id: string }[]>`
          SELECT g.game_id::text FROM games g
          WHERE g.season_id = 2025 AND 1 IN (g.home_team_id, g.away_team_id) AND g.status = 'final' AND ${sql.unsafe(REGULAR_SEASON)}
            AND g.game_id <> ${comebackGame}::bigint AND g.game_date < (SELECT game_date FROM games WHERE game_id = ${comebackGame}::bigint)
          ORDER BY g.game_date LIMIT 1`;
        expect(early, 'a Clippers game before this one').toBeDefined();

        const complete = await drafts();
        for (const [name, d] of Object.entries(complete)) {
          expect(d, `${name} draft`).toBeDefined();
          expect(d!.frame.type, name).toBe('records_best');
          expect(d!.detail, name).toMatch(/ since 2025-26| in 1 season of records$/);
        }
        expect(complete.clutch!.detail).toMatch(/^Most clutch points in a game by a Clipper/);

        const [row] = await sql<{ j: unknown }[]>`SELECT to_jsonb(gf) AS j FROM game_flow gf WHERE game_id = ${early.game_id}::bigint`;
        try {
          await sql`DELETE FROM game_flow WHERE game_id = ${early.game_id}::bigint`;
          const gated = await drafts();
          for (const [name, d] of Object.entries(gated)) {
            expect(d, `${name} draft survives`).toBeDefined();
            expect(PBP_RECORD_FRAMES.has(d!.frame.type), name).toBe(false);
            expect(d!.headline, name).toBe((complete as Record<string, { headline: string }>)[name].headline);
          }
          expect(gated.clutch!.detail).toBe('3-of-5 from the field, 3-of-4 at the line in clutch time');
        } finally {
          await sql`INSERT INTO game_flow SELECT * FROM jsonb_populate_record(NULL::game_flow, ${sql.json(row.j as never)})`;
        }
        expect((await drafts()).quarter!.frame.type).toBe('records_best');
      }, TIMEOUT);
    });

    it('drops the record frames, and only those, when an earlier game has no play-by-play (R7)', async () => {
      const { runEngine } = await import('./engine/run');
      const { PBP_RECORD_FRAMES } = await import('./engine/framer');
      const comeback = async () => {
        const res = await runEngine({ surfaces: ['postgame'], asOf: laToday(), write: false, gameId: comebackGame });
        const drafts = res.drafts.filter((d) => d.category === 'game_flow');
        expect(drafts.length, 'a flow draft for the comeback game').toBeGreaterThan(0);
        return drafts.find((d) => /\b15\b/.test(d.headline))!;
      };
      const [early] = await sql<{ game_id: string }[]>`
        SELECT g.game_id::text FROM games g
        WHERE g.season_id = 2025 AND 1 IN (g.home_team_id, g.away_team_id) AND g.status = 'final' AND ${sql.unsafe(REGULAR_SEASON)}
          AND g.game_id <> ${comebackGame}::bigint AND g.game_date < (SELECT game_date FROM games WHERE game_id = ${comebackGame}::bigint)
        ORDER BY g.game_date LIMIT 1`;
      expect(early, 'a Clippers game before the comeback').toBeDefined();

      const complete = await comeback();
      expect(complete.frame.type).toBe('records_best');
      expect(complete.detail).toMatch(/^Largest comeback win by the Clippers (since 2025-26|in 1 season of records)$/);

      const [row] = await sql<{ j: unknown }[]>`SELECT to_jsonb(gf) AS j FROM game_flow gf WHERE game_id = ${early.game_id}::bigint`;
      try {
        await sql`DELETE FROM game_flow WHERE game_id = ${early.game_id}::bigint`;
        const gated = await comeback();
        expect(PBP_RECORD_FRAMES.has(gated.frame.type)).toBe(false);
        // The fixture has no other frame, so nothing is left: the fact itself and its evidence survive.
        expect(gated.frame.type).toBe('none');
        expect(gated.headline).toBe(complete.headline);
        expect(gated.evidence).toMatchObject({ type: 'margin_spark' });
        expect(gated.detail).toBe('Largest lead 8, largest deficit 15');
      } finally {
        await sql`INSERT INTO game_flow SELECT * FROM jsonb_populate_record(NULL::game_flow, ${sql.json(row.j as never)})`;
      }
      expect((await comeback()).frame.type).toBe('records_best');
    }, TIMEOUT);
  });

  describe('generate-insights', () => {
    it('writes every batch surface, cuts legacy rows, keeps live rows, and verifies', async () => {
      await sql`
        INSERT INTO insights (scope, category, headline, importance, proof_sql, proof_params, proof_result, proof_hash) VALUES
          ('between_games', 'streak', 'Legacy claim', 50, 'SELECT 1 AS one', '{}'::jsonb, '[{"one":1}]'::jsonb, 'legacy-cli'),
          ('live', 'run', 'Live claim', 50, 'SELECT 1 AS one', '{}'::jsonb, '[{"one":1}]'::jsonb, 'live-cli')`;
      const out = run('scripts/generate-insights.ts');
      expect(out).toMatch(/\d+ upserted, \d+ stale deactivated, 1 legacy deactivated/);
      const rows = await sql<{ surface: string | null; scope: string; proof_hash: string; is_active: boolean; first: string | null }[]>`
        SELECT surface, scope, proof_hash, is_active, first_emitted_at::text AS first FROM insights`;
      const v2 = rows.filter((r) => r.is_active && r.surface);
      expect(new Set(v2.map((r) => r.surface))).toEqual(new Set(['season', 'pregame']));
      for (const r of v2) {
        expect(r.scope).toBe(r.surface === 'postgame' ? 'historical' : 'between_games');
        expect(r.first).not.toBeNull();
      }
      expect(rows.find((r) => r.proof_hash === 'legacy-cli')?.is_active).toBe(false);
      expect(rows.find((r) => r.proof_hash === 'live-cli')?.is_active).toBe(true);
      expect(run('scripts/verify-insights.ts')).toMatch(/\d+ checked, 0 legacy skipped, 0 failed/);
    }, TIMEOUT);

    it('is idempotent: same rows, same first emission', async () => {
      const snap = () => sql<{ proof_hash: string; first: string }[]>`
        SELECT proof_hash, first_emitted_at::text AS first FROM insights WHERE surface IS NOT NULL ORDER BY proof_hash`;
      const before = await snap();
      run('scripts/generate-insights.ts');
      expect(await snap()).toEqual(before);
    }, TIMEOUT);

    it('rewrites wording in place for an in-season as-of, and back', async () => {
      run('scripts/generate-insights.ts', ['--as-of=2026-02-25', '--surface=season']);
      const inSeason = await sql<{ headline: string }[]>`SELECT headline FROM insights WHERE is_active AND surface = 'season'`;
      expect(inSeason.some((r) => r.headline.includes('this season'))).toBe(true);
      expect(inSeason.some((r) => r.headline.startsWith('Clippers finished'))).toBe(false);
      run('scripts/generate-insights.ts', ['--surface=season']);
      const done = await sql<{ headline: string }[]>`SELECT headline FROM insights WHERE is_active AND surface = 'season'`;
      expect(done.some((r) => r.headline.includes('this season'))).toBe(false);
      expect(run('scripts/verify-insights.ts')).toMatch(/0 failed/);
    }, TIMEOUT);

    it('retires league_night: its batch rows are deactivated on a write run, live rows are untouched', async () => {
      const { RETIRED_CATEGORIES } = await import('./engine/store');
      expect(RETIRED_CATEGORIES).toContain('league_night');
      for (const [key, scope, surface] of [['retired-batch', 'historical', 'postgame'], ['retired-live', 'live', null]]) {
        await sql`
          INSERT INTO insights (scope, surface, category, headline, importance, proof_sql, proof_params, proof_result, proof_hash, first_emitted_at)
          VALUES (${scope}, ${surface}, 'league_night', 'Old big night', 10, 'SELECT 1 AS one', '{}'::jsonb,
                  '[{"part":"fact","data":{"one":1}}]'::jsonb, ${key}, now())`;
      }
      const { runEngine } = await import('./engine/run');
      const out = await runEngine({ surfaces: ['postgame'], asOf: laToday(), write: true });
      expect(out.retiredDeactivated).toBeGreaterThanOrEqual(1);
      const rows = await sql<{ proof_hash: string; is_active: boolean }[]>`
        SELECT proof_hash, is_active FROM insights WHERE proof_hash LIKE 'retired-%' ORDER BY 1`;
      expect(rows).toEqual([{ proof_hash: 'retired-batch', is_active: false }, { proof_hash: 'retired-live', is_active: true }]);
      expect((await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM insights WHERE category = 'league_night' AND scope <> 'live' AND is_active`)[0].n).toBe(0);
      await sql`DELETE FROM insights WHERE proof_hash LIKE 'retired-%'`;
    }, TIMEOUT);

    it('a single-game postgame run leaves other games alone', async () => {
      const [g1, g2] = (await sql<{ game_id: string }[]>`
        SELECT game_id::text FROM games WHERE status = 'final' AND 1 IN (home_team_id, away_team_id) AND season_id = 2025
        ORDER BY game_date LIMIT 2`).map((r) => r.game_id);
      for (const [key, gameId] of [['fake-g1', g1], ['fake-g2', g2]]) {
        await sql`
          INSERT INTO insights (scope, surface, category, headline, importance, proof_sql, proof_params, proof_result, proof_hash, game_id, first_emitted_at)
          VALUES ('historical', 'postgame', 'player_game_stat', 'Fake', 10, 'SELECT 1 AS one', '{}'::jsonb,
                  '[{"part":"fact","data":{"one":1}}]'::jsonb, ${key}, ${gameId}::bigint, now())`;
      }
      run('scripts/generate-insights.ts', ['--surface=postgame', `--game=${g1}`]);
      const rows = await sql<{ proof_hash: string; is_active: boolean }[]>`
        SELECT proof_hash, is_active FROM insights WHERE proof_hash LIKE 'fake-%' ORDER BY 1`;
      expect(rows).toEqual([{ proof_hash: 'fake-g1', is_active: false }, { proof_hash: 'fake-g2', is_active: true }]);
      await sql`DELETE FROM insights WHERE proof_hash LIKE 'fake-%'`;
      expect(run('scripts/verify-insights.ts')).toMatch(/\b0 failed\b/);
    }, TIMEOUT);

    it('a single-game run writes that game\'s player lines, and their proofs verify', async () => {
      const [g] = await sql<{ game_id: string }[]>`SELECT game_id::text FROM game_player_box_scores WHERE player_id = 1 AND points = 55`;
      run('scripts/generate-insights.ts', ['--surface=postgame', `--game=${g.game_id}`]);
      const rows = await sql<{ category: string; game_id: string }[]>`
        SELECT category, game_id::text FROM insights WHERE is_active AND surface = 'postgame' AND game_id = ${g.game_id}::bigint`;
      expect(rows.some((r) => r.category === 'player_game_stat')).toBe(true);
      expect(rows.some((r) => r.category === 'team_game_stat')).toBe(true);
      expect(rows.every((r) => r.game_id === g.game_id)).toBe(true);
      // A frozen postgame claim names its season as "so far in", never "this season" or a bare "in {label}".
      const details = await sql<{ detail: string }[]>`
        SELECT detail FROM insights WHERE is_active AND surface = 'postgame' AND game_id = ${g.game_id}::bigint`;
      for (const d of details) expect(d.detail).not.toMatch(/this season|(?<!so far )\bin \d{4}-\d{2}\b/);
      expect(run('scripts/verify-insights.ts')).toMatch(/\b0 failed\b/);
    }, TIMEOUT);

    it('a dry run writes nothing', async () => {
      const state = async () => (await sql<{ n: number; u: string }[]>`
        SELECT COUNT(*)::int AS n, MAX(updated_at)::text AS u FROM insights`)[0];
      const before = await state();
      expect(run('scripts/generate-insights.ts', ['--dry'])).toContain('(dry run)');
      expect(await state()).toEqual(before);
    }, TIMEOUT);

    it('rejects bad arguments with exit code 1', () => {
      expect(() => run('scripts/generate-insights.ts', ['--surface=live'])).toThrow();
      expect(() => run('scripts/generate-insights.ts', ['--game=12'])).toThrow();
    }, TIMEOUT);

    it('refuses a postgame detector that would clear every game, before writing anything', async () => {
      const { runEngine } = await import('./engine/run');
      const rogue = { name: 'postgame.rogue', surface: 'postgame' as const, categories: ['player_game_stat' as const], run: async () => ({ facts: [], gameIds: null }) };
      const before = (await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM insights WHERE is_active`)[0].n;
      await expect(runEngine({ surfaces: ['postgame'], asOf: laToday(), write: true, detectors: [rogue] }))
        .rejects.toThrow(/postgame\.rogue/);
      expect((await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM insights WHERE is_active`)[0].n).toBe(before);
    }, TIMEOUT);

    describe('detector output is checked before anything is written', () => {
      const activeRows = async () =>
        (await sql<{ n: number; h: string }[]>`
          SELECT COUNT(*)::int AS n, COALESCE(MD5(STRING_AGG(proof_hash, ',' ORDER BY proof_hash)), '') AS h
          FROM insights WHERE is_active`)[0];
      const stat = (over: object = {}) => ({
        kind: 'player_game_stat' as const, surface: 'postgame' as const,
        subject: { type: 'player' as const, id: '1', name: 'Star Clipper' }, stat: 'pts', value: 30,
        window: { type: 'game' as const, game_id: '1', season_id: 2025 }, context: { date: '2026-02-16' },
        polarity: 'positive' as const, proof: { sql: 'SELECT 1 AS one', params: [], match: { one: 1 } },
        asOf: '2026-02-17', sample: { kind: 'context' as const }, data: {}, gameId: '1', seasonId: 2025, ...over,
      });
      const rogue = (over: object, gameIds: string[] | null = ['1'], surface: 'postgame' | 'season' = 'postgame') => ({
        name: 'rogue', surface, categories: ['player_game_stat' as const], run: async () => ({ facts: [stat(over)], gameIds }),
      });

      it('a fact of a kind outside the detector categories', async () => {
        const { runEngine } = await import('./engine/run');
        const before = await activeRows();
        await expect(runEngine({ surfaces: ['postgame'], asOf: '2026-02-17', write: true, detectors: [rogue({ kind: 'streak' })] }))
          .rejects.toThrow(/rogue emitted postgame\/streak/);
        expect(await activeRows()).toEqual(before);
      }, TIMEOUT);

      it('a fact of another surface', async () => {
        const { runEngine } = await import('./engine/run');
        const before = await activeRows();
        await expect(runEngine({ surfaces: ['postgame'], asOf: '2026-02-17', write: true, detectors: [rogue({ surface: 'season' })] }))
          .rejects.toThrow(/rogue emitted season\/player_game_stat/);
        expect(await activeRows()).toEqual(before);
      }, TIMEOUT);

      it('a postgame fact for a game the detector did not cover', async () => {
        const { runEngine } = await import('./engine/run');
        const before = await activeRows();
        await expect(runEngine({ surfaces: ['postgame'], asOf: '2026-02-17', write: true, detectors: [rogue({ gameId: '2' })] }))
          .rejects.toThrow(/did not cover/);
        await expect(runEngine({ surfaces: ['postgame'], asOf: '2026-02-17', write: true, detectors: [rogue({ gameId: null })] }))
          .rejects.toThrow(/did not cover/);
        expect(await activeRows()).toEqual(before);
      }, TIMEOUT);

      it('a gameId run with a surface other than postgame', async () => {
        const { runEngine } = await import('./engine/run');
        const before = await activeRows();
        await expect(runEngine({ surfaces: ['season'], asOf: '2026-02-17', write: true, gameId: '1', detectors: [rogue({}, null, 'season')] }))
          .rejects.toThrow(/gameId runs cover the postgame surface only/);
        await expect(runEngine({ surfaces: ['postgame', 'season'], asOf: '2026-02-17', write: true, gameId: '1' }))
          .rejects.toThrow(/gameId runs cover the postgame surface only/);
        expect(await activeRows()).toEqual(before);
      }, TIMEOUT);
    });
  });
});
