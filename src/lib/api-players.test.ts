// src/lib/api-players.test.ts
// RED test scaffold for GET /api/players and GET /api/players/{id} — covers API-03 and API-07.
// Route handlers don't exist yet — these tests go GREEN in Plan 04.
// They document the expected contract from Docs/API_SPEC.md.

import { buildMeta } from './api-utils.js';
import { describe, it, expect } from 'vitest';

// ─── Smoke test (passes immediately) ─────────────────────────────────────────

describe('buildMeta for players endpoint', () => {
  it('source db with null ttl_seconds returns correct meta', () => {
    const meta = buildMeta('db', null);
    expect(meta.source).toBe('db');
    expect(meta.ttl_seconds).toBeNull();
    expect(meta.stale).toBe(false);
  });
});

// ─── GET /api/players — spec-driven RED tests (todo) ─────────────────────────

describe('GET /api/players', () => {
  it.todo('returns array of LAC players via player_team_stints join filtering by LAC team_id');
  it.todo('active_only=true by default — filters by is_active = true');
  it.todo('active_only=false returns all players including inactive');
  it.todo('each player object has id, first_name, last_name, position, jersey_number');
  it.todo('meta has all required fields: generated_at, source, stale, stale_reason, ttl_seconds');
});

// ─── GET /api/players/{id} — spec-driven RED tests (todo) ────────────────────

describe('GET /api/players/{id}', () => {
  it.todo('returns trend_summary:null and charts:{rolling_pts:[],rolling_ts:[]} when no rolling_player_stats rows exist');
  it.todo('returns trend_summary with pts_trend when rolling data is present');
  it.todo('charts.rolling_pts is array of {game_date, value} objects when data exists');
  it.todo('player not found returns 404 with error envelope {error:{code:"NOT_FOUND",message:...,details:{}}}');
  it.todo('meta has all required fields: generated_at, source, stale, stale_reason, ttl_seconds');
  it.todo('never returns zero for missing rolling data — null is used instead of 0');
});
