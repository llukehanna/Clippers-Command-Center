import { describe, it, expect } from 'vitest';
import { addDays, daysBetween, fmtDate, isIsoDate, laToday, monthYear, yearsBetween } from './dates';
import { careerComplete, parseRecordsStart, recordsSeasons, renderSeason, seasonStartDate } from './records';
import { factKey, phrasingIndex } from './keys';
import { combineProof, selectProofRows, shiftPlaceholders, withRef } from './proof';
import { COMPLETED_SEASON, makeFact } from './__fixtures__/facts';

describe('dates', () => {
  it('validates ISO dates', () => {
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-1-2')).toBe(false);
  });
  it('does day and year math', () => {
    expect(daysBetween('2026-01-01', '2026-01-15')).toBe(14);
    expect(daysBetween('2026-01-15', '2026-01-01')).toBe(-14);
    expect(yearsBetween('2020-03-01', '2026-03-01')).toBeCloseTo(6, 2);
    expect(addDays('2026-02-27', 3)).toBe('2026-03-02');
  });
  it('formats dates for copy', () => {
    expect(fmtDate('2025-12-28')).toBe('Dec 28, 2025');
    expect(monthYear('2021-03-04')).toBe('Mar 2021');
  });
  it('uses the Los Angeles calendar date', () => {
    expect(laToday(new Date('2026-11-18T07:30:00Z'))).toBe('2026-11-17');
    expect(laToday(new Date('2026-11-18T09:00:00Z'))).toBe('2026-11-18');
  });
});

describe('records', () => {
  it('reads the stored { season_id, label } shape and the legacy number', () => {
    expect(parseRecordsStart({ season_id: 2020, label: '2020-21' })).toEqual({ season_id: 2020, label: '2020-21' });
    expect(parseRecordsStart({ season_id: 2020 })).toEqual({ season_id: 2020, label: '2020-21' });
    expect(parseRecordsStart(2019)).toEqual({ season_id: 2019, label: '2019-20' });
    expect(parseRecordsStart(null)).toBeNull();
    expect(parseRecordsStart('2020')).toBeNull();
    expect(parseRecordsStart({})).toBeNull();
  });
  it('dates a season start and counts seasons of records', () => {
    expect(seasonStartDate(2020)).toBe('2020-11-01');
    expect(recordsSeasons({ season_id: 2020, label: '2020-21' }, 2026)).toBe(7);
    expect(recordsSeasons({ season_id: 2026, label: '2026-27' }, 2025)).toBe(1);
  });
});

describe('careerComplete', () => {
  const start = { season_id: 1996, label: '1996-97' };
  it('needs the first recorded season strictly after the records start', () => {
    expect(careerComplete(1996, start)).toBe(false);
    expect(careerComplete(1997, start)).toBe(true);
    expect(careerComplete(1990, start)).toBe(false);
    expect(careerComplete(1997, null)).toBe(false);
    expect(careerComplete(null, start)).toBe(false);
  });
});

describe('factKey', () => {
  it('is stable and ignores values that change nightly', () => {
    const a = makeFact();
    expect(factKey(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(factKey({ ...a, value: 9, context: { date: '2026-03-01' } })).toBe(factKey(a));
  });
  it('differs by surface, subject, stat, window and key extra', () => {
    const a = makeFact();
    const k = factKey(a);
    expect(factKey({ ...a, surface: 'player' })).not.toBe(k);
    expect(factKey({ ...a, subject: { ...a.subject, id: '2' } })).not.toBe(k);
    expect(factKey({ ...a, stat: 'scoring_20' })).not.toBe(k);
    expect(factKey({ ...a, window: { ...a.window, season_id: 2024 } })).not.toBe(k);
    expect(factKey({ ...a, keyExtra: '1500' })).not.toBe(k);
  });
  it('picks a stable phrasing index below n', () => {
    const k = factKey(makeFact());
    expect(phrasingIndex(k, 3)).toBe(parseInt(k.slice(0, 8), 16) % 3);
    expect(phrasingIndex(k, 1)).toBe(0);
  });
});

describe('proof SQL', () => {
  it('shifts placeholders', () => {
    expect(shiftPlaceholders('a = $1 AND b = $12', 3)).toBe('a = $4 AND b = $15');
    expect(shiftPlaceholders('a = $1', 0)).toBe('a = $1');
  });
  it('wraps a reference set and binds new params after it', () => {
    const q = withRef({ sql: 'SELECT 1 AS value WHERE 7 = $1::int', params: [7] },
      (bind) => `SELECT * FROM ref WHERE value >= ${bind(5, 'float8')}`);
    expect(q.sql).toBe('WITH ref AS (\nSELECT 1 AS value WHERE 7 = $1::int\n)\nSELECT * FROM ref WHERE value >= $2::float8');
    expect(q.params).toEqual([7, 5]);
  });
  it('combines fact and frame proofs into one statement', () => {
    const q = combineProof({ sql: 'SELECT $1::int AS a', params: [1] }, { sql: 'SELECT $1::int AS b', params: [2] });
    expect(q.sql).toBe(
      "WITH fact_rows AS (\nSELECT $1::int AS a\n),\nframe_rows AS (\nSELECT $2::int AS b\n)\n" +
      "SELECT 'fact'::text AS part, to_jsonb(fact_rows) AS data FROM fact_rows\nUNION ALL\n" +
      "SELECT 'frame'::text AS part, to_jsonb(frame_rows) AS data FROM frame_rows");
    expect(q.params).toEqual([1, 2]);
    const factOnly = combineProof({ sql: 'SELECT $1::int AS a', params: [1] }, null);
    expect(factOnly.sql).not.toContain('UNION ALL');
    expect(factOnly.params).toEqual([1]);
  });
  it('keeps the claim’s own fact rows and every frame row', () => {
    const rows = [
      { part: 'fact' as const, data: { player_id: '1', streak: 5 } },
      { part: 'fact' as const, data: { player_id: '2', streak: 4 } },
      { part: 'frame' as const, data: { end_date: '2021-01-10' } },
    ];
    expect(selectProofRows(rows, { player_id: '1' })).toEqual([rows[0], rows[2]]);
    expect(selectProofRows(rows, {})).toEqual(rows);
    expect(selectProofRows(rows, { player_id: '9' })).toBeNull();
  });
});

describe('renderSeason', () => {
  it('words a fact by its own season, not the stats season', () => {
    expect(renderSeason(2026, COMPLETED_SEASON, '2026-11-05', '2026-11-04'))
      .toEqual({ id: 2026, label: '2026-27', isCurrent: true, phrase: 'this season', lastGameDate: '2026-11-04' });
    expect(renderSeason(2025, COMPLETED_SEASON, '2026-11-05', '2026-02-01')).toBe(COMPLETED_SEASON);
    expect(renderSeason(null, COMPLETED_SEASON, '2026-11-05', '2026-02-01')).toBe(COMPLETED_SEASON);
    expect(renderSeason(2024, COMPLETED_SEASON, '2026-11-05', '2025-03-01'))
      .toMatchObject({ id: 2024, isCurrent: false, phrase: 'in 2024-25' });
  });
});
