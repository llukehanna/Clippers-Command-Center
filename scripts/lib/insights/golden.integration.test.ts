// scripts/lib/insights/golden.integration.test.ts
// Editorial expectations for the insight engine (spec §5.3).
//   Fixture (CI): FIXTURE_DATABASE_URL=… npx vitest run scripts/lib/insights/golden — WIPES and seeds that DB.
//   Real data (local): npm run insights:golden — runs the engine DRY against DATABASE_URL (read-only)
//   and checks only the data-independent expectations.
// The last fixture test mutates data; keep it last.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import type { Frame, Surface } from '../../../src/lib/insights/types';
import { careerBestHolds, contextNeeds, factRow, MIN_FIRST_SINCE_GAMES, MIN_STREAK_GAMES, verdict, type BarRow } from '../../../src/lib/insights/quality';
import { EXEMPT_FRAMES, EXEMPT_KINDS } from './engine/score';
import type { EngineResult } from './engine/run';
import type { InsightDraft } from './engine/types';
import { addDays } from './engine/dates';
import { seedGameFlows } from './engine/__fixtures__/flows';

const REAL = process.env.GOLDEN_REAL === '1';
const url = REAL ? process.env.DATABASE_URL : process.env.FIXTURE_DATABASE_URL;
const TIMEOUT = 300_000;
const RECORD_FRAMES = ['records_best', 'only_one', 'joins_company', 'first_since', 'longest_since', 'clippers_rank'];
const SURFACES: Surface[] = ['season', 'pregame', 'postgame', 'player'];

