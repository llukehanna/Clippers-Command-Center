import { describe, it, expect } from 'vitest';
import { resolveRecordsStart } from './records-start';

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
