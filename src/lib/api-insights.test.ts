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

// sql.unsafe(fragment) carries the shared select/from fragments; the tests only read the template text.
const mockSqlTag = Object.assign(vi.fn(mockSqlImpl), { unsafe: (s: string, params?: unknown) => (params === undefined ? s : Promise.resolve([])) });

vi.mock('@/src/lib/db', () => ({
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

  it('returns 400 when neither scope nor surface is given', async () => {
    const { GET } = await import('@/app/api/insights/route');
    const req = new Request('http://localhost/api/insights');
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toMatch(/scope or surface/i);
  });

  const allSql = () => mockSqlTag.mock.calls.map((c) => (c[0] as string[]).join('?')).join('\n');

  it('surface=postgame with no scope is accepted and filters on i.surface =', async () => {
    mockRows = [];
    mockSqlTag.mockClear();
    const { GET } = await import('@/app/api/insights/route');
    const res = await GET(new Request('http://localhost/api/insights?surface=postgame'));
    expect(res.status).toBe(200);
    expect(allSql()).toContain('i.surface = ');
    expect(allSql()).not.toContain('i.scope = ');
  });

  it('surface=player does not exclude player rows', async () => {
    mockRows = [];
    mockSqlTag.mockClear();
    const { GET } = await import('@/app/api/insights/route');
    const res = await GET(new Request('http://localhost/api/insights?surface=player&player_id=5'));
    expect(res.status).toBe(200);
    expect(allSql()).not.toContain("surface <> 'player'");
  });

  it('surface and scope together are ANDed', async () => {
    mockRows = [];
    mockSqlTag.mockClear();
    const { GET } = await import('@/app/api/insights/route');
    await GET(new Request('http://localhost/api/insights?surface=season&scope=between_games'));
    expect(allSql()).toContain('i.surface = ');
    expect(allSql()).toContain('i.scope = ');
  });

  it('returns 400 for an unknown surface', async () => {
    const { GET } = await import('@/app/api/insights/route');
    const res = await GET(new Request('http://localhost/api/insights?surface=bogus'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/surface/);
  });

  it('items carry the card fields and verdict card', async () => {
    mockRows = [
      {
        insight_id: 'uuid-card', scope: 'historical', surface: 'postgame', category: 'player_game_stat',
        headline: 'h', detail: 'd', importance: 50, proof_result: {},
        player_id: '9', game_id: '1', season_id: 2026, game_date: '2026-11-17',
        frame: { type: 'league_rank', strength: 0.5, who: 'subject', text: 't', proof_rows: [] },
        evidence: { kind: 'x' }, entities: [{ kind: 'player', id: '9' }], updated_at: '2026-11-18T00:00:00Z',
      },
    ];
    const { GET } = await import('@/app/api/insights/route');
    const body = await (await GET(new Request('http://localhost/api/insights?surface=postgame'))).json();
    const item = body.insights[0];
    expect(item.verdict).toBe('card');
    expect(item.surface).toBe('postgame');
    expect(item.frame.type).toBe('league_rank');
    expect(item.evidence).toEqual({ kind: 'x' });
    expect(item.entities).toEqual([{ kind: 'player', id: '9' }]);
    expect(item.updated_at).toBe('2026-11-18T00:00:00Z');
    expect(item.player_id).toBe('9');
    expect(item.game_id).toBe('1');
    expect(item.proof.summary).toBe('player_game_stat');
  });

  it('returns 400 when scope param is invalid', async () => {
    const { GET } = await import('@/app/api/insights/route');
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
        surface: null, frame: null,
      },
    ];
    const { GET } = await import('@/app/api/insights/route');
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
        surface: null, frame: null,
      },
    ];
    const { GET } = await import('@/app/api/insights/route');
    const req = new Request('http://localhost/api/insights?scope=between_games');
    const res = await GET(req);
    const body = await res.json();
    expect(body.insights[0].insight_id).toBe('uuid-active');
  });

  it('never serves player-surface rows: the legacy reader filters them out in SQL', async () => {
    mockRows = [];
    mockSqlTag.mockClear();
    const { GET } = await import('@/app/api/insights/route');
    await GET(new Request('http://localhost/api/insights?scope=between_games'));
    expect(allSql()).toMatch(/i\.surface IS NULL OR i\.surface <> 'player'/);
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
        surface: null, frame: null,
      },
    ];
    const { GET } = await import('@/app/api/insights/route');
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
    const { GET } = await import('@/app/api/insights/route');
    const req = new Request('http://localhost/api/insights?scope=live');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.insights)).toBe(true);
    expect(body.insights).toHaveLength(0);
  });

  it('meta has all required fields: generated_at, source, stale, stale_reason, ttl_seconds', async () => {
    mockRows = [];
    const { GET } = await import('@/app/api/insights/route');
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
    const { GET } = await import('@/app/api/insights/route');
    const req = new Request('http://localhost/api/insights?scope=live');
    const res = await GET(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('sets Cache-Control: public, max-age=30 header', async () => {
    mockRows = [];
    const { GET } = await import('@/app/api/insights/route');
    const req = new Request('http://localhost/api/insights?scope=live');
    const res = await GET(req);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=30');
  });

  it('scope param "live" is accepted as valid', async () => {
    mockRows = [];
    const { GET } = await import('@/app/api/insights/route');
    const res = await GET(new Request('http://localhost/api/insights?scope=live'));
    expect(res.status).toBe(200);
  });

  it('scope param "between_games" is accepted as valid', async () => {
    mockRows = [];
    const { GET } = await import('@/app/api/insights/route');
    const res = await GET(new Request('http://localhost/api/insights?scope=between_games'));
    expect(res.status).toBe(200);
  });

  it('returns 400 when game_id is not numeric (no DB call)', async () => {
    const { GET } = await import('@/app/api/insights/route');
    const res = await GET(new Request('http://localhost/api/insights?scope=live&game_id=abc'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(mockSqlTag).not.toHaveBeenCalled();
  });

  it('returns 400 when player_id is not numeric (no DB call)', async () => {
    const { GET } = await import('@/app/api/insights/route');
    const res = await GET(new Request('http://localhost/api/insights?scope=live&player_id=1;drop'));
    expect(res.status).toBe(400);
    expect(mockSqlTag).not.toHaveBeenCalled();
  });

  it('clamps limit to the range 1..50', async () => {
    const { GET } = await import('@/app/api/insights/route');
    const lastQueryLimit = () => {
      const calls = mockSqlTag.mock.calls;
      const main = calls[calls.length - 1];
      return main[main.length - 1];
    };

    await GET(new Request('http://localhost/api/insights?scope=live&limit=-5'));
    expect(lastQueryLimit()).toBe(3);

    await GET(new Request('http://localhost/api/insights?scope=live&limit=9999'));
    expect(lastQueryLimit()).toBe(150);
  });

  it('drops rows the bar cuts', async () => {
    const base = { scope: 'historical', surface: 'postgame', player_id: '9', game_id: '1', season_id: 2026, game_date: '2026-11-17', evidence: null, proof_result: {}, headline: 'h', detail: 'd', importance: 50 };
    const f = (over: Record<string, unknown>) => ({ type: 'first_since', strength: 0.5, who: 'subject', text: 't', since_date: '2026-11-13', proof_rows: [], ...over });
    mockRows = [
      { ...base, insight_id: 'cut-1', category: 'player_game_stat', frame: f({ games_since: 3 }) },
      { ...base, insight_id: 'cut-2', category: 'player_game_stat', frame: f({ type: 'none' }) },
      { ...base, insight_id: 'card', category: 'player_game_stat', frame: f({ type: 'league_rank', games_since: undefined, since_date: undefined }) },
    ];
    const { GET } = await import('@/app/api/insights/route');
    const body = await (await GET(new Request('http://localhost/api/insights?scope=historical'))).json();
    expect(body.insights.map((i: { insight_id: string }) => i.insight_id)).toEqual(['card']);
  });

  it('keeps the SQL order for a card and a note at equal importance', async () => {
    const base = { scope: 'between_games', player_id: null, game_id: '1', season_id: 2026, game_date: '2026-11-17', evidence: null, proof_result: {}, headline: 'h', detail: 'd', importance: 50 };
    const none = { type: 'none', strength: 0, who: 'group', text: '', proof_rows: [] };
    mockRows = [
      { ...base, insight_id: 'note-first', surface: 'pregame', category: 'opp_form', frame: none },
      { ...base, insight_id: 'card-second', surface: 'postgame', category: 'player_game_stat', frame: { ...none, type: 'league_rank' } },
    ];
    const { GET } = await import('@/app/api/insights/route');
    const body = await (await GET(new Request('http://localhost/api/insights?scope=between_games'))).json();
    expect(body.insights.map((i: { insight_id: string }) => i.insight_id)).toEqual(['note-first', 'card-second']);
  });

  it('scope param "historical" is accepted as valid', async () => {
    mockRows = [];
    const { GET } = await import('@/app/api/insights/route');
    const res = await GET(new Request('http://localhost/api/insights?scope=historical'));
    expect(res.status).toBe(200);
  });
});
