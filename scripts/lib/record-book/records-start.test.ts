import { describe, it, expect } from 'vitest';
import { resolvePbpRecordsStart, resolveRecordsStart } from './records-start';

const cov = (pairs: [number, number][]) => pairs.map(([season_id, games_with_box]) => ({ season_id, games_with_box }));

describe('resolveRecordsStart', () => {
  it('walks back from the latest complete season while seasons stay complete', () => {
    expect(resolveRecordsStart(cov([[2024, 900], [2025, 900], [2026, 1], [2015, 1]]), null)).toBe(2024);
  });
  it('stops at a gap', () => {
    expect(resolveRecordsStart(cov([[2020, 1080], [2022, 1230], [2023, 1230], [2024, 1230]]), null)).toBe(2022);
  });
  it('counts a lockout season (725 games) as complete', () => {
    expect(resolveRecordsStart(cov([[1997, 1189], [1998, 725], [1999, 1189]]), null)).toBe(1997);
  });
  it('never reaches past the last successfully backfilled season', () => {
    expect(resolveRecordsStart(cov([[2008, 1230], [2009, 800], [2010, 1230], [2011, 990]]), 2010)).toBe(2010);
  });
  it('is null with no complete season', () => {
    expect(resolveRecordsStart(cov([[2026, 40]]), null)).toBeNull();
  });
});

const pbp = (rows: [number, number, number][]) => rows.map(([season_id, games, with_flow]) => ({ season_id, games, with_flow }));

describe('resolvePbpRecordsStart', () => {
  it('walks back from the latest complete season while the previous season is complete', () => {
    expect(resolvePbpRecordsStart(pbp([[2023, 82, 82], [2024, 82, 80], [2025, 82, 82], [2026, 10, 10]]))).toBe(2023);
  });
  it('stops at a gap (a season with no Clippers games counted)', () => {
    expect(resolvePbpRecordsStart(pbp([[2020, 72, 72], [2022, 82, 82], [2023, 82, 82]]))).toBe(2022);
  });
  it('a season below 95% coverage breaks the chain', () => {
    // 77/82 = 93.9%
    expect(resolvePbpRecordsStart(pbp([[2021, 82, 82], [2022, 82, 77], [2023, 82, 82], [2024, 82, 82]]))).toBe(2023);
  });
  it('the latest season can be incomplete; the chain ends at the latest complete one', () => {
    expect(resolvePbpRecordsStart(pbp([[2024, 82, 82], [2025, 82, 82], [2026, 20, 5]]))).toBe(2024);
  });
  it('ignores seasons without games', () => {
    expect(resolvePbpRecordsStart(pbp([[2025, 0, 0], [2026, 1, 1]]))).toBe(2026);
  });
  it('is null when no season is complete', () => {
    expect(resolvePbpRecordsStart(pbp([[2025, 82, 40]]))).toBeNull();
    expect(resolvePbpRecordsStart([])).toBeNull();
  });
});
