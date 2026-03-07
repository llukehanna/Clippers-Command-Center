// src/lib/api-home.test.ts
// RED test scaffold for GET /api/home — covers API-02 and API-07.
// Route handler doesn't exist yet — these tests go GREEN in Plan 03.
// They document the expected contract from Docs/API_SPEC.md.

import { buildMeta } from './api-utils.js';
import { describe, it, expect } from 'vitest';

// ─── Smoke test (passes immediately) ─────────────────────────────────────────

describe('buildMeta for home endpoint', () => {
  it('source db with ttl_seconds 300 returns correct meta', () => {
    const meta = buildMeta('db', 300);
    expect(meta.source).toBe('db');
    expect(meta.ttl_seconds).toBe(300);
    expect(meta.stale).toBe(false);
  });
});

// ─── GET /api/home — spec-driven RED tests (todo) ────────────────────────────

describe('GET /api/home', () => {
  it.todo('team_snapshot has conference_seed:null (no standings table in DB)');
  it.todo('team_snapshot.net_rating is null when rolling_team_stats has no LAC rows');
  it.todo('team_snapshot.net_rating is populated from rolling_team_stats when rows exist');
  it.todo('last_10 computed from games table: wins and losses derived from score columns');
  it.todo('last_10.wins + last_10.losses <= 10 (at most 10 games considered)');
  it.todo('player_trends returns top 8 players by average minutes in last 10 LAC games');
  it.todo('player_trends returns fewer than 8 when box score data is sparse');
  it.todo('upcoming_game is null when no future LAC games exist in games table');
  it.todo('meta has all required fields: generated_at, source, stale, stale_reason, ttl_seconds');
  it.todo('meta.source is "mixed" when response combines DB and odds_provider data');
});
