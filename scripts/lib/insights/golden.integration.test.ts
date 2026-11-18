// scripts/lib/insights/golden.integration.test.ts
// Editorial expectations for the insight engine (spec §5.3).
//   Fixture (CI): FIXTURE_DATABASE_URL=… npx vitest run scripts/lib/insights/golden — WIPES and seeds that DB.
//   Real data (local): npm run insights:golden — runs the engine DRY against DATABASE_URL (read-only)
//   and checks only the data-independent expectations.
// The last fixture test mutates data; keep it last.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import type { Surface } from '../../../src/lib/insights/types';
import { EXEMPT_FRAMES, EXEMPT_KINDS } from './engine/score';
import type { EngineResult } from './engine/run';

const REAL = process.env.GOLDEN_REAL === '1';
const url = REAL ? process.env.DATABASE_URL : process.env.FIXTURE_DATABASE_URL;
const TIMEOUT = 300_000;
const RECORD_FRAMES = ['records_best', 'only_one', 'joins_company', 'first_since', 'longest_since', 'clippers_rank'];
const SURFACES: Surface[] = ['season', 'pregame', 'postgame'];

function run(script: string, args: string[] = []): string {
  return execFileSync('npx', ['tsx', script, ...args], {
    encoding: 'utf8', env: { ...process.env, DATABASE_URL: url, FIXTURE_DATABASE_URL: url }, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe.skipIf(!url)(`insight engine golden expectations (${REAL ? 'real data, read-only' : 'fixture league'})`, () => {
  // Imported lazily: scripts/lib/db.ts exits the process without DATABASE_URL.
  let sql: typeof import('../db').sql;
  let runEngine: typeof import('./engine/run').runEngine;
  let composeFeed: typeof import('../../../src/lib/insights/compose').composeFeed;
  let toComposable: typeof import('./engine/replay').toComposable;
  let today: string;
  let all: EngineResult;
  const dry = (asOf: string, surfaces: Surface[] = SURFACES, gameId: string | null = null) =>
    runEngine({ surfaces, asOf, write: false, gameId });

  beforeAll(async () => {
    if (!REAL) {
      run('scripts/dev/seed-fixture-league.ts');
      run('scripts/compute-stats.ts');
      run('scripts/build-record-book.ts');
    }
    process.env.DATABASE_URL = url;
    ({ sql } = await import('../db'));
    ({ runEngine } = await import('./engine/run'));
    ({ composeFeed } = await import('../../../src/lib/insights/compose'));
    ({ toComposable } = await import('./engine/replay'));
    today = (await import('./engine/dates')).laToday();
    all = await dry(today);
  }, TIMEOUT);

  afterAll(async () => {
    await sql?.end();
  });

  describe('data-independent', () => {
    it('G1 every headline fits in 90 characters and reads clean', () => {
      expect(all.drafts.length).toBeGreaterThan(0);
      for (const d of all.drafts) {
        expect(d.headline.length, d.headline).toBeLessThanOrEqual(90);
        expect(`${d.headline} | ${d.detail}`).not.toMatch(/undefined|NaN|\bnull\b|\[object/);
      }
    });

    it('G2 every insight has a non-empty proof with a fact row, and a frame', () => {
      for (const d of all.drafts) {
        expect(d.proof_result.length, d.headline).toBeGreaterThan(0);
        expect(d.proof_result.some((r) => (r as { part: string }).part === 'fact'), d.headline).toBe(true);
        expect(d.frame.type, d.headline).toBeTruthy();
        expect(d.frame.text).toBe(d.detail);
      }
    });

    it('G3 no composed placement has more than two items about one player', () => {
      const items = all.drafts.map(toComposable);
      for (const placement of ['home_hero', 'last_game', 'up_next', 'season_feed'] as const) {
        const counts = new Map<string, number>();
        for (const i of composeFeed(items, placement)) if (i.player_id) counts.set(i.player_id, (counts.get(i.player_id) ?? 0) + 1);
        expect(Math.max(0, ...counts.values()), placement).toBeLessThanOrEqual(2);
      }
    });

    it('G4 former Clippers never appear outside postgame', () => {
      const roster = all.context!.roster;
      for (const d of all.drafts) if (d.surface !== 'postgame' && d.player_id) expect(roster.has(d.player_id), d.headline).toBe(true);
    });

    it('G5 nothing trivial survives: p <= 0.25 unless a milestone or record', () => {
      for (const d of all.drafts) {
        const exempt = EXEMPT_FRAMES.includes(d.frame.type) || EXEMPT_KINDS.includes(d.category);
        if (!exempt && d.score_parts.p !== null) expect(d.score_parts.p, d.headline).toBeLessThanOrEqual(0.25);
      }
    });

    it('G6 frames never exceed the records', () => {
      const ctx = all.context!;
      const floors = [ctx.recordsStart?.season_id, ctx.pbpRecordsStart?.season_id].filter((n): n is number => n !== undefined);
      for (const d of all.drafts) {
        expect(`${d.headline} ${d.detail}`, d.headline).not.toMatch(/franchise history|all[- ]time|team history|\bever\b/i);
        if (!RECORD_FRAMES.includes(d.frame.type)) continue;
        expect(floors.length, `record frame without records: ${d.detail}`).toBeGreaterThan(0);
        const floor = Math.min(...floors);
        for (const m of d.detail.matchAll(/\b(\d{4})-\d{2}\b/g)) expect(Number(m[1]), d.detail).toBeGreaterThanOrEqual(floor);
        if (d.frame.since_date) expect(d.frame.since_date >= `${floor}-08-01`, d.detail).toBe(true);
      }
    });
  });

  describe.skipIf(REAL)('fixture league', () => {
    it('G7 a 55-point game is framed against the records and lands on its game page', async () => {
      const night = all.drafts.find((d) => d.category === 'league_night' && /^Star Clipper/.test(d.headline) && /\b55\b/.test(d.headline));
      expect(night).toBeDefined();
      expect(night!.frame.type).toBe('records_best');
      expect(night!.detail).toMatch(/since 2024-25|in \d+ seasons? of records/);
      const [g] = await sql<{ game_id: string }[]>`SELECT game_id::text FROM game_player_box_scores WHERE player_id = 1 AND points = 55`;
      expect(night!.game_id).toBe(g.game_id);
    });

    it('G8 a completed season reads in the past tense', () => {
      const season = all.drafts.filter((d) => d.surface === 'season');
      expect(season.length).toBeGreaterThan(0);
      expect(season.some((d) => d.headline.includes('this season'))).toBe(false);
      expect(season.find((d) => d.category === 'standings')?.headline).toMatch(/^Clippers (finished 2025-26 at|went) \d+-\d+/);
    });

    it('G9 in season: present tense, a notable standing framed by its rank, the star’s closing streak', async () => {
      const r = await dry('2026-02-25', ['season']);
      const standing = r.drafts.find((d) => d.category === 'standings');
      expect(standing?.headline).toMatch(/^(Clippers are|At) \d+-\d+/);
      expect(standing?.frame.type).toBe('league_rank');
      expect(r.drafts.map((d) => d.headline)).toContainEqual(
        expect.stringMatching(/^Star Clipper (has scored 30\+ in 5 straight games|has 5 straight games with 30\+ points)$/));
    }, TIMEOUT);

    it('G10 pregame insights all point at the next game', async () => {
      const [next] = await sql<{ game_id: string }[]>`SELECT game_id::text FROM games WHERE status <> 'final' ORDER BY game_date LIMIT 1`;
      const pre = all.drafts.filter((d) => d.surface === 'pregame');
      expect(pre.length).toBeGreaterThanOrEqual(2);
      for (const d of pre) expect(d.game_id).toBe(next.game_id);
    });

    // Plan 3 inserts its golden expectations here, above G11.

    it('G11 a 28-PPG scorer’s "20+ in 3 straight" never appears (mutates data: keep last)', async () => {
      await sql`
        UPDATE game_player_box_scores pb SET points = pb.points + 12
        FROM games g WHERE g.game_id = pb.game_id AND pb.player_id = 1 AND g.season_id IN (2024, 2025)`;
      const [fourth] = await sql<{ game_id: string }[]>`
        SELECT pb.game_id::text FROM game_player_box_scores pb JOIN games g ON g.game_id = pb.game_id
        WHERE pb.player_id = 1 AND g.season_id = 2025 ORDER BY g.game_date DESC, g.game_id DESC OFFSET 3 LIMIT 1`;
      await sql`UPDATE game_player_box_scores SET points = 12 WHERE player_id = 1 AND game_id = ${fourth.game_id}::bigint`;
      run('scripts/build-record-book.ts');
      const [avg] = await sql<{ ppg: number }[]>`
        SELECT AVG(pb.points)::float8 AS ppg FROM game_player_box_scores pb JOIN games g ON g.game_id = pb.game_id
        WHERE pb.player_id = 1 AND g.season_id = 2025 AND NOT g.is_playoffs AND g.nba_game_id NOT BETWEEN 50000000 AND 59999999`;
      expect(avg.ppg).toBeGreaterThanOrEqual(28);
      const r = await dry(today, ['season']);
      expect(r.dropped).toContainEqual(expect.objectContaining({ reason: 'trivial', kind: 'streak', stat: 'scoring_20', subject: 'Star Clipper' }));
      expect(r.drafts.some((d) => d.category === 'streak' && d.player_id === '1' && /20\+|20-point/.test(d.headline))).toBe(false);
    }, TIMEOUT);
  });
});
