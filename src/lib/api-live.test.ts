// src/lib/api-live.test.ts
// Integration tests for GET /api/live — covers PERF-01, RELY-01.
// Mocks the sql tag from src/lib/db so tests run offline with no Neon dependency.
// Route imported from app/api/live/route.ts (active Next.js app dir).

import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import { buildMeta, buildError } from './api-utils.js';

// ── Module mocks (hoisted by Vitest before any imports below) ─────────────────

vi.mock('@/src/lib/db', () => {
  const sqlMock = vi.fn();
  // sql.json is used in poll-live.ts payload serialization — stub it out
  (sqlMock as unknown as { json: ReturnType<typeof vi.fn> }).json = vi.fn((v: unknown) => v);
  return { sql: sqlMock, LAC_NBA_TEAM_ID: 1610612746 };
});

vi.mock('@/src/lib/odds', () => ({
  getLatestOdds: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/src/lib/insights/live', () => ({
  generateLiveInsights: vi.fn().mockReturnValue([]),
}));

import { GET } from '../../app/api/live/route';
import { sql } from '@/src/lib/db';

// postgres' Sql type expects RowList results; the mock just resolves plain arrays.
const mockedSql = sql as unknown as Mock<(...args: unknown[]) => Promise<unknown>>;

// ─── Smoke tests for shared helpers (pass immediately) ───────────────────────

describe('buildMeta', () => {
  it('returns all required meta fields', () => {
    const meta = buildMeta('db', 300);
    expect(meta).toHaveProperty('generated_at');
    expect(meta).toHaveProperty('source', 'db');
    expect(meta).toHaveProperty('stale', false);
    expect(meta).toHaveProperty('stale_reason', null);
    expect(meta).toHaveProperty('ttl_seconds', 300);
  });

  it('sets stale and stale_reason when provided', () => {
    const meta = buildMeta('nba_live', 5, true, 'poll daemon offline');
    expect(meta.stale).toBe(true);
    expect(meta.stale_reason).toBe('poll daemon offline');
    expect(meta.ttl_seconds).toBe(5);
  });

  it('generated_at is a valid ISO 8601 string', () => {
    const meta = buildMeta('db', null);
    expect(() => new Date(meta.generated_at)).not.toThrow();
    expect(new Date(meta.generated_at).toISOString()).toBe(meta.generated_at);
  });
});

describe('buildError', () => {
  it('returns error envelope with code, message, and empty details by default', () => {
    const result = buildError('NOT_FOUND', 'Game not found');
    expect(result).toEqual({
      error: { code: 'NOT_FOUND', message: 'Game not found', details: {} },
    });
  });

  it('includes details when provided', () => {
    const result = buildError('INTERNAL_ERROR', 'DB failed', { query: 'live_snapshots' });
    expect(result.error.details).toEqual({ query: 'live_snapshots' });
  });
});

// ─── Snapshot row fixtures ────────────────────────────────────────────────────

/**
 * Minimal TeamStatistics that satisfies computeKeyMetrics without NaN.
 */
const minimalStats = {
  fieldGoalsMade: 30,
  fieldGoalsAttempted: 65,
  threePointersMade: 10,
  threePointersAttempted: 25,
  freeThrowsMade: 8,
  freeThrowsAttempted: 10,
  turnovers: 12,
  reboundsTotal: 40,
  reboundsOffensive: 8,
  points: 88,
  assists: 22,
  steals: 5,
  blocks: 3,
  plusMinusPoints: 0,
};

/**
 * Minimal BoxscoreTeam — no players needed since computeGameMinutes
 * falls back to 48 minutes when sumMinutes returns 0.
 */
const minimalBox = {
  statistics: minimalStats,
  players: [],
};

/** Snap that is fresh (captured_at = now, is_stale = false) */
function makeFreshSnapRow() {
  return {
    snapshot_id: 42,
    game_id: '9999',
    period: 3,
    clock: '5:00',
    home_score: 88,
    away_score: 82,
    home_team_id: '13',  // LAC internal team_id
    away_team_id: '5',
    captured_at: new Date().toISOString(),
    lac_team_id: '13',
    payload: {
      is_stale: false,
      stale_reason: null,
      home_box: minimalBox,
      away_box: minimalBox,
      recent_scoring: [],
    },
  };
}

/** Snap with is_stale flag set (poll daemon explicitly marked it stale) */
function makeStaleSnapRow_flag() {
  return {
    snapshot_id: 1,
    game_id: '9999',
    period: 3,
    clock: '5:00',
    home_score: 88,
    away_score: 82,
    home_team_id: '13',
    away_team_id: '5',
    captured_at: new Date().toISOString(), // recent, but is_stale=true
    lac_team_id: '13',
    payload: {
      is_stale: true,
      stale_reason: 'poll daemon offline',
      home_box: null,
      away_box: null,
      recent_scoring: [],
    },
  };
}

