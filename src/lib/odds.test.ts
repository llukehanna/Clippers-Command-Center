// src/lib/odds.test.ts
// Unit tests for getLatestOdds query helper (ODDS-02, ODDS-03).
// The sql template tag is mocked so tests run without a live DB connection.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the DB module before importing getLatestOdds ─────────────────────────

vi.mock('./db.js', () => {
  const mockSql = vi.fn();
  return { sql: mockSql };
});

import { getLatestOdds } from './odds.js';
import { sql } from './db.js';

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFreshSnapshot() {
  return {
    spread_home: -3.5,
    spread_away: 3.5,
    moneyline_home: -150,
    moneyline_away: 130,
    total_points: 220.5,
    captured_at: new Date().toISOString(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getLatestOdds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no snapshot exists for game_id', async () => {
    // sql returns empty array — no rows found
    mockSql.mockResolvedValueOnce([]);
    const result = await getLatestOdds('12345');
    expect(result).toBeNull();
  });

  it('returns null when the most recent snapshot is older than 24 hours', async () => {
    // The query filters captured_at > now() - INTERVAL '24 hours' in SQL.
    // If the only row is stale, the DB returns no rows.
    mockSql.mockResolvedValueOnce([]);
    const result = await getLatestOdds('99999');
    expect(result).toBeNull();
  });

  it('returns an OddsSnapshot when a fresh snapshot exists', async () => {
    const row = makeFreshSnapshot();
    mockSql.mockResolvedValueOnce([row]);
    const result = await getLatestOdds('42');
    expect(result).not.toBeNull();
    expect(result).toEqual(row);
  });

  it('returned OddsSnapshot.captured_at is a string (ISO format)', async () => {
    const row = makeFreshSnapshot();
    mockSql.mockResolvedValueOnce([row]);
    const result = await getLatestOdds('42');
    expect(typeof result?.captured_at).toBe('string');
    // Verify it looks like an ISO 8601 timestamp
    expect(result?.captured_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns null (not throws) when called with a game_id that has no rows at all', async () => {
    mockSql.mockResolvedValueOnce([]);
    await expect(getLatestOdds('nonexistent')).resolves.toBeNull();
  });

  it('returns the fresh row when a stale row and fresh row exist (fresh wins via ORDER BY + LIMIT 1)', async () => {
    // The SQL query orders by captured_at DESC LIMIT 1 and filters within 24h.
    // If a fresh row exists it would be the first result after filtering.
    // We simulate this: the mock returns only the fresh row (stale filtered by SQL).
    const freshRow = makeFreshSnapshot();
    mockSql.mockResolvedValueOnce([freshRow]);
    const result = await getLatestOdds('777');
    expect(result).toEqual(freshRow);
    expect(result).not.toBeNull();
  });

  it('returns all six expected fields on a fresh snapshot', async () => {
    const row = makeFreshSnapshot();
    mockSql.mockResolvedValueOnce([row]);
    const result = await getLatestOdds('42');
    expect(result).toHaveProperty('spread_home');
    expect(result).toHaveProperty('spread_away');
    expect(result).toHaveProperty('moneyline_home');
    expect(result).toHaveProperty('moneyline_away');
    expect(result).toHaveProperty('total_points');
    expect(result).toHaveProperty('captured_at');
  });

  it('returns null fields correctly when bookmaker omits a market', async () => {
    const partialRow = {
      spread_home: null,
      spread_away: null,
      moneyline_home: -110,
      moneyline_away: -110,
      total_points: null,
      captured_at: new Date().toISOString(),
    };
    mockSql.mockResolvedValueOnce([partialRow]);
    const result = await getLatestOdds('55');
    expect(result?.spread_home).toBeNull();
    expect(result?.spread_away).toBeNull();
    expect(result?.total_points).toBeNull();
    expect(result?.moneyline_home).toBe(-110);
  });
});
