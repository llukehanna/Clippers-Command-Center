// src/lib/api-home.test.ts
// Tests for GET /api/home (app/api/home/route.ts) — covers API-02 and API-07.
// The sql tag is mocked and dispatches on query text so tests run offline and
// don't depend on the order in which the route issues its queries.

import { buildMeta } from './api-utils.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Smoke test (passes immediately) ─────────────────────────────────────────

describe('buildMeta for home endpoint', () => {
  it('source db with ttl_seconds 300 returns correct meta', () => {
    const meta = buildMeta('db', 300);
    expect(meta.source).toBe('db');
    expect(meta.ttl_seconds).toBe(300);
    expect(meta.stale).toBe(false);
  });
});

// ─── Route handler tests ──────────────────────────────────────────────────────

type SqlArgs = [readonly string[], ...unknown[]];

const mockSqlFn = vi.fn<(...args: SqlArgs) => Promise<unknown[]>>();

vi.mock('@/src/lib/db', () => ({
  sql: (...args: SqlArgs) => mockSqlFn(...args),
  LAC_NBA_TEAM_ID: 13,
}));

const mockGetLatestOdds = vi.fn<(gameId: string) => Promise<unknown>>();

vi.mock('@/src/lib/odds', () => ({
  getLatestOdds: (gameId: string) => mockGetLatestOdds(gameId),
}));

const LAC_TEAM_ID = '42';
const DISPLAY_SEASON = 2025;

let last10Rows: unknown[] = [];
let upcomingRows: unknown[] = [];

function queryText(args: SqlArgs): string {
  return args[0].join('?');
}

/** Find the recorded call whose SQL text matches `pattern`. */
function findCall(pattern: RegExp): SqlArgs | undefined {
  return mockSqlFn.mock.calls.find((call) => pattern.test(queryText(call)));
}

beforeEach(() => {
  vi.clearAllMocks();
  last10Rows = [];
  upcomingRows = [];
  mockGetLatestOdds.mockResolvedValue(null);
  mockSqlFn.mockImplementation(async (...args: SqlArgs) => {
    const q = queryText(args);
    if (q.includes('display_season_id')) return [{ display_season_id: DISPLAY_SEASON }];
    if (/^\s*SELECT team_id::text AS team_id, abbreviation\s+FROM teams/.test(q)) {
      return [{ team_id: LAC_TEAM_ID, abbreviation: 'LAC' }];
    }
    if (q.includes('home_abbr') && q.includes("lower(g.status) = 'final'")) return last10Rows;
    if (q.includes('home_abbr') && q.includes("lower(g.status) <> 'final'")) return upcomingRows;
    return [];
  });
});

async function getHome() {
  const { GET } = await import('@/app/api/home/route');
  return GET(new Request('http://localhost:3000/api/home'));
}

