// scripts/lib/insights/engine.integration.test.ts
// The v2 insight engine against a LOCAL Postgres seeded with the synthetic
// league (scripts/dev/seed-fixture-league.ts), with stats and the record book
// built. Skipped unless FIXTURE_DATABASE_URL is set. The database is WIPED.
//   FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55496/fixture npx vitest run scripts/lib/insights/engine.integration
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { laToday } from './engine/dates';
import { REGULAR_SEASON } from '../sql-fragments';
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
      key: 'store-test-1', detector: 'test', surface: 'postgame', scope: 'historical', category: 'league_night',
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
      expect(await deactivateStale({ surface: 'postgame', categories: ['league_night'], gameIds: ['1'] }, ['store-g1-a'])).toBe(2);
      const active = await sql<{ proof_hash: string }[]>`
        SELECT proof_hash FROM insights WHERE is_active AND proof_hash LIKE 'store-%' ORDER BY 1`;
      expect(active.map((r) => r.proof_hash)).toEqual(['store-g1-a', 'store-g2-a', 'store-season']);
      expect(await deactivateStale({ surface: 'postgame', categories: ['league_night'], gameIds: [] }, [])).toBe(0);
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
      const { playerHitRates, seasonTotalShare, playerValueRate } = await import('./engine/rates');
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
      expect(await playerValueRate(ctx, 'points', '1', 55, g.game_id, g.d)).toMatchObject({ k: 0 });
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

    it('value-rate n counts only games strictly before the fact date', async () => {
      const { playerValueRate } = await import('./engine/rates');
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
      const other = { game_id: '0' }; // no such game: nothing is excluded by id
      const atMid = await playerValueRate(ctx, 'points', '1', 0, other.game_id, mid);
      const atLast = await playerValueRate(ctx, 'points', '1', 0, other.game_id, last);
      expect(atMid.n).toBe(await countBefore(mid));
      expect(atLast.n).toBe(await countBefore(last));
      expect(atLast.n).toBeGreaterThan(atMid.n);
      // A future fact date cannot read past asOf.
      const future = await playerValueRate(ctx, 'points', '1', 0, other.game_id, '2099-01-01');
      expect(future.n).toBe(await countBefore('2099-01-01'));
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
    async function withLateJoiner(ctx: EngineContext, body: () => Promise<void>): Promise<void> {
      const [last] = await sql<{ game_id: string }[]>`
        SELECT g.game_id::text AS game_id FROM games g
        WHERE ${ctx.lac.teamId}::bigint IN (g.home_team_id, g.away_team_id) AND g.season_id = ${ctx.season.id}
          AND ${sql.unsafe(REGULAR_SEASON)} AND g.game_date <= ${ctx.asOf}::date
          AND EXISTS (SELECT 1 FROM game_player_box_scores b WHERE b.game_id = g.game_id AND b.team_id = ${ctx.lac.teamId}::bigint)
        ORDER BY g.game_date DESC, g.game_id DESC LIMIT 1`;
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
      expect(before.has('1')).toBe(false);
      expect(before.has(String(LATE_ID))).toBe(false);
      await withLateJoiner(ctx, async () => {
        expect(await lateJoiners(ctx)).toEqual(new Set([...before, String(LATE_ID)]));
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

    it('postgame: the 55-point night ranks first league-wide; one-game runs stay on that game', async () => {
      const { leagueNightDetector } = await import('./engine/detectors/postgame-league-nights');
      const ctx = await ctxAt(laToday());
      const all = await leagueNightDetector().run(ctx);
      const star = all.facts.find((f) => f.subject.name === 'Star Clipper' && f.stat === 'pts');
      expect(star).toMatchObject({ kind: 'league_night', surface: 'postgame', value: 55, data: { rank: 1 } });
      expect(star!.sample).toMatchObject({ kind: 'rate', k: 0, power: 1 });
      expect(all.gameIds).toContain(star!.gameId);
      const one = await leagueNightDetector().run({ ...ctx, gameId: star!.gameId });
      expect(one.gameIds).toEqual([star!.gameId]);
      expect(one.facts.length).toBeGreaterThan(0);
      expect(one.facts.every((f) => f.gameId === star!.gameId)).toBe(true);
      expect(await leagueNightDetector().run({ ...ctx, league: { complete: false, reason: 'x' } })).toEqual({ facts: [], gameIds: [] });
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
      expect(new Set(v2.map((r) => r.surface))).toEqual(new Set(['season', 'pregame', 'postgame']));
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

    it('a single-game postgame run leaves other games alone', async () => {
      const [g1, g2] = (await sql<{ game_id: string }[]>`
        SELECT game_id::text FROM games WHERE status = 'final' AND 1 IN (home_team_id, away_team_id) AND season_id = 2025
        ORDER BY game_date LIMIT 2`).map((r) => r.game_id);
      for (const [key, gameId] of [['fake-g1', g1], ['fake-g2', g2]]) {
        await sql`
          INSERT INTO insights (scope, surface, category, headline, importance, proof_sql, proof_params, proof_result, proof_hash, game_id, first_emitted_at)
          VALUES ('historical', 'postgame', 'league_night', 'Fake', 10, 'SELECT 1 AS one', '{}'::jsonb,
                  '[{"part":"fact","data":{"one":1}}]'::jsonb, ${key}, ${gameId}::bigint, now())`;
      }
      run('scripts/generate-insights.ts', ['--surface=postgame', `--game=${g1}`]);
      const rows = await sql<{ proof_hash: string; is_active: boolean }[]>`
        SELECT proof_hash, is_active FROM insights WHERE proof_hash LIKE 'fake-%' ORDER BY 1`;
      expect(rows).toEqual([{ proof_hash: 'fake-g1', is_active: false }, { proof_hash: 'fake-g2', is_active: true }]);
      await sql`DELETE FROM insights WHERE proof_hash LIKE 'fake-%'`;
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
      const rogue = { name: 'postgame.rogue', surface: 'postgame' as const, categories: ['league_night' as const], run: async () => ({ facts: [], gameIds: null }) };
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
        kind: 'league_night' as const, surface: 'postgame' as const,
        subject: { type: 'player' as const, id: '1', name: 'Star Clipper' }, stat: 'pts', value: 30,
        window: { type: 'game' as const, game_id: '1', season_id: 2025 }, context: { date: '2026-02-16' },
        polarity: 'positive' as const, proof: { sql: 'SELECT 1 AS one', params: [], match: { one: 1 } },
        asOf: '2026-02-17', sample: { kind: 'context' as const }, data: {}, gameId: '1', seasonId: 2025, ...over,
      });
      const rogue = (over: object, gameIds: string[] | null = ['1'], surface: 'postgame' | 'season' = 'postgame') => ({
        name: 'rogue', surface, categories: ['league_night' as const], run: async () => ({ facts: [stat(over)], gameIds }),
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
          .rejects.toThrow(/rogue emitted season\/league_night/);
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
