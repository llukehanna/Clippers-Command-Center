// src/lib/api-insights.test.ts
// RED test scaffold for GET /api/insights — covers API-06 and API-07.
// Route handler doesn't exist yet — these tests go GREEN in Plan 07 (or as part of Plan 02 live route).
// They document the expected contract from Docs/API_SPEC.md.

import { buildMeta } from './api-utils.js';
import { describe, it, expect } from 'vitest';

// ─── Smoke test (passes immediately) ─────────────────────────────────────────

describe('buildMeta for insights endpoint', () => {
  it('source db with ttl_seconds 60 returns correct meta', () => {
    const meta = buildMeta('db', 60);
    expect(meta.source).toBe('db');
    expect(meta.ttl_seconds).toBe(60);
    expect(meta.stale).toBe(false);
  });
});

// ─── GET /api/insights — spec-driven RED tests (todo) ────────────────────────

describe('GET /api/insights', () => {
  it.todo('returns only insights where is_active = true');
  it.todo('insights are sorted by importance DESC (highest importance first)');
  it.todo('scope param "live" filters to insights with scope = "live"');
  it.todo('scope param "home" filters to insights with scope = "home"');
  it.todo('scope param "history" filters to insights with scope = "history"');
  it.todo('omitting scope returns all is_active insights regardless of scope');
  it.todo('each insight has id, title, body, importance, scope, proof_hash, generated_at');
  it.todo('returns empty array when no is_active insights exist (not null, not error)');
  it.todo('meta has all required fields: generated_at, source, stale, stale_reason, ttl_seconds');
});
