// src/lib/api-history.test.ts
// Tests for GET /api/history/games — covers API-05, API-07, and PERF-03.

import { buildMeta } from './api-utils.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Smoke test (passes immediately) ─────────────────────────────────────────

describe('buildMeta for history endpoint', () => {
  it('source db with ttl_seconds 86400 returns correct meta', () => {
    const meta = buildMeta('db', 86400);
    expect(meta.source).toBe('db');
    expect(meta.ttl_seconds).toBe(86400);
    expect(meta.stale).toBe(false);
  });
});

// ─── GET /api/history/games — mocked DB tests ────────────────────────────────
// The route calls sql for team lookup, then for games. Mock sql to return a
// fake team row on the first call, then [] for subsequent calls.

const mockHistorySqlFn = vi.fn();

vi.mock('./db.js', () => ({
  sql: new Proxy(mockHistorySqlFn, {
    apply(target: typeof mockHistorySqlFn, thisArg: unknown, args: unknown[]) {
      return (target as Function).apply(thisArg, args);
    },
    get(target: typeof mockHistorySqlFn, prop: string | symbol) {
      return (target as unknown as Record<string | symbol, unknown>)[prop];
    },
  }),
  LAC_NBA_TEAM_ID: 1610612746,
}));

describe('GET /api/history/games', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let callCount = 0;
    // First call: team lookup — return a fake internal team_id row
    // Subsequent calls: games query — return empty arrays
    mockHistorySqlFn.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return [{ team_id: '42' }];
      }
      return [];
    });
  });

  // ── PERF-03: Timing SLA ─────────────────────────────────────────────────────

  it('responds in under 400ms with mocked DB (PERF-03)', async () => {
    const { GET } = await import('../../app/api/history/games/route.js');
    const request = new Request('http://localhost/api/history/games?season_id=2025');
    const start = Date.now();
    const res = await GET(request);
    const elapsed = Date.now() - start;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(400);
  });

  it('returns meta envelope with generated_at and stale fields (PERF-03)', async () => {
    const { GET } = await import('../../app/api/history/games/route.js');
    const request = new Request('http://localhost/api/history/games?season_id=2025');
    const res = await GET(request);
    const body = await res.json();
    expect(body.meta).toHaveProperty('generated_at');
    expect(body.meta).toHaveProperty('stale');
  });

  it.todo('returns paginated list of completed LAC games ordered by game_date DESC');
  it.todo('next_cursor is null when all games fit within the first page');
  it.todo('next_cursor is a cursor string when more games exist beyond the page limit');
  it.todo('cursor param fetches the next page starting after the cursor game');
  it.todo('each game object has id, game_date, home_team, away_team, home_score, away_score');
  it.todo('meta has all required fields: generated_at, source, stale, stale_reason, ttl_seconds');
});

// ─── GET /api/history/games/{id} — spec-driven RED tests (todo) ──────────────

describe('GET /api/history/games/{id}', () => {
  it.todo('returns box_score with available:false for pre-Phase-7 games (no game_player_box_scores rows)');
  it.todo('returns box_score with available:true when game_player_box_scores rows exist for the game');
  it.todo('box_score.teams has home and away team entries each with players array and totals object');
  it.todo('box_score.columns lists the stat column names when available:true');
  it.todo('insights array is populated from generated_insights where game_id matches');
  it.todo('insights is empty array when no generated_insights rows exist for the game');
  it.todo('game not found returns 404 with error envelope {error:{code:"NOT_FOUND",message:...,details:{}}}');
  it.todo('meta has all required fields: generated_at, source, stale, stale_reason, ttl_seconds');
});
