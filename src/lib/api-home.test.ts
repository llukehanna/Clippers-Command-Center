// src/lib/api-home.test.ts
// TDD spec for GET /api/home — covers API-02 and API-07.
// RED phase: tests describe expected behaviour; route doesn't exist yet.
// GREEN phase (Plan 03): route implementation turns these tests GREEN.

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

// ─── Route handler shape tests ────────────────────────────────────────────────
// These tests import the real route module with DB mocked.
// They will FAIL (RED) until route.ts is created in Plan 03.

// The sql mock returns a fake LAC team_id row on the first invocation
// (team lookup), then empty arrays for all subsequent queries.
// This matches real behaviour when DB has a team record but no game/stats data.
const mockSqlFn = vi.fn();

vi.mock('./db.js', () => ({
  sql: new Proxy(mockSqlFn, {
    apply(target: typeof mockSqlFn, thisArg: unknown, args: unknown[]) {
      return (target as Function).apply(thisArg, args);
    },
    get(target: typeof mockSqlFn, prop: string | symbol) {
      return (target as unknown as Record<string | symbol, unknown>)[prop];
    },
  }),
  LAC_NBA_TEAM_ID: 1610612746,
}));

vi.mock('./odds.js', () => ({
  getLatestOdds: vi.fn(async () => null),
}));

describe('GET /api/home', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let callCount = 0;
    // First call: team lookup — return a fake internal team_id row
    // Subsequent calls: parallel DB queries — return empty arrays
    mockSqlFn.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return [{ team_id: BigInt(42) }];
      }
      return [];
    });
  });

  it('team_snapshot has conference_seed:null (no standings table in DB)', async () => {
    const { GET } = await import('../../src/app/api/home/route.js');
    const req = new Request('http://localhost:3000/api/home');
    const res = await GET(req);
    const body = await res.json();
    expect(body.team_snapshot.conference_seed).toBeNull();
  });

  it('team_snapshot.net_rating is null when rolling_team_stats has no LAC rows', async () => {
    const { GET } = await import('../../src/app/api/home/route.js');
    const req = new Request('http://localhost:3000/api/home');
    const res = await GET(req);
    const body = await res.json();
    expect(body.team_snapshot.net_rating).toBeNull();
    expect(body.team_snapshot.off_rating).toBeNull();
    expect(body.team_snapshot.def_rating).toBeNull();
  });

  it('last_10 has wins and losses fields derived from score columns', async () => {
    const { GET } = await import('../../src/app/api/home/route.js');
    const req = new Request('http://localhost:3000/api/home');
    const res = await GET(req);
    const body = await res.json();
    expect(body.team_snapshot.last_10).toHaveProperty('wins');
    expect(body.team_snapshot.last_10).toHaveProperty('losses');
    expect(typeof body.team_snapshot.last_10.wins).toBe('number');
    expect(typeof body.team_snapshot.last_10.losses).toBe('number');
  });

  it('last_10.wins + last_10.losses <= 10 (at most 10 games considered)', async () => {
    const { GET } = await import('../../src/app/api/home/route.js');
    const req = new Request('http://localhost:3000/api/home');
    const res = await GET(req);
    const body = await res.json();
    const { wins, losses } = body.team_snapshot.last_10;
    expect(wins + losses).toBeLessThanOrEqual(10);
  });

  it('player_trends is an array (empty when box score data is sparse)', async () => {
    const { GET } = await import('../../src/app/api/home/route.js');
    const req = new Request('http://localhost:3000/api/home');
    const res = await GET(req);
    const body = await res.json();
    expect(Array.isArray(body.player_trends)).toBe(true);
    // No data → returns fewer than 8 (or empty) rather than padding
    expect(body.player_trends.length).toBeLessThanOrEqual(8);
  });

  it('upcoming_schedule is an array (empty when no future LAC games exist)', async () => {
    const { GET } = await import('../../src/app/api/home/route.js');
    const req = new Request('http://localhost:3000/api/home');
    const res = await GET(req);
    const body = await res.json();
    expect(Array.isArray(body.upcoming_schedule)).toBe(true);
  });

  it('next_game is null when no future LAC games exist in games table', async () => {
    const { GET } = await import('../../src/app/api/home/route.js');
    const req = new Request('http://localhost:3000/api/home');
    const res = await GET(req);
    const body = await res.json();
    expect(body.next_game).toBeNull();
  });

  it('meta has all 5 required fields: generated_at, source, stale, stale_reason, ttl_seconds', async () => {
    const { GET } = await import('../../src/app/api/home/route.js');
    const req = new Request('http://localhost:3000/api/home');
    const res = await GET(req);
    const body = await res.json();
    expect(body.meta).toHaveProperty('generated_at');
    expect(body.meta).toHaveProperty('source');
    expect(body.meta).toHaveProperty('stale');
    expect(body.meta).toHaveProperty('stale_reason');
    expect(body.meta).toHaveProperty('ttl_seconds');
  });

  it('meta.ttl_seconds is 300 for home endpoint', async () => {
    const { GET } = await import('../../src/app/api/home/route.js');
    const req = new Request('http://localhost:3000/api/home');
    const res = await GET(req);
    const body = await res.json();
    expect(body.meta.ttl_seconds).toBe(300);
  });

  it('response has Cache-Control: public, max-age=300 header', async () => {
    const { GET } = await import('../../src/app/api/home/route.js');
    const req = new Request('http://localhost:3000/api/home');
    const res = await GET(req);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
  });

  it('insights is an array', async () => {
    const { GET } = await import('../../src/app/api/home/route.js');
    const req = new Request('http://localhost:3000/api/home');
    const res = await GET(req);
    const body = await res.json();
    expect(Array.isArray(body.insights)).toBe(true);
  });
});