describe('GET /api/home', () => {
  it('team_snapshot has conference_seed:null (no standings table in DB)', async () => {
    const body = await (await getHome()).json();
    expect(body.team_snapshot.conference_seed).toBeNull();
  });

  it('team_snapshot.net_rating is null when rolling_team_stats has no LAC rows', async () => {
    const body = await (await getHome()).json();
    expect(body.team_snapshot.net_rating).toBeNull();
    expect(body.team_snapshot.off_rating).toBeNull();
    expect(body.team_snapshot.def_rating).toBeNull();
  });

  it('last_10 has numeric wins and losses fields', async () => {
    const body = await (await getHome()).json();
    expect(typeof body.team_snapshot.last_10.wins).toBe('number');
    expect(typeof body.team_snapshot.last_10.losses).toBe('number');
  });

  it('last_10.wins + last_10.losses <= 10 (at most 10 games considered)', async () => {
    const body = await (await getHome()).json();
    const { wins, losses } = body.team_snapshot.last_10;
    expect(wins + losses).toBeLessThanOrEqual(10);
  });

  it('player_trends is an array (empty when box score data is sparse)', async () => {
    const body = await (await getHome()).json();
    expect(Array.isArray(body.player_trends)).toBe(true);
    expect(body.player_trends.length).toBeLessThanOrEqual(8);
  });

  it('upcoming_schedule is an array and next_game is null when no future LAC games exist', async () => {
    const body = await (await getHome()).json();
    expect(Array.isArray(body.upcoming_schedule)).toBe(true);
    expect(body.next_game).toBeNull();
  });

  it('meta has all 5 required fields and ttl_seconds 300', async () => {
    const body = await (await getHome()).json();
    expect(body.meta).toHaveProperty('generated_at');
    expect(body.meta).toHaveProperty('source');
    expect(body.meta).toHaveProperty('stale');
    expect(body.meta).toHaveProperty('stale_reason');
    expect(body.meta.ttl_seconds).toBe(300);
  });

  it('response has Cache-Control: public, max-age=300 header', async () => {
    const res = await getHome();
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
  });

  it('insights is an array', async () => {
    const body = await (await getHome()).json();
    expect(Array.isArray(body.insights)).toBe(true);
  });

  // ── Season scoping ──────────────────────────────────────────────────────────

  it('returns the DB-derived season and scopes record, last_10 and ratings to it', async () => {
    const body = await (await getHome()).json();
    expect(body.team_snapshot.season_id).toBe(DISPLAY_SEASON);

    const recordCall = findCall(/NOT is_playoffs/);
    expect(recordCall).toBeDefined();
    expect(recordCall!.slice(1)).toContain(DISPLAY_SEASON);

    const last10Call = findCall(/home_abbr[\s\S]*lower\(g\.status\) = 'final'/);
    expect(last10Call!.slice(1)).toContain(DISPLAY_SEASON);

    const ratingsCall = findCall(/FROM rolling_team_stats/);
    expect(ratingsCall!.slice(1)).toContain(DISPLAY_SEASON);
  });

  it('compares game_date against the US Eastern date, not CURRENT_DATE', async () => {
    await getHome();
    const upcomingCall = findCall(/lower\(g\.status\) <> 'final'[\s\S]*LIMIT 10/);
    const text = queryText(upcomingCall!);
    expect(text).toContain("AT TIME ZONE 'America/New_York'");
    expect(text).not.toContain('CURRENT_DATE');
  });

  // ── last10_games (point-diff chart) ─────────────────────────────────────────

  it('team_snapshot.last10_games has opponent_abbr, game_date and LAC-perspective margin', async () => {
    last10Rows = [
      // LAC home win by 8
      { home_team_id: LAC_TEAM_ID, away_team_id: '7', home_score: 110, away_score: 102,
        game_date: '2026-04-12', home_abbr: 'LAC', away_abbr: 'DEN' },
      // LAC away loss by 5
      { home_team_id: '9', away_team_id: LAC_TEAM_ID, home_score: 101, away_score: 96,
        game_date: '2026-04-10', home_abbr: 'GSW', away_abbr: 'LAC' },
    ];
    const body = await (await getHome()).json();
    expect(body.team_snapshot.last10_games).toEqual([
      { opponent_abbr: 'DEN', game_date: '2026-04-12', margin: 8 },
      { opponent_abbr: 'GSW', game_date: '2026-04-10', margin: -5 },
    ]);
    expect(body.team_snapshot.last_10).toEqual({ wins: 1, losses: 1 });
  });

  // ── Odds shape (consumed by NextGameHero / ScheduleTable) ───────────────────

  it('next_game.odds exposes spread/moneyline/over_under from the LAC side', async () => {
    upcomingRows = [
      { game_id: '555', game_date: '2026-10-22', start_time_utc: null,
        home_team_id: '9', away_team_id: LAC_TEAM_ID, home_abbr: 'GSW', away_abbr: 'LAC',
        status: 'scheduled' },
    ];
    mockGetLatestOdds.mockResolvedValue({
      spread_home: -4.5, spread_away: 4.5,
      moneyline_home: -180, moneyline_away: 155,
      total_points: 226.5, captured_at: '2026-10-21T12:00:00Z',
    });
    const body = await (await getHome()).json();
    expect(body.next_game.home_away).toBe('away');
    expect(body.next_game.odds).toEqual({
      spread: 4.5,
      moneyline: 155,
      over_under: 226.5,
      captured_at: '2026-10-21T12:00:00Z',
    });
    expect(body.meta.source).toBe('mixed');
  });

  // ── PERF-02: Timing SLA ─────────────────────────────────────────────────────

  it('responds in under 300ms with mocked DB (PERF-02)', async () => {
    const start = Date.now();
    const res = await getHome();
    const elapsed = Date.now() - start;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(300);
  });
});