/** Snap that is 8 minutes old — triggers time-based stale (>2 min poll threshold) */
function makeStaleSnapRow_age() {
  return {
    snapshot_id: 2,
    game_id: '9999',
    period: 3,
    clock: '5:00',
    home_score: 88,
    away_score: 82,
    home_team_id: '13',
    away_team_id: '5',
    captured_at: new Date(Date.now() - 8 * 60_000).toISOString(),
    lac_team_id: '13',
    payload: {
      is_stale: false, // flag NOT set, but age > 2 min triggers stale
      stale_reason: null,
      home_box: null,
      away_box: null,
      recent_scoring: [],
    },
  };
}

/** Minimal GameRow returned by fetchGameDetails sql call */
const gameRow = {
  game_id: '9999',
  nba_game_id: '0022400001',
  season_id: 2024,
  game_date: '2024-01-08',
  start_time_utc: '2024-01-08T03:30:00Z',
  home_team_id: '13',
  home_abbr: 'LAC',
  home_name: 'Clippers',
  away_team_id: '5',
  away_abbr: 'PHX',
  away_name: 'Suns',
};

// ─── GET /api/live — integration tests ───────────────────────────────────────

describe('GET /api/live', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns state:"NO_ACTIVE_GAME" with game:null when there is no live state', async () => {
    mockedSql
      .mockResolvedValueOnce([]) // snapshot query → no rows
      .mockResolvedValueOnce([]); // fetchMissedGame → no rows

    const response = await GET();
    const body = await response.json();

    expect(body.state).toBe('NO_ACTIVE_GAME');
    expect(body.game).toBeNull();
    expect(body.key_metrics).toEqual([]);
    expect(body.box_score).toBeNull();
    expect(body.insights).toEqual([]);
    expect(body.odds).toBeNull();
    expect(body.upcoming).toBeNull();
  });

  it('returns state:"DATA_DELAYED" and meta.stale:true when latest snapshot has is_stale:true', async () => {
    const staleSnap = makeStaleSnapRow_flag();
    mockedSql
      .mockResolvedValueOnce([staleSnap])   // 1st: snapshot query
      .mockResolvedValueOnce([gameRow]);    // 2nd: fetchGameDetails

    const response = await GET();
    const body = await response.json();

    expect(body.state).toBe('DATA_DELAYED');
    expect(body.meta.stale).toBe(true);
    expect(body.meta.stale_reason).toBe('poll daemon offline');
    expect(body.game).not.toBeNull(); // last known data still present
    expect(body.box_score).toBeNull();
  });

  it('returns state:"DATA_DELAYED" and meta.stale:true when snapshot captured_at is 8 min ago', async () => {
    const ageSnap = makeStaleSnapRow_age();
    mockedSql
      .mockResolvedValueOnce([ageSnap])    // 1st: snapshot query
      .mockResolvedValueOnce([gameRow]);   // 2nd: fetchGameDetails

    const response = await GET();
    const body = await response.json();

    expect(body.state).toBe('DATA_DELAYED');
    expect(body.meta.stale).toBe(true);
    expect(body.game).not.toBeNull();
  });

  it('returns state:"LIVE" with 4 key_metrics when game is in_progress', async () => {
    const freshSnap = makeFreshSnapRow();
    mockedSql
      .mockResolvedValueOnce([freshSnap])  // 1st: snapshot query
      .mockResolvedValueOnce([gameRow]);   // 2nd: fetchGameDetails

    const response = await GET();
    const body = await response.json();

    expect(body.state).toBe('LIVE');
    expect(body.key_metrics).toHaveLength(4);
  });

  it('LIVE responses carry snapshot_captured_at, so /live can tell whether a pushed doc is newer', async () => {
    const freshSnap = makeFreshSnapRow();
    mockedSql
      .mockResolvedValueOnce([freshSnap])
      .mockResolvedValueOnce([gameRow]);

    const body = await (await GET()).json();

    expect(body.state).toBe('LIVE');
    expect(body.snapshot_captured_at).toBe(freshSnap.captured_at);
  });

  it('key_metrics includes efg_pct, tov_margin, reb_margin, pace in that order', async () => {
    const freshSnap = makeFreshSnapRow();
    mockedSql
      .mockResolvedValueOnce([freshSnap])
      .mockResolvedValueOnce([gameRow]);

    const response = await GET();
    const body = await response.json();

    const keys = body.key_metrics.map((m: { key: string }) => m.key);
    expect(keys).toEqual(['efg_pct', 'tov_margin', 'reb_margin', 'pace']);
  });

  it('meta.ttl_seconds is 5 for LIVE state, 60 for NO_ACTIVE_GAME state', async () => {
    // NO_ACTIVE_GAME → ttl=60
    mockedSql.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const noGameRes = await GET();
    const noGameBody = await noGameRes.json();
    expect(noGameBody.meta.ttl_seconds).toBe(60);

    vi.clearAllMocks();

    // LIVE → ttl=5
    const freshSnap = makeFreshSnapRow();
    mockedSql
      .mockResolvedValueOnce([freshSnap])
      .mockResolvedValueOnce([gameRow]);
    const liveRes = await GET();
    const liveBody = await liveRes.json();
    expect(liveBody.meta.ttl_seconds).toBe(5);
  });

  it('meta envelope has generated_at, source, stale, stale_reason, ttl_seconds on all responses', async () => {
    mockedSql.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const response = await GET();
    const body = await response.json();
    const { meta } = body;

    expect(meta).toHaveProperty('generated_at');
    expect(meta).toHaveProperty('source');
    expect(meta).toHaveProperty('stale');
    expect(meta).toHaveProperty('stale_reason');
    expect(meta).toHaveProperty('ttl_seconds');
    // generated_at must be a valid ISO string
    expect(new Date(meta.generated_at).toISOString()).toBe(meta.generated_at);
  });

  it('box_score is null when state is NO_ACTIVE_GAME', async () => {
    mockedSql.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const response = await GET();
    const body = await response.json();

    expect(body.box_score).toBeNull();
  });

  it('insights array is populated when game is LIVE and generated_insights rows exist', async () => {
    // The generateLiveInsights mock returns [] by default; insights will be []
    // but the response shape is valid (array, not null).
    const freshSnap = makeFreshSnapRow();
    mockedSql
      .mockResolvedValueOnce([freshSnap])
      .mockResolvedValueOnce([gameRow]);

    const response = await GET();
    const body = await response.json();

    expect(Array.isArray(body.insights)).toBe(true);
  });

  it('other_games array is empty array (not null) when no other games are active', async () => {
    mockedSql.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const response = await GET();
    const body = await response.json();

    expect(Array.isArray(body.other_games)).toBe(true);
    expect(body.other_games).toHaveLength(0);
  });

  it('returns NO_ACTIVE_GAME when the only LAC snapshot is old and its game is not in_progress', async () => {
    // The snapshot query filters to in_progress games or snapshots captured in the
    // last 30 minutes, so an old snapshot from a finished game yields no row.
    // With no snapshot at all, the route also checks for a missed (runner-never-
    // started) game before giving up — here that check finds nothing either.
    mockedSql
      .mockResolvedValueOnce([]) // snapshot query → no rows
      .mockResolvedValueOnce([]); // fetchMissedGame → no rows

    const response = await GET();
    const body = await response.json();

    expect(body.state).toBe('NO_ACTIVE_GAME');
    expect(body.game).toBeNull();
    // Exactly two queries: the snapshot lookup and the missed-game check — no
    // further game/team lookups for a non-live game.
    expect(mockedSql).toHaveBeenCalledTimes(2);
    const queryText = (mockedSql.mock.calls[0][0] as string[]).join('?');
    expect(queryText).toMatch(/lower\(g\.status\) = 'in_progress'/);
    expect(queryText).toMatch(/interval '30 minutes'/);
  });

  it('is LIVE while the state is younger than max(30 s, cadence + 20 s)', async () => {
    const fresh = makeFreshSnapRow();
    const snap = {
      ...fresh,
      captured_at: new Date(Date.now() - 25_000).toISOString(),
      payload: { ...fresh.payload, cadence: { phase: 'LIVE', next_ms: 3_000 } },
    };
    mockedSql.mockResolvedValueOnce([snap]).mockResolvedValueOnce([gameRow]);
    const body = await (await GET()).json();
    expect(body.state).toBe('LIVE');
    expect(body.cadence).toEqual({ phase: 'LIVE', next_ms: 3_000 });
  });

  it('is DATA_DELAYED once the state outlives its cadence', async () => {
    const fresh = makeFreshSnapRow();
    const snap = {
      ...fresh,
      captured_at: new Date(Date.now() - 40_000).toISOString(),
      payload: { ...fresh.payload, cadence: { phase: 'LIVE', next_ms: 3_000 } },
    };
    mockedSql.mockResolvedValueOnce([snap]).mockResolvedValueOnce([gameRow]);
    const body = await (await GET()).json();
    expect(body.state).toBe('DATA_DELAYED');
    expect(body.meta.stale_reason).toBe('poll daemon offline');
  });

  it('allows a slow halftime cadence', async () => {
    const fresh = makeFreshSnapRow();
    const snap = {
      ...fresh,
      captured_at: new Date(Date.now() - 45_000).toISOString(),
      payload: { ...fresh.payload, cadence: { phase: 'HALFTIME', next_ms: 30_000 } },
    };
    mockedSql.mockResolvedValueOnce([snap]).mockResolvedValueOnce([gameRow]);
    expect((await (await GET()).json()).state).toBe('LIVE');
  });

  it('lets the Vercel CDN cache live responses for 2 s and idle ones for 30 s, never the browser', async () => {
    mockedSql.mockResolvedValueOnce([makeFreshSnapRow()]).mockResolvedValueOnce([gameRow]);
    const live = await GET();
    expect(live.headers.get('Vercel-CDN-Cache-Control')).toBe('max-age=2, stale-while-revalidate=10');
    expect(live.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');

    mockedSql.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const idle = await GET();
    expect(idle.headers.get('Vercel-CDN-Cache-Control')).toBe('max-age=30, stale-while-revalidate=60');
  });

  it('never caches errors', async () => {
    mockedSql.mockRejectedValueOnce(new Error('boom'));
    const res = await GET();
    expect(res.status).toBe(500);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Vercel-CDN-Cache-Control')).toBeNull();
  });

  it('passes through real status, line score and other_games from runner snapshots', async () => {
    const base = makeFreshSnapRow();
    const other = { game_id: '0022400002', status: 'in_progress', home: { abbreviation: 'BOS', score: 50 }, away: { abbreviation: 'NYK', score: 48 } };
    const snap = {
      ...base,
      game_status: 'in_progress',
      payload: {
        ...base.payload,
        status: 'in_progress',
        status_text: 'Q3 5:00',
        periods: [{ period: 1, home: 30, away: 28 }, { period: 2, home: 29, away: 27 }],
        other_games: [other],
      },
    };
    mockedSql.mockResolvedValueOnce([snap]).mockResolvedValueOnce([gameRow]);

    const body = await (await GET()).json();

    expect(body.state).toBe('LIVE');
    expect(body.game.status).toBe('in_progress');
    expect(body.game.status_text).toBe('Q3 5:00');
    expect(body.game.periods).toEqual([{ period: 1, home: 30, away: 28 }, { period: 2, home: 29, away: 27 }]);
    expect(body.other_games).toEqual([other]);
  });

  it('a final game is not stale after polling stops', async () => {
    const base = makeFreshSnapRow();
    const snap = {
      ...base,
      captured_at: new Date(Date.now() - 10 * 60_000).toISOString(),
      game_status: 'final',
      payload: { ...base.payload, status: 'final' },
    };
    mockedSql.mockResolvedValueOnce([snap]).mockResolvedValueOnce([gameRow]);

    const body = await (await GET()).json();

    expect(body.state).toBe('LIVE');
    expect(body.meta.stale).toBe(false);
    expect(body.game.status).toBe('final');
  });

  it('a pre-tip snapshot is NO_ACTIVE_GAME but still feeds other_games', async () => {
    const base = makeFreshSnapRow();
    const other = { game_id: '0022400002', status: 'final' };
    const snap = {
      ...base,
      period: 0,
      game_status: 'scheduled',
      payload: {
        ...base.payload,
        home_box: null,
        away_box: null,
        status: 'scheduled',
        other_games: [other],
        nba_game_id: '0022600093',
      },
    };
    mockedSql.mockResolvedValueOnce([snap]);

    const body = await (await GET()).json();

    expect(body.state).toBe('NO_ACTIVE_GAME');
    expect(body.game).toBeNull();
    expect(body.other_games).toEqual([other]);
    expect(body.upcoming).toEqual({ nba_game_id: '0022600093' });
  });

  it('caches a pre-tip response with an upcoming game for only 2 s, so the tip refetch sees the game quickly', async () => {
    const snap = {
      ...makeFreshSnapRow(),
      game_status: 'scheduled',
      payload: { is_stale: false, stale_reason: null, home_box: null, away_box: null, recent_scoring: [], status: 'scheduled', nba_game_id: '0022600093' },
    };
    mockedSql.mockResolvedValueOnce([snap]);
    const res = await GET();
    expect((await res.json()).upcoming).toEqual({ nba_game_id: '0022600093' });
    expect(res.headers.get('Vercel-CDN-Cache-Control')).toBe('max-age=2, stale-while-revalidate=10');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
  });

  it('returns 500 without leaking internal error text', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedSql.mockRejectedValueOnce(new Error('password authentication failed for user neondb'));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('password');
    consoleSpy.mockRestore();
  });

  it('/api/live NO_ACTIVE_GAME path completes in under 200ms (wall-clock, mocked DB)', async () => {
    mockedSql.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const start = Date.now();
    await GET();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(200);
  });
});
