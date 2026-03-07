// src/lib/api-schedule.test.ts
// RED test scaffold for GET /api/schedule — covers API-04 and API-07.
// Route handler doesn't exist yet — these tests go GREEN in Plan 05.
// They document the expected contract from Docs/API_SPEC.md.

import { buildMeta } from './api-utils.js';
import { describe, it, expect } from 'vitest';

// ─── Smoke test (passes immediately) ─────────────────────────────────────────

describe('buildMeta for schedule endpoint', () => {
  it('source db with ttl_seconds 3600 returns correct meta', () => {
    const meta = buildMeta('db', 3600);
    expect(meta.source).toBe('db');
    expect(meta.ttl_seconds).toBe(3600);
    expect(meta.stale).toBe(false);
  });
});

// ─── GET /api/schedule — spec-driven RED tests (todo) ────────────────────────

describe('GET /api/schedule', () => {
  it.todo('returns only games with game_date >= today (no past games in default response)');
  it.todo('each game object has id, game_date, home_team, away_team, status');
  it.todo('odds is null when no odds_snapshot exists for a game within 24 hours');
  it.todo('odds is populated with spread_home, spread_away, moneyline_home, moneyline_away, total_points when snapshot exists');
  it.todo('games are ordered by game_date ASC (soonest first)');
  it.todo('returns empty games array when no upcoming LAC games exist');
  it.todo('meta has all required fields: generated_at, source, stale, stale_reason, ttl_seconds');
  it.todo('meta.source is "mixed" when odds data is included alongside DB schedule data');
  it.todo('meta.source is "db" when no odds data is present');
});
