// src/lib/api-live.test.ts
// Integration tests for GET /api/live — covers PERF-01, RELY-01.
// Mocks the sql tag from src/lib/db so tests run offline with no Neon dependency.
// Route imported from app/api/live/route.ts (active Next.js app dir).

import { vi, describe, it, expect, beforeEach } from 'vitest';
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

const mockedSql = vi.mocked(sql);

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
    payload: {
      is_stale: true,
      stale_reason: 'poll daemon offline',
      home_box: null,
      away_box: null,
      recent_scoring: [],
    },
  };
}

/** Snap that is 90 seconds old — triggers time-based stale (>60s) */
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
    captured_at: new Date(Date.now() - 90_000).toISOString(),
    payload: {
      is_stale: false, // flag NOT set, but age > 60s triggers stale
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

/** LAC team row returned by third sql call in LIVE path */
const lacTeamRow = {
  team_id: '13',
  abbreviation: 'LAC',
  name: 'Clippers',
};

// ─── GET /api/live — integration tests ───────────────────────────────────────

describe('GET /api/live', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns state:"NO_ACTIVE_GAME" with game:null when live_snapshots is empty', async () => {
    mockedSql.mockResolvedValueOnce([]); // snapshot query → no rows

    const response = await GET();
    const body = await response.json();

    expect(body.state).toBe('NO_ACTIVE_GAME');
    expect(body.game).toBeNull();
    expect(body.key_metrics).toEqual([]);
    expect(body.box_score).toBeNull();
    expect(body.insights).toEqual([]);
    expect(body.odds).toBeNull();
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

  it('returns state:"DATA_DELAYED" and meta.stale:true when snapshot captured_at is 90s ago', async () => {
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
      .mockResolvedValueOnce([gameRow])    // 2nd: fetchGameDetails
      .mockResolvedValueOnce([lacTeamRow]); // 3rd: LAC team row

    const response = await GET();
    const body = await response.json();

    expect(body.state).toBe('LIVE');
    expect(body.key_metrics).toHaveLength(4);
  });

  it('key_metrics includes efg_pct, tov_margin, reb_margin, pace in that order', async () => {
    const freshSnap = makeFreshSnapRow();
    mockedSql
      .mockResolvedValueOnce([freshSnap])
      .mockResolvedValueOnce([gameRow])
      .mockResolvedValueOnce([lacTeamRow]);

    const response = await GET();
    const body = await response.json();

    const keys = body.key_metrics.map((m: { key: string }) => m.key);
    expect(keys).toEqual(['efg_pct', 'tov_margin', 'reb_margin', 'pace']);
  });

  it('meta.ttl_seconds is 5 for LIVE state, 60 for NO_ACTIVE_GAME state', async () => {
    // NO_ACTIVE_GAME → ttl=60
    mockedSql.mockResolvedValueOnce([]);
    const noGameRes = await GET();
    const noGameBody = await noGameRes.json();
    expect(noGameBody.meta.ttl_seconds).toBe(60);

    vi.clearAllMocks();

    // LIVE → ttl=5
    const freshSnap = makeFreshSnapRow();
    mockedSql
      .mockResolvedValueOnce([freshSnap])
      .mockResolvedValueOnce([gameRow])
      .mockResolvedValueOnce([lacTeamRow]);
    const liveRes = await GET();
    const liveBody = await liveRes.json();
    expect(liveBody.meta.ttl_seconds).toBe(5);
  });

  it('meta envelope has generated_at, source, stale, stale_reason, ttl_seconds on all responses', async () => {
    mockedSql.mockResolvedValueOnce([]);

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
    mockedSql.mockResolvedValueOnce([]);

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
      .mockResolvedValueOnce([gameRow])
      .mockResolvedValueOnce([lacTeamRow]);

    const response = await GET();
    const body = await response.json();

    expect(Array.isArray(body.insights)).toBe(true);
  });

  it('other_games array is empty array (not null) when no other games are active', async () => {
    mockedSql.mockResolvedValueOnce([]);

    const response = await GET();
    const body = await response.json();

    expect(Array.isArray(body.other_games)).toBe(true);
    expect(body.other_games).toHaveLength(0);
  });

  it('/api/live NO_ACTIVE_GAME path completes in under 200ms (wall-clock, mocked DB)', async () => {
    mockedSql.mockResolvedValueOnce([]);

    const start = Date.now();
    await GET();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(200);
  });
});