/** A draft as the quality bar sees a stored row (no joined game date: the bar reads the fact row). */
const toBarRow = (d: InsightDraft): BarRow => ({
  insight_id: d.key, surface: d.surface, category: d.category, player_id: d.player_id, game_id: d.game_id,
  season_id: d.season_id, game_date: null, detail: d.detail, frame: d.frame, evidence: d.evidence, proof_result: d.proof_result,
});

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

    it('G3 no composed placement has more than two items about one player (a player page, six about its player)', () => {
      const items = all.drafts.map(toComposable);
      for (const placement of ['home_hero', 'last_game', 'up_next', 'season_feed'] as const) {
        const counts = new Map<string, number>();
        for (const i of composeFeed(items, placement)) if (i.player_id) counts.set(i.player_id, (counts.get(i.player_id) ?? 0) + 1);
        expect(Math.max(0, ...counts.values()), placement).toBeLessThanOrEqual(2);
      }
      // player_page is exempt from the per-player cap; each player's own page holds at most six.
      const pids = new Set(items.map((i) => i.player_id).filter((x): x is string => !!x));
      expect(pids.size).toBeGreaterThan(0);
      for (const pid of pids) {
        const page = composeFeed(items.filter((i) => i.player_id === pid), 'player_page');
        expect(page.length, `player ${pid}`).toBeLessThanOrEqual(6);
      }
    });

    it('G4 former Clippers never appear outside postgame', () => {
      const roster = all.context!.roster;
      for (const d of all.drafts) if (d.surface !== 'postgame' && d.player_id && !(d.surface === 'pregame' && d.score_parts.salience_class === 'opponent')) expect(roster.has(d.player_id), d.headline).toBe(true);
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

    it('G18 every draft obeys the engine side of the bar', () => {
      expect(all.drafts.length).toBeGreaterThan(0);
      for (const d of all.drafts) {
        const label = `${d.category} | ${d.headline} | ${d.detail}`;
        const f = d.frame;
        expect(typeof f.stat, label).toBe('string');
        expect(typeof f.value, label).toBe('number');
        if ((f.type === 'first_since' || f.type === 'longest_since') && f.since_date) {
          expect(f.games_since, label).toBeGreaterThanOrEqual(MIN_FIRST_SINCE_GAMES);
        }
        if (d.category === 'streak') expect(Number(factRow(d.proof_result)?.streak), label).toBeGreaterThanOrEqual(MIN_STREAK_GAMES);
        if (d.category === 'yoy_change' && d.player_id !== null && f.type === 'career_high') {
          const games = Number(factRow(d.proof_result)?.games);
          expect(careerBestHolds(games, f.value!, f.prior_value!), label).toBe(true);
        }
      }
    });

    it('G18b a context-needing frame on any engine draft finds its dates (rows are never cut at load for a missing date)', () => {
      // The fixture run emits few first_since / group season_high frames, so give every real draft each needing frame
      // (no games_since, as a legacy row) and check the draft's own fact row supplies the dates the loaders query by.
      const needing: Frame[] = [
        { type: 'first_since', strength: 0.5, who: 'subject', since_date: '2020-01-01', text: '', proof_rows: [] },
        { type: 'longest_since', strength: 0.5, who: 'group', since_date: '2020-01-01', text: '', proof_rows: [] },
        { type: 'season_high', strength: 0.6, who: 'group', text: '', proof_rows: [] },
      ];
      let needs = 0;
      for (const d of all.drafts) {
        // Dated drafts only: a game's facts or a streak. Season totals and standings never get a since/high frame.
        if (d.game_id === null && d.category !== 'streak') continue;
        if (d.surface === 'pregame') continue;
        for (const frame of needing) {
          const label = `${d.category} | ${d.headline} | ${frame.type}`;
          const got = contextNeeds([{ ...toBarRow(d), frame }]);
          expect(got, label).toHaveLength(1);
          needs += 1;
          const n = got[0];
          if (frame.type === 'season_high') {
            expect(n.at_date, label).not.toBeNull();
            expect(n.season_id, label).not.toBeNull();
          } else {
            expect(n.until_date, label).not.toBeNull();
            expect(n.since_date, label).not.toBeNull();
          }
        }
      }
      expect(needs).toBeGreaterThan(0);
    });
  });

  describe.skipIf(REAL)('fixture league', () => {
    it('G7 a 55-point game is a records_best postgame insight on its game page', async () => {
      const [g] = await sql<{ game_id: string }[]>`SELECT game_id::text FROM game_player_box_scores WHERE player_id = 1 AND points = 55`;
      const r = await dry(today, ['postgame'], g.game_id);
      const night = r.drafts.find((d) => d.category === 'player_game_stat' && /^Star Clipper scored 55\b|^Star Clipper: 55 points/.test(d.headline));
      expect(night).toBeDefined();
      expect(night!.frame.type).toBe('records_best');
      expect(night!.detail).toMatch(/since 2024-25|in \d+ seasons? of records/);
      expect(night!.game_id).toBe(g.game_id);
      expect(r.drafts.every((d) => d.game_id === g.game_id)).toBe(true);
    }, TIMEOUT);

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

    it('G12 the day after a 55-point game, it leads "Last game" and is a top-3 Home hero candidate', async () => {
      const [g] = await sql<{ game_id: string; game_date: string }[]>`
        SELECT pb.game_id::text AS game_id, gm.game_date::text AS game_date
        FROM game_player_box_scores pb JOIN games gm ON gm.game_id = pb.game_id WHERE pb.player_id = 1 AND pb.points = 55`;
      const r = await dry(addDays(g.game_date, 1));
      const items = r.drafts.map(toComposable);
      const last = composeFeed(items, 'last_game');
      expect(last[0]).toMatchObject({ game_id: g.game_id });
      expect(last[0].headline).toMatch(/^Star Clipper/);
      const lead = r.drafts.find((d) => d.game_id === g.game_id && /^Star Clipper/.test(d.headline) && d.headline === last[0].headline);
      expect(lead, last[0].headline).toBeDefined();
      expect(verdict({ ...toBarRow(lead!) })).toBe('card');
      const hero = items
        .filter((i) => ['postgame', 'pregame', 'season'].includes(i.surface) && i.score_parts?.salience_class !== 'former')
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 3);
      expect(hero.some((i) => i.game_id === g.game_id && /^Star Clipper/.test(i.headline))).toBe(true);
    }, TIMEOUT);

    it('G13 a 15-point comeback win produces a game-flow postgame insight framed against play-by-play records', async () => {
      const game = await seedGameFlows(sql);
      run('scripts/build-record-book.ts');
      const r = await dry(today, ['postgame'], game);
      const flow = r.drafts.find((d) => d.category === 'game_flow');
      expect(flow?.headline).toMatch(/^Clippers (erased a 15-point deficit|came back from 15 down) to beat the /);
      expect(flow?.frame.type).toBe('records_best');
      expect(flow?.detail).toMatch(/since 2025-26|in \d+ seasons? of records/);
      expect(flow?.evidence).toMatchObject({ type: 'margin_spark' });
    }, TIMEOUT);

    it('G14 passing 1,000 season points is a postgame milestone on that game', async () => {
      const [g] = await sql<{ game_id: string }[]>`
        SELECT game_id FROM (
          SELECT pb.game_id::text AS game_id, SUM(pb.points) OVER (ORDER BY gm.game_date, gm.game_id) AS total
          FROM game_player_box_scores pb JOIN games gm ON gm.game_id = pb.game_id
          WHERE pb.player_id = 1 AND gm.season_id = 2025 AND NOT gm.is_playoffs AND gm.nba_game_id < 50000000
        ) x WHERE total >= 1000 ORDER BY total LIMIT 1`;
      const r = await dry(today, ['postgame'], g.game_id);
      expect(r.drafts.map((d) => d.headline)).toContainEqual(expect.stringMatching(/^Star Clipper (passed|reached) 1,000 points /));
    }, TIMEOUT);

    it('G15 a player page holds at most six items, all about that player, never a former Clipper', async () => {
      const r = await dry('2026-02-25', ['player']);
      expect(r.drafts.length).toBeGreaterThan(0);
      for (const d of r.drafts) {
        expect(d.player_id, d.headline).not.toBeNull();
        expect(r.context!.roster.has(d.player_id!), d.headline).toBe(true);
      }
      const star = composeFeed(r.drafts.filter((d) => d.player_id === '1').map(toComposable), 'player_page');
      expect(star.length).toBeGreaterThan(0);
      expect(star.length).toBeGreaterThan(2); // player_page is exempt from the per-player cap (R3)
      expect(star.length).toBeLessThanOrEqual(6);
      expect(star.every((i) => i.player_id === '1')).toBe(true);
      expect(r.drafts.some((d) => d.player_id === '1' && d.category === 'season_best' && /\b55\b/.test(d.headline))).toBe(true);
    }, TIMEOUT);

    it('G16 opponent players appear only on the pregame surface, as opponents', async () => {
      const r = await dry('2026-02-10', ['pregame']);
      const hot = r.drafts.filter((x) => x.category === 'opp_hot_player');
      expect(hot.length).toBeGreaterThan(0);
      for (const d of hot) {
        expect(d.surface).toBe('pregame');
        expect(d.score_parts.salience_class).toBe('opponent');
        expect(r.context!.roster.has(d.player_id!)).toBe(false);
      }
      for (const d of all.drafts.filter((x) => x.category === 'opp_hot_player')) {
        expect(d.surface).toBe('pregame');
        expect(d.score_parts.salience_class).toBe('opponent');
        expect(all.context!.roster.has(d.player_id!)).toBe(false);
      }
    }, TIMEOUT);

    it('G17 a single-game postgame run only ever talks about that game', async () => {
      const [g] = await sql<{ game_id: string }[]>`SELECT game_id::text FROM game_player_box_scores WHERE player_id = 1 AND points = 55`;
      const r = await dry(today, ['postgame'], g.game_id);
      expect(r.drafts.length).toBeGreaterThan(0);
      expect(r.drafts.every((d) => d.game_id === g.game_id && d.surface === 'postgame' && d.scope === 'historical')).toBe(true);
    }, TIMEOUT);

    it('G11 a 28-PPG scorer’s "20+ in 5 straight" never appears (mutates data: keep last)', async () => {
      await sql`
        UPDATE game_player_box_scores pb SET points = pb.points + 12
        FROM games g WHERE g.game_id = pb.game_id AND pb.player_id = 1 AND g.season_id IN (2024, 2025)`;
      const [sixth] = await sql<{ game_id: string }[]>`
        SELECT pb.game_id::text FROM game_player_box_scores pb JOIN games g ON g.game_id = pb.game_id
        WHERE pb.player_id = 1 AND g.season_id = 2025 ORDER BY g.game_date DESC, g.game_id DESC OFFSET 5 LIMIT 1`;
      await sql`UPDATE game_player_box_scores SET points = 12 WHERE player_id = 1 AND game_id = ${sixth.game_id}::bigint`;
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
