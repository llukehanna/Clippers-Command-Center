// src/lib/api-history.test.ts
// RED test scaffold for GET /api/history/games and GET /api/history/games/{id} — covers API-05 and API-07.
// Route handlers don't exist yet — these tests go GREEN in Plan 06.
// They document the expected contract from Docs/API_SPEC.md.

import { buildMeta } from './api-utils.js';
import { describe, it, expect } from 'vitest';

// ─── Smoke test (passes immediately) ─────────────────────────────────────────

describe('buildMeta for history endpoint', () => {
  it('source db with ttl_seconds 86400 returns correct meta', () => {
    const meta = buildMeta('db', 86400);
    expect(meta.source).toBe('db');
    expect(meta.ttl_seconds).toBe(86400);
    expect(meta.stale).toBe(false);
  });
});

// ─── GET /api/history/games — spec-driven RED tests (todo) ───────────────────

describe('GET /api/history/games', () => {
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
