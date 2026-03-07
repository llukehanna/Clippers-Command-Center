// src/lib/api-live.test.ts
// RED test scaffold for GET /api/live — covers API-01 and API-07.
// Route handler doesn't exist yet — these tests go GREEN in Plan 02.
// They document the expected contract from Docs/API_SPEC.md.

import { buildMeta, buildError } from './api-utils.js';
import { describe, it, expect } from 'vitest';

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

// ─── GET /api/live — spec-driven RED tests (todo) ────────────────────────────

describe('GET /api/live', () => {
  it.todo('returns state:"NO_ACTIVE_GAME" with game:null when live_snapshots is empty');
  it.todo('returns state:"DATA_DELAYED" and meta.stale:true when latest snapshot has is_stale:true');
  it.todo('returns state:"LIVE" with 4 key_metrics when game is in_progress');
  it.todo('key_metrics includes efg_pct, tov_margin, reb_margin, pace in that order');
  it.todo('meta.ttl_seconds is 5 for LIVE state, 60 for NO_ACTIVE_GAME state');
  it.todo('meta envelope has generated_at, source, stale, stale_reason, ttl_seconds on all responses');
  it.todo('box_score is null when state is NO_ACTIVE_GAME');
  it.todo('insights array is populated when game is LIVE and generated_insights rows exist');
  it.todo('other_games array is empty array (not null) when no other games are active');
});
