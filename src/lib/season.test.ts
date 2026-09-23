// src/lib/season.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => ({
  mockSql: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(),
}));

vi.mock('@/src/lib/db', () => ({
  sql: (...args: unknown[]) => mockSql(...args),
  LAC_NBA_TEAM_ID: 13,
}));

import { calendarSeasonId, getDisplaySeasonId, parseSeasonIdParam } from './season';

describe('calendarSeasonId', () => {
  it('maps Jan–Jul to the season that started the previous year', () => {
    expect(calendarSeasonId(new Date('2026-03-15T12:00:00Z'))).toBe(2025);
    expect(calendarSeasonId(new Date('2026-06-20T12:00:00Z'))).toBe(2025); // Finals
  });

  it('maps Aug–Dec to the season starting that year', () => {
    expect(calendarSeasonId(new Date('2026-09-23T12:00:00Z'))).toBe(2026);
    expect(calendarSeasonId(new Date('2026-12-01T12:00:00Z'))).toBe(2026);
  });
});

describe('parseSeasonIdParam', () => {
  it('returns undefined when absent, null when malformed, number when valid', () => {
    expect(parseSeasonIdParam(null)).toBeUndefined();
    expect(parseSeasonIdParam('')).toBeUndefined();
    expect(parseSeasonIdParam('abc')).toBeNull();
    expect(parseSeasonIdParam('99999')).toBeNull();
    expect(parseSeasonIdParam('2025')).toBe(2025);
  });
});

describe('getDisplaySeasonId', () => {
  beforeEach(() => mockSql.mockReset());

  it('returns the DB-derived season when available', async () => {
    mockSql.mockResolvedValueOnce([{ display_season_id: 2025 }]);
    await expect(getDisplaySeasonId()).resolves.toBe(2025);
    const text = (mockSql.mock.calls[0][0] as string[]).join('?');
    expect(text).toContain("lower(g.status) = 'final'");
    expect(text).toContain("AT TIME ZONE 'America/New_York'");
  });

  it('falls back to the calendar season when the DB has no LAC games', async () => {
    mockSql.mockResolvedValueOnce([{ display_season_id: null }]);
    await expect(getDisplaySeasonId()).resolves.toBe(calendarSeasonId());
  });
});
