// scripts/lib/insights/engine.integration.test.ts
// The v2 insight engine against a LOCAL Postgres seeded with the synthetic
// league (scripts/dev/seed-fixture-league.ts), with stats and the record book
// built. Skipped unless FIXTURE_DATABASE_URL is set. The database is WIPED.
//   FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55496/fixture npx vitest run scripts/lib/insights/engine.integration
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { addDays, laToday } from './engine/dates';
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

    it('postgame lines: a late joiner loses his own (subject) frames while league data is incomplete (FW-6)', async () => {
      const { loadLateJoiners } = await import('./engine/run');
      const { refsFor } = await import('./engine/references');
      const { runQuery } = await import('./engine/query');
      const { careerHigh, nthTime, subjectFirstSince, subjectSeasonHigh } = await import('./engine/questions');
      const base = await lastGameCtx();
      const [g] = await sql<{ date: string }[]>`SELECT game_date::text AS date FROM games WHERE game_id = ${base.gameId}::bigint`;
      await withLateJoiner(base, async () => {
        const fact = makeFact({
          kind: 'player_game_stat', surface: 'postgame', stat: 'pts', value: 1100,
          subject: { type: 'player', id: String(LATE_ID), name: 'Late Joiner' },
          window: { type: 'game', game_id: base.gameId!, season_id: base.season.id }, context: { date: g.date },
          gameId: base.gameId, seasonId: base.season.id, data: {},
        });
        const ctx = incomplete(base);
        await loadLateJoiners(fact, ctx, runQuery);
        expect(ctx.lateJoiners!.get(`${base.season.id}:${g.date}`)!.has(String(LATE_ID))).toBe(true);
        expect(refsFor(fact, ctx)!.subject).toBeNull();
        for (const q of [careerHigh, subjectFirstSince, subjectSeasonHigh, nthTime]) expect(q.build(fact, ctx), q.name).toBeNull();
        // positive controls: a Clipper since opening night keeps his own frames; with complete league data so does the late joiner
        const star = { ...fact, subject: { type: 'player' as const, id: '1', name: 'Star Clipper' }, value: 30 };
        await loadLateJoiners(star, ctx, runQuery);
        expect(refsFor(star, ctx)!.subject).not.toBeNull();
        expect(careerHigh.build(star, ctx)).not.toBeNull();
        expect(refsFor(fact, base)!.subject).not.toBeNull();
      });
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

  it('loadEngineContext: while the stats season lags the current one, a usable roster snapshot drops a departed player', async () => {
    const { loadEngineContext } = await import('./engine/context');
    const { currentSeasonId } = await import('../schedule-utils');
    const today = laToday();
    const base = await ctxAt(today);
    // the fixture's latest season is over: the stats season lags (the first games of a new season look the same)
    expect(base.season.id).toBeLessThan(currentSeasonId(new Date(`${today}T12:00:00Z`)));
    expect(base.league.complete).toBe(true);
    expect(base.roster.has('1') && base.roster.size > 1, 'a roster with players besides the star').toBe(true);
    const snapshot = (ids: string[]) => sql`
      INSERT INTO app_kv (key, value) VALUES ('roster:LAC',
        ${sql.json({ team: 'LAC', source: 'espn', synced_at: new Date().toISOString(), players: ids.map((id) => ({ player_id: id, name: `P${id}` })) })}::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
    const baseIds = [...base.roster.keys()].sort();
    expect(baseIds.length).toBeGreaterThanOrEqual(10);
    try {
      // only removes: eight players stay, the rest go, and the snapshot's newcomer is not added
      const kept = baseIds.slice(0, 8);
      await snapshot([...kept, '99999']);
      expect([...(await loadEngineContext({ asOf: today, withPrior: false }))!.roster.keys()].sort()).toEqual(kept);
      // a truncated sync (one player) is too small to trust: the box-score roster stands
      await snapshot([baseIds[0]]);
      expect([...(await loadEngineContext({ asOf: today, withPrior: false }))!.roster.keys()].sort()).toEqual(baseIds);
    } finally {
      await sql`DELETE FROM app_kv WHERE key = 'roster:LAC'`;
    }
  }, TIMEOUT);

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

    it('rest ignores a Clippers preseason game (all_games holds it) (FW-9)', async () => {
      const { matchupDetector } = await import('./engine/detectors/pregame-matchup');
      const ctx = await ctxAt(IN_SEASON);
      const next = await nextAt(IN_SEASON);
      let id: string | undefined;
      try {
        // A preseason game the night before would make a false Clippers back-to-back.
        [{ game_id: id }] = await sql<{ game_id: string }[]>`
          INSERT INTO all_games (nba_game_id, season_id, game_date, status, home_team_id, away_team_id, home_score, away_score, is_preseason)
          VALUES (10000001, 2025, ${IN_SEASON}::date, 'final', ${ctx.lac.teamId}::bigint, 5, 101, 99, TRUE)
          RETURNING game_id::text AS game_id`;
        const rest = (await matchupDetector().run(ctx)).facts.filter((f) => f.kind === 'rest');
        expect(rest.map((f) => f.stat)).not.toContain('lac_b2b');
        // positive control: the same game as a regular-season one is a back-to-back
        await sql`UPDATE all_games SET is_preseason = FALSE WHERE game_id = ${id}::bigint`;
        const counted = (await matchupDetector().run(ctx)).facts.filter((f) => f.kind === 'rest');
        expect(counted.map((f) => f.stat)).toContain('lac_b2b');
        expect(next.date).toBe('2026-01-11');
      } finally {
        if (id) await sql`DELETE FROM all_games WHERE game_id = ${id}::bigint`;
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
      const { matchupDetector, LINE_PROOF_SQL } = await import('./engine/detectors/pregame-matchup');
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
        expect(line!.proof.sql).toBe(LINE_PROOF_SQL);
        const proven = await proofRows(line!);
        expect(proven).toHaveLength(1);
        // FW-10: a sync-odds snapshot landing between Generate and Verify (same day, before tip) changes nothing
        await snap('2026-01-10T19:00:00-08:00', -6, 231);
        expect(await proofRows(line!)).toEqual(proven);
        expect((await matchupDetector().run(ctx)).facts.find((f) => f.kind === 'line')!.value).toBe(next.home ? -6 : 6);
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

    describe('vs opponent', () => {
      // Which opponent and min-games clear the floors depends on the fixture's schedule: scan the 2025-26 Clippers
      // games (the day before each) for the first preview with a qualifying fact under 5 games (so the default 5-game floor has something to filter).
      async function findPreview() {
        const { vsOpponentDetector } = await import('./engine/detectors/pregame-vs-opponent');
        const dates = await sql<{ d: string }[]>`
          SELECT (g.game_date - 1)::text AS d FROM games g
          WHERE g.season_id = 2025 AND ${sql.unsafe(REGULAR_SEASON)} AND 1 IN (g.home_team_id, g.away_team_id) AND g.game_date > '2025-12-15'
          ORDER BY g.game_date DESC`;
        for (const { d } of dates) {
          const ctx = await ctxAt(d);
          const { facts } = await vsOpponentDetector(3).run(ctx);
          if (facts.some((f) => f.data.games! < 5)) return { ctx, asOf: d, minGames: 3, facts };
        }
        throw new Error('no fixture preview has a vs-opponent fact under 5 games');
      }

      it('only gaps of 3+ PPG over enough games, inside the records, proven, on the next game\'s season', async () => {
        const { vsOpponentDetector, VS_OPPONENT_SQL } = await import('./engine/detectors/pregame-vs-opponent');
        const { ctx, asOf, minGames } = await findPreview();
        const next = await nextAt(asOf);
        const at3 = (await vsOpponentDetector(3).run(ctx)).facts;
        const at5 = (await vsOpponentDetector(5).run(ctx)).facts;
        const summary = (fs: typeof at3) => fs.map((f) => [f.subject.id, f.value, f.data.games, f.data.cur_value, f.data.prev_value]);
        // the default floor is the 3-game result narrowed to 5+ games
        expect(at3.some((f) => f.data.games! < 5), 'the floor-3 list holds a fact under 5 games').toBe(true);
        expect(summary(at5)).toEqual(summary(at3.filter((f) => f.data.games! >= 5)));
        expect(minGames).toBe(3);
        let total = 0;
        for (const floor of [5, 3]) {
          const { facts, gameIds } = await vsOpponentDetector(floor).run(ctx);
          expect(gameIds).toBeNull();
          for (const f of facts) {
            total += 1;
            expect(f).toMatchObject({
              kind: 'vs_opponent', surface: 'pregame', gameId: next.gameId, seasonId: next.seasonId,
              context: { opponent_id: next.opponentId }, window: { type: 'career', season_id: next.seasonId },
            });
            expect(f.data.games!).toBeGreaterThanOrEqual(floor);
            expect(Math.abs(f.data.cur_value! - f.data.prev_value!)).toBeGreaterThanOrEqual(3);
            expect(f.data.label).toBe('2024-25');
            expect(f.data.career).toBe(false); // first season is the records start: not a complete career
            expect(f.proof.sql).toBe(VS_OPPONENT_SQL);
            expect(f.proof.params).toContain(ctx.recordsStart!.season_id);
            expect(ctx.roster.has(f.subject.id)).toBe(true);
            const rows = await proofRows(f);
            expect(rows.length).toBe(1);
            expect(Number(rows[0].ppg)).toBeCloseTo(f.data.cur_value!, 6);
            expect(Number(rows[0].games)).toBe(f.data.games);
          }
        }
        expect(total, 'at least one vs-opponent fact').toBeGreaterThan(0);
      }, TIMEOUT);

      it('"career" only when the whole career is in the data; no records start, no facts', async () => {
        const { vsOpponentDetector } = await import('./engine/detectors/pregame-vs-opponent');
        const { ctx, minGames } = await findPreview();
        // a records start one season earlier: the fixture's players first appear after it
        const earlier = { ...ctx, recordsStart: { season_id: ctx.recordsStart!.season_id - 1, label: '2023-24' } };
        const { facts } = await vsOpponentDetector(minGames).run(earlier);
        expect(facts.length).toBeGreaterThan(0);
        for (const f of facts) expect(f.data).toMatchObject({ career: true, label: '2023-24' });
        expect((await vsOpponentDetector(minGames).run({ ...ctx, recordsStart: null })).facts).toEqual([]);
      }, TIMEOUT);

      it('buildDraft words every fact; none breaks the headline limit', async () => {
        const { vsOpponentDetector } = await import('./engine/detectors/pregame-vs-opponent');
        const { buildDraft } = await import('./engine/run');
        const { factKey } = await import('./engine/keys');
        const { ctx, minGames } = await findPreview();
        const { facts } = await vsOpponentDetector(minGames).run(ctx);
        expect(facts.length).toBeGreaterThan(0);
        let built = 0;
        for (const f of facts) {
          const draft = await buildDraft(f, factKey(f), 'pregame.vs_opponent', ctx);
          if ('reason' in draft) expect(['trivial'], `${f.subject.name}`).toContain(draft.reason);
          else {
            built += 1;
            expect(draft.headline.length).toBeLessThanOrEqual(90);
            expect(draft.category).toBe('vs_opponent');
            expect(draft.detail).toMatch(/regular-season games since 2024-25; [\d.]+ PPG overall/);
          }
        }
        expect(built, 'at least one vs-opponent fact survives scoring').toBeGreaterThan(0);
      }, TIMEOUT);
    });
  });

  describe('player surface', () => {
    const PROGRESS_AS_OF = '2026-01-19'; // Star Clipper: 992 season points after 46 games, 8 short of 1,000
    const incomplete = (ctx: EngineContext): EngineContext => ({ ...ctx, league: { complete: false, reason: 'test' } });
    /** Runs the proof query and returns the rows that match the fact's `match` (an unused bind makes Postgres error). */
    const proofRows = async (f: { proof: { sql: string; params: (string | number | boolean | null)[]; match: Record<string, string | number | boolean> } }) => {
      const rows = await sql.unsafe(f.proof.sql, f.proof.params as never[]);
      return rows.filter((r) => Object.entries(f.proof.match).every(([k, v]) => String(r[k]) === String(v)));
    };

    it('season highs stay off game pages; milestone progress only in season and within reach', async () => {
      const { seasonBestDetector, milestoneProgressDetector, SEASON_BEST_FLOORS } = await import('./engine/detectors/player-surface');
      const [g] = await sql<{ game_id: string }[]>`SELECT game_id::text FROM game_player_box_scores WHERE player_id = 1 AND points = 55`;
      const ctx = await ctxAt('2026-02-25');
      const bests = (await seasonBestDetector().run(ctx)).facts;
      expect(bests.length).toBeGreaterThan(0);
      expect(bests.find((f) => f.subject.id === '1' && f.stat === 'pts')).toMatchObject({
        kind: 'season_best', surface: 'player', value: 55, gameId: null, window: { game_id: g.game_id },
      });
      expect(bests.some((f) => f.subject.id === '3')).toBe(false);
      for (const f of bests) {
        expect(f.value).toBeGreaterThanOrEqual(SEASON_BEST_FLOORS[f.stat as keyof typeof SEASON_BEST_FLOORS]);
        expect(f.gameId).toBeNull();
        expect(await proofRows(f), `${f.subject.name} ${f.stat} proof`).toHaveLength(1);
      }
      const near = (await milestoneProgressDetector().run(await ctxAt(PROGRESS_AS_OF))).facts;
      expect(near.length).toBeGreaterThan(0);
      expect(near.find((f) => f.subject.id === '1' && f.stat === 'season_points')).toMatchObject({
        kind: 'milestone_progress', value: 1000, keyExtra: '1000',
        data: { threshold: 1000, total_value: 992, remaining: 8, games: 46, career: false },
      });
      for (const f of near) {
        expect(f.data.remaining!).toBeLessThanOrEqual(2 * f.data.per_game!);
        expect(f.data.career).toBe(false);
        expect(await proofRows(f), `${f.subject.name} ${f.stat} proof`).toHaveLength(1);
      }
      expect((await milestoneProgressDetector().run(await ctxAt(laToday()))).facts).toEqual([]);
    }, TIMEOUT);

    it('season highs: every bind is used; drafts build and read as season highs, or name the season once it is over', async () => {
      const { seasonBestDetector, seasonBestSql, progressSql } = await import('./engine/detectors/player-surface');
      for (const text of [seasonBestSql('points'), progressSql()]) for (const n of [1, 2, 3]) expect(text).toContain(`$${n}::`);
      const { buildDraft } = await import('./engine/run');
      const { factKey } = await import('./engine/keys');
      const ctx = await ctxAt('2026-02-25');
      const facts = (await seasonBestDetector().run(ctx)).facts;
      expect(facts.length).toBeGreaterThan(0);
      let built = 0;
      for (const f of facts) {
        const draft = await buildDraft(f, factKey(f), 'player.season_bests', ctx);
        if ('reason' in draft) { expect(['trivial', 'former'], `${f.subject.name} ${f.stat}`).toContain(draft.reason); continue; }
        built++;
        expect(draft.surface).toBe('player');
        expect(draft.game_id).toBeNull();
        expect(draft.headline).toMatch(/season high/);
        expect(draft.headline.length).toBeLessThanOrEqual(90);
      }
      expect(built, 'at least one season high survives scoring').toBeGreaterThan(0);
      // The stats season is not the current one: the headline names the season instead of claiming "season high".
      const done = await ctxAt(laToday());
      expect(done.season.isCurrent).toBe(false);
      const doneFacts = (await seasonBestDetector().run(done)).facts;
      expect(doneFacts.length).toBeGreaterThan(0);
      let named = 0;
      for (const f of doneFacts) {
        const draft = await buildDraft(f, factKey(f), 'player.season_bests', done);
        if ('reason' in draft) continue;
        named++;
        expect(draft.headline).toMatch(/2025-26 high/);
        expect(draft.headline).not.toMatch(/season high/);
      }
      expect(named, 'at least one completed-season high survives scoring').toBeGreaterThan(0);
    }, TIMEOUT);

    it('season high is the best game of the season for any team, with opponent, home and result read from his own side', async () => {
      const { seasonBestDetector } = await import('./engine/detectors/player-surface');
      const ctx = await ctxAt('2026-02-25');
      const starPts = async () => (await seasonBestDetector().run(ctx)).facts.find((f) => f.subject.id === '1' && f.stat === 'pts')!;
      expect((await starPts()).value).toBe(55);
      let gameId: string | null = null;
      try {
        // Star Clipper scored 60 earlier this season in a game for team 5 (home, a win over team 6).
        const [g] = await sql<{ game_id: string }[]>`
          INSERT INTO all_games (nba_game_id, season_id, game_date, status, home_team_id, away_team_id, home_score, away_score, is_playoffs)
          VALUES (43700001, 2025, '2025-12-02'::date, 'final', 5, 6, 120, 100, false) RETURNING game_id::text AS game_id`;
        gameId = g.game_id;
        await sql`
          INSERT INTO game_player_box_scores (game_id, team_id, player_id, minutes, points, rebounds, fg3_made, fg_made, fg_attempted)
          VALUES (${gameId}::bigint, 5, 1, '30:00', 60, 5, 2, 22, 30)`;
        const f = await starPts();
        expect(f).toMatchObject({ value: 60, window: { game_id: gameId }, context: { date: '2025-12-02', opponent_id: '6', home: true, result: 'W' } });
        expect(await proofRows(f)).toHaveLength(1);
        expect(f.data.for_lac).toBe(false);
        // a game for a previous team is compared with no Clippers references: no group frame, and no "Clipper" in the text
        const { buildDraft } = await import('./engine/run');
        const { factKey } = await import('./engine/keys');
        const draft = await buildDraft(f, factKey(f), 'player.season_bests', ctx);
        expect('reason' in draft, JSON.stringify(draft).slice(0, 80)).toBe(false);
        if (!('reason' in draft)) {
          expect(['records_best', 'first_since', 'joins_company', 'clippers_rank', 'only_one']).not.toContain(draft.frame.type);
          expect(draft.frame.who).not.toBe('group');
          expect(draft.detail).not.toMatch(/Clipper/);
        }
        // the same game from the other side: team 5 away, a loss
        await sql`UPDATE all_games SET home_team_id = 6, away_team_id = 5 WHERE game_id = ${gameId}::bigint`;
        expect((await starPts()).context).toMatchObject({ opponent_id: '6', home: false, result: 'L' });
      } finally {
        if (gameId) await sql`DELETE FROM all_games WHERE game_id = ${gameId}::bigint`;
      }
      expect((await starPts()).value).toBe(55);
    }, TIMEOUT);

    it('a tied season high belongs to the earliest game that reached it, and a later tie changes nothing', async () => {
      const { seasonBestDetector } = await import('./engine/detectors/player-surface');
      const ctx = await ctxAt('2026-02-25');
      const starPts = async () => (await seasonBestDetector().run(ctx)).facts.find((f) => f.subject.id === '1' && f.stat === 'pts')!;
      const original = await starPts();
      expect(original.value).toBe(55);
      const ids: string[] = [];
      const tie = async (nba: number, date: string) => {
        const [g] = await sql<{ game_id: string }[]>`
          INSERT INTO all_games (nba_game_id, season_id, game_date, status, home_team_id, away_team_id, home_score, away_score, is_playoffs)
          VALUES (${nba}, 2025, ${date}::date, 'final', 5, 6, 120, 100, false) RETURNING game_id::text AS game_id`;
        ids.push(g.game_id);
        await sql`
          INSERT INTO game_player_box_scores (game_id, team_id, player_id, minutes, points, rebounds, fg3_made, fg_made, fg_attempted)
          VALUES (${g.game_id}::bigint, 5, 1, '30:00', 55, 5, 2, 22, 30)`;
        return g.game_id;
      };
      try {
        const [orig] = await sql<{ d: string }[]>`SELECT g.game_date::text AS d FROM games g WHERE g.game_id = ${original.window.game_id!}::bigint`;
        expect(orig.d > '2025-10-30' && orig.d < '2026-02-10').toBe(true);
        await tie(43700011, '2026-02-12'); // a later tie: no change
        expect((await starPts()).window.game_id).toBe(original.window.game_id);
        const early = await tie(43700012, '2025-10-30'); // an earlier tie takes over: that game set the mark
        expect((await starPts()).window.game_id).toBe(early);
      } finally {
        if (ids.length) await sql`DELETE FROM all_games WHERE game_id = ANY(${ids}::bigint[])`;
      }
      expect((await starPts()).window.game_id).toBe(original.window.game_id);
    }, TIMEOUT);

    it('season highs: a late joiner is skipped while league data is incomplete', async () => {
      const { seasonBestDetector } = await import('./engine/detectors/player-surface');
      const ctx = await ctxAt('2026-02-25');
      const [last] = await sql<{ game_id: string }[]>`
        SELECT g.game_id::text AS game_id FROM games g
        WHERE ${ctx.lac.teamId}::bigint IN (g.home_team_id, g.away_team_id) AND g.season_id = ${ctx.season.id}
          AND ${sql.unsafe(REGULAR_SEASON)} AND g.game_date <= ${ctx.asOf}::date
          AND EXISTS (SELECT 1 FROM game_player_box_scores b WHERE b.game_id = g.game_id AND b.team_id = ${ctx.lac.teamId}::bigint)
        ORDER BY g.game_date DESC, g.game_id DESC LIMIT 1`;
      try {
        await sql`
          INSERT INTO players (player_id, nba_player_id, nba_person_id, first_name, last_name, display_name)
          VALUES (9111, 9111, 1009111, 'Late', 'Star', 'Late Star')`;
        await sql`
          INSERT INTO game_player_box_scores (game_id, team_id, player_id, minutes, points, rebounds, fg3_made, fg_made, fg_attempted)
          VALUES (${last.game_id}::bigint, ${ctx.lac.teamId}::bigint, 9111, '30:00', 40, 5, 2, 15, 25)`;
        const full = (await seasonBestDetector().run(ctx)).facts;
        expect(full.some((f) => f.subject.id === '9111' && f.value === 40)).toBe(true);
        const guarded = (await seasonBestDetector().run(incomplete(ctx))).facts;
        expect(guarded.some((f) => f.subject.id === '9111')).toBe(false);
        expect(guarded.some((f) => f.subject.id === '1' && f.stat === 'pts')).toBe(true);
      } finally {
        await sql`DELETE FROM game_player_box_scores WHERE player_id = 9111`;
        await sql`DELETE FROM players WHERE player_id = 9111`;
      }
    }, TIMEOUT);

    it('milestone watch ends with the Clippers\' last regular-season game', async () => {
      const { milestoneProgressDetector } = await import('./engine/detectors/player-surface');
      const dates = await sql<{ d: string }[]>`
        SELECT DISTINCT g.game_date::text AS d FROM games g
        WHERE 1 IN (g.home_team_id, g.away_team_id) AND g.season_id = 2025 AND ${sql.unsafe(REGULAR_SEASON)} ORDER BY 1 DESC LIMIT 2`;
      const [lastDay, dayBefore] = [dates[0].d, dates[1].d];
      const ctx = await ctxAt(dayBefore);
      const first5 = await sql<{ game_id: string }[]>`
        SELECT g.game_id::text AS game_id FROM games g
        WHERE 1 IN (g.home_team_id, g.away_team_id) AND g.season_id = 2025 AND ${sql.unsafe(REGULAR_SEASON)} ORDER BY g.game_date, g.game_id LIMIT 5`;
      try {
        await sql`
          INSERT INTO players (player_id, nba_player_id, nba_person_id, first_name, last_name, display_name)
          VALUES (9121, 9121, 1009121, 'Watch', 'Man', 'Watch Man')`;
        for (const g of first5) {
          await sql`
            INSERT INTO game_player_box_scores (game_id, team_id, player_id, minutes, points, rebounds, fg3_made, fg_made, fg_attempted)
            VALUES (${g.game_id}::bigint, 1, 9121, '30:00', 2400, 5, 2, 900, 1600)`;
        }
        const during = (await milestoneProgressDetector().run(ctx)).facts;
        expect(during.some((f) => f.subject.id === '9121' && f.stat === 'career_points'), 'a game is still to come').toBe(true);
        expect((await milestoneProgressDetector().run(await ctxAt(lastDay))).facts, 'no regular-season game left').toEqual([]);
        expect((await milestoneProgressDetector().run(await ctxAt('2026-02-25'))).facts).toEqual([]);
      } finally {
        await sql`DELETE FROM game_player_box_scores WHERE player_id = 9121`;
        await sql`DELETE FROM players WHERE player_id = 9121`;
      }
    }, TIMEOUT);

    it('milestone progress: career thresholds only for complete careers; a late joiner is skipped while league data is incomplete', async () => {
      const { milestoneProgressDetector } = await import('./engine/detectors/player-surface');
      const asOf = '2026-02-08'; // Star Clipper: 1,227 season points after 56 games, 23 short of 1,250
      const ctx = await ctxAt(asOf);
      const lacGames = await sql<{ game_id: string }[]>`
        SELECT g.game_id::text AS game_id FROM games g
        WHERE ${ctx.lac.teamId}::bigint IN (g.home_team_id, g.away_team_id) AND g.season_id = ${ctx.season.id}
          AND ${sql.unsafe(REGULAR_SEASON)} AND g.game_date <= ${asOf}::date
          AND EXISTS (SELECT 1 FROM game_player_box_scores b WHERE b.game_id = g.game_id AND b.team_id = ${ctx.lac.teamId}::bigint)
        ORDER BY g.game_date, g.game_id`;
      const first5 = lacGames.slice(0, 5);
      const last5 = lacGames.slice(-5);
      const [oldGame] = await sql<{ game_id: string }[]>`
        SELECT g.game_id::text AS game_id FROM games g WHERE g.season_id = 2024 AND ${sql.unsafe(REGULAR_SEASON)}
          AND ${ctx.lac.teamId}::bigint IN (g.home_team_id, g.away_team_id) ORDER BY g.game_date LIMIT 1`;
      // 9101 joins late (first LAC game after the Clippers' first); 9102 is there from the start and his career begins this season;
      // 9103 is as 9102 but also played in 2024-25, the first season of records, so his career is not wholly in the data.
      const rows: [number, string][] = [
        ...last5.map((g) => [9101, g.game_id] as [number, string]),
        ...first5.map((g) => [9102, g.game_id] as [number, string]),
        ...first5.map((g) => [9103, g.game_id] as [number, string]),
        [9103, oldGame.game_id],
      ];
      try {
        for (const id of [9101, 9102, 9103]) {
          await sql`
            INSERT INTO players (player_id, nba_player_id, nba_person_id, first_name, last_name, display_name)
            VALUES (${id}, ${id}, ${1_000_000 + id}, 'Test', ${'P' + id}, ${'Test P' + id})`;
        }
        // 2,400 points a game: 12,000 career points after five games, 3,000 short of 15,000 and within two games' reach
        for (const [id, gameId] of rows) {
          await sql`
            INSERT INTO game_player_box_scores (game_id, team_id, player_id, minutes, points, rebounds, fg3_made, fg_made, fg_attempted)
            VALUES (${gameId}::bigint, ${ctx.lac.teamId}::bigint, ${id}, '30:00', 2400, 5, 2, 900, 1600)`;
        }
        const career = (facts: { subject: { id: string }; stat: string }[], id: number) =>
          facts.filter((f) => f.subject.id === String(id) && f.stat === 'career_points');
        const full = (await milestoneProgressDetector().run(ctx)).facts;
        expect(career(full, 9101)[0]).toMatchObject({ value: 15000, data: { career: true, total_value: 12000, remaining: 3000 } });
        expect(career(full, 9102)).toHaveLength(1);
        expect(career(full, 9103), 'a career that began in the first season of records is not complete').toEqual([]);
        // incomplete league data: the late joiner is skipped; the others, and Star Clipper's season progress, survive
        const guarded = (await milestoneProgressDetector().run(incomplete(ctx))).facts;
        expect(guarded.some((f) => f.subject.id === '9101')).toBe(false);
        expect(career(guarded, 9102)).toHaveLength(1);
        expect(guarded.find((f) => f.subject.id === '1' && f.stat === 'season_points')).toMatchObject({ value: 1250, data: { remaining: 23 } });
      } finally {
        await sql`DELETE FROM game_player_box_scores WHERE player_id IN (9101, 9102, 9103)`;
        await sql`DELETE FROM players WHERE player_id IN (9101, 9102, 9103)`;
      }
    }, TIMEOUT);

    it('once the Clippers have a playoff game: no team streak, closed player streaks, no present-tense headlines', async () => {
      const { streakDetector } = await import('./engine/detectors/season-streaks');
      const { buildDraft } = await import('./engine/run');
      const { factKey } = await import('./engine/keys');
      const asOf = '2026-02-25';
      const before = await ctxAt(asOf);
      for (const surface of ['season', 'player'] as const) {
        const facts = (await streakDetector(surface).run(before)).facts;
        expect(facts.some((f) => f.subject.type === 'player'), `${surface} has player streaks`).toBe(true);
        expect(facts.every((f) => f.data.closed === undefined)).toBe(true);
      }
      expect((await streakDetector('season').run(before)).facts.some((f) => f.subject.type === 'team'), 'a team streak before the playoffs').toBe(true);
      let gameId: string | null = null;
      try {
        const [g] = await sql<{ game_id: string }[]>`
          INSERT INTO all_games (nba_game_id, season_id, game_date, status, home_team_id, away_team_id, home_score, away_score, is_playoffs)
          VALUES (43700002, ${before.season.id}, ${asOf}::date, 'final', ${before.lac.teamId}::bigint, 7, 100, 90, true) RETURNING game_id::text AS game_id`;
        gameId = g.game_id;
        const ctx = await ctxAt(asOf);
        expect(ctx.season.isCurrent).toBe(true);
        for (const surface of ['season', 'player'] as const) {
          const facts = (await streakDetector(surface).run(ctx)).facts;
          expect(facts.length, `${surface} keeps player streaks`).toBeGreaterThan(0);
          expect(facts.some((f) => f.subject.type === 'team')).toBe(false);
          expect(facts.every((f) => f.data.closed === true)).toBe(true);
          let built = 0;
          for (const f of facts) {
            const draft = await buildDraft(f, factKey(f), `${surface}.streaks`, ctx);
            if ('reason' in draft) continue;
            built++;
            expect(draft.headline).toMatch(/ (closed|ended) the regular season /);
            expect(draft.headline).not.toMatch(/\b(has|have|is|are)\b/);
          }
          expect(built, `${surface} streaks built`).toBeGreaterThan(0);
        }
        // a play-in game (stored as a non-playoff game) does not close the regular season: only playoff games do
        await sql`UPDATE all_games SET is_playoffs = false WHERE game_id = ${gameId}::bigint`;
        const playIn = await streakDetector('season').run(await ctxAt(asOf));
        expect(playIn.facts.some((f) => f.data.closed === true)).toBe(false);
      } finally {
        if (gameId) await sql`DELETE FROM all_games WHERE game_id = ${gameId}::bigint`;
      }
      const { LAC_PLAYOFFS_SQL } = await import('./engine/detectors/season-ranks');
      const [r] = await sql.unsafe(LAC_PLAYOFFS_SQL, [before.season.id, before.lac.teamId, asOf]);
      expect(r.playoffs).toBe(false);
    }, TIMEOUT);
  });

  describe('runner hooks', () => {
    // The hooks read today's LA date; pin it so the fixture's season is "now".
    const at = (iso: string) => vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${iso}T20:00:00Z`) });
    afterEach(() => vi.useRealTimers());

    it('postgame at the final writes that game only; pregame at start writes the next game', async () => {
      const { postgameAtFinal, pregameAtStart } = await import('./engine/hooks');
      const { nextClippersGame } = await import('./engine/games');
      // Leave the shared table as found: later tests assert which surfaces are active.
      const before = await sql<{ proof_hash: string; is_active: boolean }[]>`SELECT proof_hash, is_active FROM insights`;
      try {
        const [g] = await sql<{ game_id: string; d: string }[]>`
          SELECT pb.game_id::text, gm.game_date::text AS d FROM game_player_box_scores pb JOIN games gm ON gm.game_id = pb.game_id
          WHERE pb.player_id = 1 AND pb.points = 55`;
        const postgameOutside = async () => (await sql<{ n: number }[]>`
          SELECT COUNT(*)::int AS n FROM insights WHERE is_active AND surface = 'postgame' AND game_id <> ${g.game_id}::bigint`)[0].n;
        const otherBefore = await postgameOutside();

        at(g.d);
        const post = await postgameAtFinal(g.game_id);
        expect(post.status).toBe('ok');
        expect(post.upserted).toBeGreaterThan(0);
        expect(post.message).toBe(`${post.upserted} postgame insights for game ${g.game_id}`);
        const rows = await sql<{ game_id: string }[]>`SELECT DISTINCT game_id::text FROM insights WHERE is_active AND surface = 'postgame' AND game_id = ${g.game_id}::bigint`;
        expect(rows).toHaveLength(1);
        expect(await postgameOutside()).toBe(otherBefore);

        at('2026-01-10');
        const pre = await pregameAtStart();
        expect(pre.status).toBe('ok');
        expect(pre.upserted).toBeGreaterThan(0);
        const next = await nextClippersGame(await ctxAt('2026-01-10'));
        const pregame = await sql<{ game_id: string }[]>`SELECT DISTINCT game_id::text FROM insights WHERE is_active AND surface = 'pregame'`;
        expect(pregame.map((r) => r.game_id)).toEqual([next!.gameId]);
        expect(run('scripts/verify-insights.ts')).toMatch(/\b0 failed\b/);
      } finally {
        const had = before.map((r) => r.proof_hash);
        await sql`DELETE FROM insights WHERE proof_hash <> ALL(${had}::text[])`;
        await sql`UPDATE insights SET is_active = (proof_hash = ANY(${before.filter((r) => r.is_active).map((r) => r.proof_hash)}::text[])) WHERE proof_hash IS NOT NULL`;
      }
    }, TIMEOUT);
  });

  it('first_since (Q1): every dated first_since counts exactly the games strictly between, and at least MIN_FIRST_SINCE_GAMES', async () => {
    const { runEngine } = await import('./engine/run');
    const { MIN_FIRST_SINCE_GAMES } = await import('../../../src/lib/insights/quality');
    const r = await runEngine({ surfaces: ['postgame'], asOf: '2025-02-17', write: false, postgameDays: 120 });
    const firsts = r.drafts.filter((d) => d.frame.type === 'first_since' && d.frame.since_date);
    expect(firsts.length).toBeGreaterThan(0);
    const dates = new Map((await sql<{ game_id: string; d: string }[]>`
      SELECT game_id::text, game_date::text AS d FROM games WHERE game_id = ANY(${firsts.map((d) => d.game_id!)}::bigint[])`).map((g) => [g.game_id, g.d]));
    for (const d of firsts) {
      const date = dates.get(d.game_id!);
      const label = `${d.headline} | ${d.detail}`;
      expect(date, label).toBeDefined();
      // An independent recount (Q1 ruling 1): his regular-season games for a subject frame, Clippers regular-season games for a group frame.
      const [{ n }] = d.frame.who === 'subject'
        ? await sql<{ n: number }[]>`
            SELECT COUNT(DISTINCT g.game_id)::int AS n FROM game_player_box_scores pb JOIN games g ON g.game_id = pb.game_id
            WHERE pb.player_id = ${d.player_id!}::bigint AND ${sql.unsafe(REGULAR_SEASON)}
              AND g.game_date > ${d.frame.since_date!}::date AND g.game_date < ${date!}::date`
        : await sql<{ n: number }[]>`
            SELECT COUNT(*)::int AS n FROM games g
            WHERE ${d.team_id}::bigint IN (g.home_team_id, g.away_team_id) AND ${sql.unsafe(REGULAR_SEASON)} AND g.status = 'final'
              AND g.game_date > ${d.frame.since_date!}::date AND g.game_date < ${date!}::date`;
      expect(d.frame.games_since, label).toBe(n);
      const frameRow = (d.proof_result as { part: string; data: Record<string, unknown> }[]).find((p) => p.part === 'frame');
      expect(Number(frameRow?.data.games_since), label).toBe(n);
      expect(n, label).toBeGreaterThanOrEqual(MIN_FIRST_SINCE_GAMES);
    }
  }, TIMEOUT);

  describe('group season highs (Q2)', () => {
    /** An independent recount: Clippers regular-season final games in `season` through `date`, that game included. */
    const clippersGamesThrough = async (teamId: string, season: number, date: string) => (await sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM games g
      WHERE ${teamId}::bigint IN (g.home_team_id, g.away_team_id) AND ${sql.unsafe(REGULAR_SEASON)} AND g.status = 'final'
        AND g.season_id = ${season}::int AND g.game_date <= ${date}::date`)[0].n;
    const parts = (d: InsightDraft) => d.proof_result as { part: string; data: Record<string, unknown> }[];

    it('every group season_high the engine writes counts the team game exactly, and is game #MIN_SEASON_HIGH_TEAM_GAMES or later', async () => {
      const { runEngine } = await import('./engine/run');
      const { MIN_SEASON_HIGH_TEAM_GAMES } = await import('../../../src/lib/insights/quality');
      const drafts: InsightDraft[] = [];
      for (const asOf of ['2025-02-17', '2026-02-25']) {
        const r = await runEngine({ surfaces: ['postgame', 'season', 'player'], asOf, write: false, postgameDays: 120 });
        drafts.push(...r.drafts.filter((d) => d.frame.type === 'season_high' && d.frame.who === 'group'));
      }
      expect(drafts.length).toBeGreaterThan(0);
      for (const d of drafts) {
        const label = `${d.category} | ${d.headline} | ${d.detail}`;
        // The fact's date: its game's date, or a streak's end (ruling 3).
        const fact = parts(d).find((p) => p.part === 'fact')!.data;
        const date = d.game_id
          ? (await sql<{ d: string }[]>`SELECT game_date::text AS d FROM games WHERE game_id = ${d.game_id}::bigint`)[0].d
          : String(fact.streak_end);
        expect(date, label).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const n = await clippersGamesThrough(d.team_id, d.season_id!, date);
        const frameRow = parts(d).find((p) => p.part === 'frame');
        expect(Number(frameRow?.data.team_games), label).toBe(n);
        expect(n, label).toBeGreaterThanOrEqual(MIN_SEASON_HIGH_TEAM_GAMES);
      }
    }, TIMEOUT);

    it('a Clipper season high is a group frame from the Clippers\' game #20 on, not before; team_games is exact', async () => {
      const { groupSeasonHigh } = await import('./engine/questions');
      const { runQuery } = await import('./engine/query');
      const { MIN_SEASON_HIGH_TEAM_GAMES } = await import('../../../src/lib/insights/quality');
      const ctx = await ctxAt('2026-02-25');
      const games = await sql<{ game_id: string; d: string }[]>`
        SELECT g.game_id::text, g.game_date::text AS d FROM games g
        WHERE ${ctx.lac.teamId}::bigint IN (g.home_team_id, g.away_team_id) AND ${sql.unsafe(REGULAR_SEASON)} AND g.status = 'final'
          AND g.season_id = ${ctx.season.id}::int
        ORDER BY g.game_date`;
      expect(games.length).toBeGreaterThanOrEqual(MIN_SEASON_HIGH_TEAM_GAMES);
      // A 99-point night beats every Clipper so far: only the team game number decides the frame.
      for (const nth of [MIN_SEASON_HIGH_TEAM_GAMES - 1, MIN_SEASON_HIGH_TEAM_GAMES]) {
        const g = games[nth - 1];
        const fact = makeFact({ ...pointsFact(ctx, g.game_id, g.d), value: 99 });
        const rows = await runQuery(groupSeasonHigh.build(fact, ctx)!);
        expect(Number(rows[0].team_games), `game #${nth}`).toBe(await clippersGamesThrough(ctx.lac.teamId, ctx.season.id, g.d));
        expect(Number(rows[0].team_games), `game #${nth}`).toBe(nth);
        const framed = groupSeasonHigh.interpret(rows, fact, ctx);
        if (nth < MIN_SEASON_HIGH_TEAM_GAMES) expect(framed, `game #${nth}`).toBeNull();
        else expect(framed, `game #${nth}`).toMatchObject({ type: 'season_high', who: 'group' });
      }
    }, TIMEOUT);

    it('streak season highs count the Clippers\' games through the streak end exactly (ruling 3)', async () => {
      const { streakSeasonHigh } = await import('./engine/questions');
      const { streakDetector } = await import('./engine/detectors/season-streaks');
      const { runQuery } = await import('./engine/query');
      const { MIN_SEASON_HIGH_TEAM_GAMES } = await import('../../../src/lib/insights/quality');
      const ctx = await ctxAt('2026-02-25');
      const { facts } = await streakDetector('season').run(ctx);
      let built = 0;
      for (const f of facts) {
        const q = streakSeasonHigh.build(f, ctx);
        if (!q) continue;
        built++;
        const rows = await runQuery(q);
        const n = await clippersGamesThrough(ctx.lac.teamId, f.seasonId!, f.data.end_date!);
        expect(Number(rows[0].team_games), `${f.subject.name} ${f.stat}`).toBe(n);
        // The same streak ending before the Clippers' game #20 would be no frame.
        expect(streakSeasonHigh.interpret([{ ...rows[0], team_games: MIN_SEASON_HIGH_TEAM_GAMES - 1 }], f, ctx)).toBeNull();
      }
      expect(built).toBeGreaterThan(0);
    }, TIMEOUT);
  });

  describe('quality context (Q1/Q2: engine and loader agree)', () => {
    it('the loader\'s games_since and team_game_number equal the engine\'s counts for the same fact', async () => {
      const { QUALITY_CONTEXT_SQL, qualityContextParams } = await import('../../../src/lib/insights/quality-context-sql');
      const { subjectFirstSince, groupFirstSince, groupSeasonHigh } = await import('./engine/questions');
      const { runQuery } = await import('./engine/query');
      const ctx = await ctxAt(laToday());
      const [{ nba_team_id: lacNba }] = await sql<{ nba_team_id: number }[]>`SELECT nba_team_id::int FROM teams WHERE abbreviation = 'LAC'`;
      // The 55-point game, and his first 25+ night of 2025-26, whose previous 25+ night is in 2024-25 (a count across seasons).
      // 25, not 30: the 55 is his first 30+ game in the fixture, so a 30 has no previous occurrence to count from.
      const games = await sql<{ game_id: string; d: string }[]>`
        SELECT pb.game_id::text, g.game_date::text AS d FROM game_player_box_scores pb JOIN games g ON g.game_id = pb.game_id
        WHERE pb.player_id = 1 AND g.season_id = 2025 AND (pb.points = 55 OR g.game_date = (
          SELECT MIN(g2.game_date) FROM game_player_box_scores p2 JOIN games g2 ON g2.game_id = p2.game_id
          WHERE p2.player_id = 1 AND g2.season_id = 2025 AND p2.points >= 25))
        ORDER BY g.game_date`;
      expect(games).toHaveLength(2);
      const subjectCounts: number[] = [];
      for (const g of games) {
        const label = `game ${g.game_id} on ${g.d}`;
        const fact = makeFact({
          kind: 'player_game_stat', surface: 'postgame', stat: 'pts', value: 25,
          window: { type: 'game', game_id: g.game_id, season_id: 2025 }, context: { date: g.d }, gameId: g.game_id, seasonId: 2025,
        });
        const loaderCounts = async (need: { since_date: string | null; at_date: string | null; player_id?: string | null }) => {
          const rows = await sql.unsafe(QUALITY_CONTEXT_SQL, qualityContextParams([{
            insight_id: 'x', player_id: '1', until_date: g.d, season_id: 2025, ...need,
          }], lacNba) as never);
          expect(rows, label).toHaveLength(1);
          return rows[0] as unknown as { insight_id: string; games_since: number | null; team_game_number: number | null };
        };

        // Q1, subject frame: his regular-season games (any team) strictly between the previous 25+ night and this one.
        const [prev] = await runQuery(subjectFirstSince.build(fact, ctx)!);
        expect(prev, `${label}: an earlier 25-point game`).toBeDefined();
        const sinceRow = await loaderCounts({ since_date: String(prev.game_date), at_date: g.d });
        expect(sinceRow.insight_id).toBe('x');
        expect(typeof prev.games_since, label).toBe('number');
        expect(sinceRow.games_since, label).toBe(prev.games_since);
        subjectCounts.push(Number(prev.games_since));

        // Q1, group frame: the Clippers' regular-season games strictly between the previous Clipper 25+ night and this one.
        const [groupPrev] = await runQuery(groupFirstSince.build(fact, ctx)!);
        expect(groupPrev, `${label}: an earlier Clipper 25-point game`).toBeDefined();
        const groupRow = await loaderCounts({ since_date: String(groupPrev.game_date), at_date: null, player_id: null });
        expect(typeof groupPrev.games_since, label).toBe('number');
        expect(groupRow, label).toMatchObject({ games_since: groupPrev.games_since, team_game_number: null });

        // Q2: the Clippers' regular-season games this season through the fact's date, its own game included.
        const [high] = await runQuery(groupSeasonHigh.build(fact, ctx)!);
        expect(Number(high.team_games), label).toBeGreaterThan(0);
        expect(sinceRow.team_game_number, label).toBe(Number(high.team_games));

        // A need without its dates yields no count (the bar then fails closed).
        expect(await loaderCounts({ since_date: null, at_date: null })).toMatchObject({ games_since: null, team_game_number: null });
      }
      // Not a vacuous 0 = 0: the cross-season count spans many games.
      expect(Math.max(...subjectCounts)).toBeGreaterThan(10);
    }, TIMEOUT);
  });

  describe('buzzer pregame pass (FF-2)', () => {
    const REASON = 'buzzer: league sync pending';
    const AS_OF = '2026-02-10';
    const LEAGUE = ['opp_rank', 'opp_form', 'opp_hot_player'];
    const leagueFree = (r: import('./engine/run').EngineResult) =>
      r.drafts.filter((d) => ['h2h', 'last_meeting', 'vs_opponent', 'line'].includes(d.category)).map((d) => d.headline).sort();

    it('the flag forces league data incomplete; league-dependent pregame detectors emit nothing, the rest still run', async () => {
      const { loadEngineContext } = await import('./engine/context');
      const { runEngine } = await import('./engine/run');
      expect((await ctxAt(AS_OF)).league.complete).toBe(true);
      expect((await loadEngineContext({ asOf: AS_OF, withPrior: false, leagueIncomplete: REASON }))!.league).toEqual({ complete: false, reason: REASON });

      const full = await runEngine({ surfaces: ['pregame'], asOf: AS_OF, write: false });
      expect(full.drafts.some((d) => LEAGUE.includes(d.category))).toBe(true);
      const logs: string[] = [];
      const buzzer = await runEngine({ surfaces: ['pregame'], asOf: AS_OF, write: false, leagueIncomplete: REASON, log: (m) => logs.push(m) });
      // A forced incomplete is expected at every buzzer: a plain log line, never a ::warning annotation (fix round a).
      expect(logs.some((m) => m.includes(REASON))).toBe(true);
      expect(logs.filter((m) => m.startsWith('::warning'))).toEqual([]);
      expect(buzzer.context!.league).toEqual({ complete: false, reason: REASON });
      expect(buzzer.drafts.filter((d) => LEAGUE.includes(d.category)).map((d) => d.headline)).toEqual([]);
      expect(leagueFree(full).length).toBeGreaterThan(0);
      expect(leagueFree(buzzer)).toEqual(leagueFree(full));
    }, TIMEOUT);

    it('a buzzer write deactivates the stale league-dependent rows through the scoped sweep and keeps the rest', async () => {
      const { runEngine } = await import('./engine/run');
      const before = await sql<{ proof_hash: string; is_active: boolean }[]>`SELECT proof_hash, is_active FROM insights`;
      const active = async () => (await sql<{ category: string }[]>`
        SELECT category FROM insights WHERE is_active AND surface = 'pregame'`).map((r) => r.category);
      try {
        await runEngine({ surfaces: ['pregame'], asOf: AS_OF, write: true });
        expect((await active()).some((c) => LEAGUE.includes(c))).toBe(true);
        const r = await runEngine({ surfaces: ['pregame'], asOf: AS_OF, write: true, leagueIncomplete: REASON });
        expect(r.deactivated).toBeGreaterThan(0);
        const after = await active();
        expect(after.filter((c) => LEAGUE.includes(c))).toEqual([]);
        expect(after).toEqual(expect.arrayContaining(['h2h', 'last_meeting']));
      } finally {
        const had = before.map((x) => x.proof_hash);
        await sql`DELETE FROM insights WHERE proof_hash <> ALL(${had}::text[])`;
        await sql`UPDATE insights SET is_active = (proof_hash = ANY(${before.filter((x) => x.is_active).map((x) => x.proof_hash)}::text[])) WHERE proof_hash IS NOT NULL`;
      }
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

    it('tied ranks (FF-1): data.tied counts the other teams/players on the same value, and the headline says "tied for" exactly then', async () => {
      const { leagueRankDetector, standingsDetector } = await import('./engine/detectors/season-ranks');
      const { buildDraft } = await import('./engine/run');
      const { factKey } = await import('./engine/keys');
      // The standings context line states the league-wide rank, so it follows league_tied.
      const wordsTie = async (f: import('./engine/types').Fact, ctx: EngineContext, detailTied = f.data.tied!) => {
        const d = await buildDraft(f, factKey(f), 'test', ctx);
        expect('reason' in d, f.stat).toBe(false);
        const draft = d as InsightDraft;
        expect(/tied for/.test(draft.headline), draft.headline).toBe(f.data.tied! > 0);
        expect(/tied for/i.test(draft.detail), draft.detail).toBe(detailTied > 0);
        return draft;
      };

      // Standings on 2025-11-08: the Clippers are 8-2 and share 1st in the West.
      const early = await ctxAt('2025-11-08');
      const [st] = (await standingsDetector().run(early)).facts;
      const [direct] = await sql<{ conf_tied: number; league_tied: number }[]>`
        WITH results AS (
          SELECT home_team_id AS team_id, (home_score > away_score) AS won FROM games g
          WHERE season_id = 2025 AND ${sql.unsafe(REGULAR_SEASON)} AND game_date <= '2025-11-08' AND status = 'final'
          UNION ALL
          SELECT away_team_id, (away_score > home_score) FROM games g
          WHERE season_id = 2025 AND ${sql.unsafe(REGULAR_SEASON)} AND game_date <= '2025-11-08' AND status = 'final'
        ), rec AS (
          SELECT r.team_id, t.conference, COUNT(*) FILTER (WHERE won) AS w, COUNT(*) AS n
          FROM results r JOIN teams t ON t.team_id = r.team_id GROUP BY r.team_id, t.conference
        ), lac AS (SELECT * FROM rec WHERE team_id = 1)
        SELECT (SELECT COUNT(*) FROM rec WHERE rec.team_id <> 1 AND rec.conference = lac.conference AND rec.w * lac.n = lac.w * rec.n)::int AS conf_tied,
               (SELECT COUNT(*) FROM rec WHERE rec.team_id <> 1 AND rec.w * lac.n = lac.w * rec.n)::int AS league_tied
        FROM lac`;
      expect(st.data).toMatchObject({ rank: 1, wins: 8, losses: 2 });
      expect(direct.conf_tied).toBeGreaterThan(0);
      expect(st.data.tied).toBe(direct.conf_tied);
      expect(st.data.league_tied).toBe(direct.league_tied);
      const sd = await wordsTie(st, early, st.data.league_tied!);
      expect(sd.headline).toMatch(/tied for 1st in the West$/);
      expect(sd.evidence).toMatchObject({ type: 'rank_track', rank: 1, tied: direct.conf_tied });

      // League ranks: every rank carries its own exact tie count.
      const ctx = await ctxAt(laToday());
      const facts = (await leagueRankDetector('season', { teams: true }).run(ctx)).facts;
      expect(facts.length).toBeGreaterThan(0);
      for (const f of facts) {
        const metric = f.stat.replace(/^(team|player)_/, '');
        const m = f.subject.type === 'team'
          ? (await import('./engine/detectors/metrics')).TEAM_METRICS.find((x) => x.key === metric)!
          : (await import('./engine/detectors/metrics')).PLAYER_METRICS.find((x) => x.key === metric)!;
        const rows = f.subject.type === 'team'
          ? await sql.unsafe(`
              WITH v AS (
                SELECT a.team_id, ROUND((${(m as { aggregate: string }).aggregate})::numeric, 6)::float8 AS value
                FROM advanced_team_game_stats a JOIN games g ON g.game_id = a.game_id
                WHERE g.season_id = $1::int AND ${REGULAR_SEASON} AND g.game_date <= $2::date
                GROUP BY a.team_id HAVING COUNT(*) >= 5)
              SELECT (COUNT(*) FILTER (WHERE value = (SELECT value FROM v WHERE team_id = $3::bigint)) - 1)::int AS tied FROM v`,
            [ctx.season.id, ctx.asOf, ctx.lac.teamId] as never[])
          : await sql.unsafe(`
              WITH v AS (
                SELECT pb.player_id, ROUND((${(m as { expr: string }).expr})::numeric, 6)::float8 AS value
                FROM game_player_box_scores pb JOIN games g ON g.game_id = pb.game_id
                WHERE g.season_id = $1::int AND ${REGULAR_SEASON} AND g.game_date <= $2::date
                GROUP BY pb.player_id HAVING COUNT(*) >= $3::int)
              SELECT (COUNT(*) FILTER (WHERE value = (SELECT value FROM v WHERE player_id = $4::bigint)) - 1)::int AS tied FROM v`,
            [ctx.season.id, ctx.asOf, ctx.minPlayerGames, f.subject.id] as never[]);
        expect(f.data.tied, `${f.subject.name} ${f.stat}`).toBe(Number(rows[0].tied));
        await wordsTie(f, ctx);
      }
      // The fixture's tied case: LAC Player 10 shares 8th in steals + blocks (the completed season reads in the past).
      const shared = facts.find((f) => f.subject.name === 'LAC Player 10' && f.stat === 'player_stocks');
      expect(shared?.data).toMatchObject({ rank: 8 });
      expect(shared!.data.tied).toBeGreaterThan(0);
      expect((await wordsTie(shared!, ctx)).headline).toMatch(/^LAC Player 10 (was|finished) tied for 8th in the NBA in steals \+ blocks/);
      expect(facts.some((f) => f.data.tied === 0)).toBe(true);
    }, TIMEOUT);

    it('tied ranks (FF-1): recent form and YoY team-rank tie counts equal a direct count of equal values (0 in this fixture)', async () => {
      const { recentFormDetector } = await import('./engine/detectors/season-ranks');
      const { yoyDetector } = await import('./engine/detectors/season-yoy');
      // The fixture has no tie for either kind (checked over every 2025-26 date and both seasons), so these pin equality at 0.
      const done = await ctxAt('2026-02-20');
      const form = (await recentFormDetector().run({ ...done, season: { ...done.season, isCurrent: true } })).facts;
      expect(form.length).toBeGreaterThan(0);
      for (const f of form) {
        const metric = f.stat.replace('last10_', '');
        const [direct] = await sql.unsafe(`
          WITH latest AS (
            SELECT DISTINCT ON (team_id) team_id, ${metric}::float8 AS value
            FROM rolling_team_stats
            WHERE season_id = $1::int AND window_games = 10 AND ${metric} IS NOT NULL AND as_of_game_date <= $2::date
            ORDER BY team_id, as_of_game_date DESC)
          SELECT COUNT(*)::int AS tied FROM latest
          WHERE team_id <> $3::bigint AND value = (SELECT value FROM latest WHERE team_id = $3::bigint)`,
        [done.season.id, f.context.date, done.lac.teamId] as never[]);
        expect(f.data.tied, f.stat).toBe(Number(direct.tied));
        expect(f.data.tied).toBe(0);
      }

      const ctx = await ctxAt(laToday());
      const yoy = (await yoyDetector('season').run(ctx)).facts.filter((f) => f.data.yoy === 'team_rank');
      expect(yoy.length).toBeGreaterThan(0);
      const { TEAM_METRICS } = await import('./engine/detectors/metrics');
      for (const f of yoy) {
        const m = TEAM_METRICS.find((x) => `team_rank_${x.key}` === f.stat)!;
        const counts = await sql.unsafe(`
          WITH v AS (
            SELECT g.season_id, a.team_id, ROUND((${m.aggregate})::numeric, 6)::float8 AS value
            FROM advanced_team_game_stats a JOIN games g ON g.game_id = a.game_id
            WHERE g.season_id IN ($1::int, $1::int - 1) AND ${REGULAR_SEASON} AND g.game_date <= $2::date
            GROUP BY g.season_id, a.team_id HAVING COUNT(*) >= 5)
          SELECT v.season_id::int AS season_id, COUNT(*) FILTER (WHERE o.team_id <> v.team_id AND o.value = v.value)::int AS tied
          FROM v JOIN v o ON o.season_id = v.season_id
          WHERE v.team_id = $3::bigint GROUP BY v.season_id`,
        [ctx.season.id, ctx.asOf, ctx.lac.teamId] as never[]);
        const by = new Map(counts.map((r) => [Number(r.season_id), Number(r.tied)]));
        expect(f.data.tied, f.stat).toBe(by.get(ctx.season.id));
        expect(f.data.prev_tied, f.stat).toBe(by.get(ctx.season.id - 1));
        expect(f.data.tied).toBe(0);
      }
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
      // FW-12: the series is the evidence, read apart; the proof's rows never carry it
      const { runQuery } = await import('./engine/query');
      const [proofRow] = await runQuery(out.facts[0].proof);
      expect(proofRow).toMatchObject({ comeback: 15 });
      expect(Object.keys(proofRow)).not.toContain('margin_series');
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
          expect(d!.detail, name).toMatch(/( since 2025-26| in 1 season of records) at the time$/);
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
      expect(complete.detail).toMatch(/^Largest comeback win by the Clippers (since 2025-26|in 1 season of records) at the time$/);

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
      expect(new Set(v2.map((r) => r.surface))).toEqual(new Set(['season', 'pregame', 'player']));
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
      expect(run('scripts/verify-insights.ts')).toMatch(/\b0 failed\b/);
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

    describe('verify retirement of frozen postgame proofs', () => {
      // The stored proof says one = 2; the live proof_sql returns one = 1, so the proof no longer holds.
      const insert = (key: string, o: { surface: string; scope: string; gameId: string | null; proofSql?: string; result?: string }) => sql`
        INSERT INTO insights (scope, surface, category, headline, importance, proof_sql, proof_params, proof_result, proof_hash, game_id, first_emitted_at)
        VALUES (${o.scope}, ${o.surface}, 'player_game_stat', 'Broken proof claim', 10, ${o.proofSql ?? 'SELECT 1 AS one'}, '{}'::jsonb,
                ${o.result ?? '[{"part":"fact","data":{"one":2}}]'}::text::jsonb, ${key}, ${o.gameId}::bigint, now())`;
      const active = async (key: string) => (await sql<{ is_active: boolean }[]>`SELECT is_active FROM insights WHERE proof_hash = ${key}`)[0].is_active;
      type Failed = { status?: number; stdout?: string; stderr?: string };
      const runFailing = () => { try { run('scripts/verify-insights.ts'); return null; } catch (e) { return e as Failed; } };
      const oldGame = async () => (await sql<{ game_id: string }[]>`
        SELECT game_id::text FROM games WHERE status = 'final' AND 1 IN (home_team_id, away_team_id) AND season_id = 2025
        ORDER BY game_date LIMIT 1`)[0].game_id;
      const clean = () => sql`DELETE FROM insights WHERE proof_hash LIKE 'verify-%'`;

      it('retires a frozen postgame row whose data changed (with the reason), and still fails any other broken row', async () => {
        try {
          await insert('verify-frozen', { surface: 'postgame', scope: 'historical', gameId: await oldGame() });
          const out = run('scripts/verify-insights.ts');
          expect(out).toMatch(/\b0 failed, 1 retired\b/);
          expect(out).toMatch(/^::warning title=Insight proof retired::[0-9a-f-]{36} Broken proof claim \(stored proof rows not returned by proof_sql\)$/m);
          expect(await active('verify-frozen')).toBe(false);

          await insert('verify-season', { surface: 'season', scope: 'between_games', gameId: null });
          const failed = runFailing();
          expect(failed?.status).toBe(1);
          expect(failed!.stdout).toMatch(/\b1 failed\b/);
          expect(failed!.stderr).toMatch(/Broken proof claim/);
          expect(await active('verify-season')).toBe(true);
        } finally { await clean(); }
      }, TIMEOUT);

      it('a frozen postgame row whose proof_sql errors or whose proof is empty is a failure, not a retirement', async () => {
        try {
          const gameId = await oldGame();
          await insert('verify-sqlerr', { surface: 'postgame', scope: 'historical', gameId, proofSql: 'SELECT 1 / 0 AS one' });
          await insert('verify-empty', { surface: 'postgame', scope: 'historical', gameId, result: '[]' });
          const failed = runFailing();
          expect(failed?.status).toBe(1);
          expect(failed!.stdout).toMatch(/\b2 failed, 0 retired\b/);
          expect(await active('verify-sqlerr')).toBe(true);
          expect(await active('verify-empty')).toBe(true);
        } finally { await clean(); }
      }, TIMEOUT);

      it('a failing postgame row inside the current window still fails verify and stays active; a wider window keeps older rows', async () => {
        try {
          const { verifyActiveInsights } = await import('./verify');
          const [g] = await sql<{ game_id: string; game_date: string }[]>`
            SELECT game_id::text, game_date::text FROM games WHERE status = 'final' AND 1 IN (home_team_id, away_team_id) AND season_id = 2025
            ORDER BY game_date DESC LIMIT 1`;
          await insert('verify-window', { surface: 'postgame', scope: 'historical', gameId: g.game_id });
          // today = the day after the game: inside the 3-day window, same season.
          const inside = await verifyActiveInsights(addDays(g.game_date, 1), 3);
          expect(inside.failures.map((f) => f.headline)).toContain('Broken proof claim');
          expect(inside.retired).toHaveLength(0);
          expect(await active('verify-window')).toBe(true);
          // today = game + 3 days: the game is now outside the window, so its drift retires it.
          const outside = await verifyActiveInsights(addDays(g.game_date, 3), 3);
          expect(outside.retired.map((f) => f.headline)).toContain('Broken proof claim');
          expect(await active('verify-window')).toBe(false);
          // A backfill window of 30 days keeps a game 3 days old inside the window.
          await sql`UPDATE insights SET is_active = TRUE WHERE proof_hash = 'verify-window'`;
          const wide = await verifyActiveInsights(addDays(g.game_date, 3), 30);
          expect(wide.retired).toHaveLength(0);
          expect(await active('verify-window')).toBe(true);
        } finally { await clean(); }
      }, TIMEOUT);
    });

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
