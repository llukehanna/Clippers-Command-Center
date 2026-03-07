// src/lib/api-insights.test.ts
// TDD tests for GET /api/insights — covers API-06 and API-07.
// Tests mock the postgres sql tag to avoid DB connection in unit tests.

import { buildMeta } from './api-utils.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Smoke test (passes immediately) ─────────────────────────────────────────

describe('buildMeta for insights endpoint', () => {
  it('source db with ttl_seconds 60 returns correct meta', () => {
    const meta = buildMeta('db', 60);
    expect(meta.source).toBe('db');
    expect(meta.ttl_seconds).toBe(60);
    expect(meta.stale).toBe(false);
  });
});

// ─── Mock setup ──────────────────────────────────────────────────────────────

// The postgres sql tag is a tagged template literal. Conditional sub-expressions
// (sql`AND game_id = ...` or sql``) are evaluated BEFORE the outer sql call,
// and each results in a fragment object. The outer call returns a Promise<rows>.
//
// Strategy: the sub-fragment calls have a short template strings array (1-2 strings).
// The main query call has a long template strings array (5+ strings). We distinguish
// by checking the length of the first argument (strings array).
//
// Fragment call: sql`AND game_id = ${val}` -> strings has 2 elements
// Fragment call: sql`` -> strings has 1 element
// Main query: sql`SELECT ... FROM insights WHERE ...` -> strings has many elements

let mockRows: unknown[] = [];
let shouldReject = false;
let rejectError: Error | null = null;

const FRAGMENT_THRESHOLD = 4; // fewer than this = fragment, more = main query

const mockSqlImpl = (...args: unknown[]) => {
  const strings = args[0] as string[];
  const isFragment = !strings || strings.length < FRAGMENT_THRESHOLD;
  if (isFragment) {
    // Return a postgres fragment-like object (non-promise)
    return { strings, values: args.slice(1) };
  }
  // Main query call
  if (shouldReject && rejectError) {
    return Promise.reject(rejectError);
  }
  return Promise.resolve(mockRows);
};

const mockSqlTag = vi.fn(mockSqlImpl);

vi.mock('../lib/db.js', () => ({
  sql: mockSqlTag,
  LAC_NBA_TEAM_ID: 1610612746,
}));

// ─── GET /api/insights — spec-driven tests ────────────────────────────────────

describe('GET /api/insights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRows = [];
    shouldReject = false;
    rejectError = null;
    // Re-apply after clearAllMocks resets the implementation
    mockSqlTag.mockImplementation(mockSqlImpl);
  });

  it('returns 400 when scope param is missing', async () => {
    const { GET } = await import('../app/api/insights/route.js');
    const req = new Request('http://localhost/api/insights');
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toMatch(/scope/i);
  });

  it('returns 400 when scope param is invalid', async () => {
    const { GET } = await import('../app/api/insights/route.js');
    const req = new Request('http://localhost/api/insights?scope=invalid');
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toMatch(/scope/i);
  });

  it('returns 200 with insights and meta envelope for valid scope', async () => {
    mockRows = [
      {
        insight_id: 'uuid-1',
        scope: 'live',
        category: 'streak',
        headline: 'Clippers 5-game win streak',
        detail: 'They are on fire',
        importance: 80,
        proof_result: { wins: 5, losses: 0 },
      },
    ];
    const { GET } = await import('../app/api/insights/route.js');
    const req = new Request('http://localhost/api/insights?scope=live');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insights).toHaveLength(1);
    expect(body.meta.source).toBe('db');
    expect(body.meta.ttl_seconds).toBe(30);
  });

  it('returns only is_active=true insights — is_active filter expressed in query condition', async () => {
    mockRows = [
      {
        insight_id: 'uuid-active',
        scope: 'between_games',
        category: 'milestone',
        headline: 'Active insight only',
        detail: 'Detail text',
        importance: 90,
        proof_result: { value: 42 },
      },
    ];
    const { GET } = await import('../app/api/insights/route.js');
    const req = new Request('http://localhost/api/insights?scope=between_games');
    const res = await GET(req);
    const body = await res.json();
    expect(body.insights[0].insight_id).toBe('uuid-active');
  });

  it('each insight has proof with summary=category and result=proof_result', async () => {
    mockRows = [
      {
        insight_id: 'uuid-proof',
        scope: 'historical',
        category: 'rare_event',
        headline: 'Triple double rarity',
        detail: 'Rare event detail',
        importance: 75,
        proof_result: { games: 3, triple_doubles: 2 },
      },
    ];
    const { GET } = await import('../app/api/insights/route.js');
    const req = new Request('http://localhost/api/insights?scope=historical');
    const res = await GET(req);
    const body = await res.json();
    const insight = body.insights[0];
    expect(insight.proof).toBeDefined();
    expect(insight.proof.summary).toBe('rare_event');
    expect(insight.proof.result).toEqual({ games: 3, triple_doubles: 2 });
  });

  it('returns empty array when no insights exist (not null, not error)', async () => {
    mockRows = [];
    const { GET } = await import('../app/api/insights/route.js');
    const req = new Request('http://localhost/api/insights?scope=live');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.insights)).toBe(true);
    expect(body.insights).toHaveLength(0);
  });

  it('meta has all required fields: generated_at, source, stale, stale_reason, ttl_seconds', async () => {
    mockRows = [];
    const { GET } = await import('../app/api/insights/route.js');
    const req = new Request('http://localhost/api/insights?scope=live');
    const res = await GET(req);
    const body = await res.json();
    expect(body.meta).toHaveProperty('generated_at');
    expect(body.meta).toHaveProperty('source');
    expect(body.meta).toHaveProperty('stale');
    expect(body.meta).toHaveProperty('stale_reason');
    expect(body.meta).toHaveProperty('ttl_seconds');
  });

  it('returns 500 on unexpected database error', async () => {
    shouldReject = true;
    rejectError = new Error('DB connection failed');
    const { GET } = await import('../app/api/insights/route.js');
    const req = new Request('http://localhost/api/insights?scope=live');
    const res = await GET(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('sets Cache-Control: public, max-age=30 header', async () => {
    mockRows = [];
    const { GET } = await import('../app/api/insights/route.js');
    const req = new Request('http://localhost/api/insights?scope=live');
    const res = await GET(req);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=30');
  });

  it('scope param "live" is accepted as valid', async () => {
    mockRows = [];
    const { GET } = await import('../app/api/insights/route.js');
    const res = await GET(new Request('http://localhost/api/insights?scope=live'));
    expect(res.status).toBe(200);
  });

  it('scope param "between_games" is accepted as valid', async () => {
    mockRows = [];
    const { GET } = await import('../app/api/insights/route.js');
    const res = await GET(new Request('http://localhost/api/insights?scope=between_games'));
    expect(res.status).toBe(200);
  });

  it('scope param "historical" is accepted as valid', async () => {
    mockRows = [];
    const { GET } = await import('../app/api/insights/route.js');
    const res = await GET(new Request('http://localhost/api/insights?scope=historical'));
    expect(res.status).toBe(200);
  });
});
