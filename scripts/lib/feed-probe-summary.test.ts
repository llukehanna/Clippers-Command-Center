import { describe, it, expect } from 'vitest';
import { maxAgeSeconds, percentile, summarizeProbe, type ProbeRecord } from './feed-probe-summary.js';

function rec(t: number, over: Partial<ProbeRecord> = {}): ProbeRecord {
  return {
    t, source: 'nba_pbp', status: 200, conditional: false, bytes: 100, hash: 'a',
    cacheControl: 'public, max-age=5', age: 1, etag: '"x"', lastModified: null, newestEventAt: null,
    ...over,
  };
}

describe('percentile', () => {
  it('returns null for no values and nearest-rank otherwise', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5, 1, 3], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });
});

describe('maxAgeSeconds', () => {
  it('reads max-age but not s-maxage', () => {
    expect(maxAgeSeconds('public, max-age=5')).toBe(5);
    expect(maxAgeSeconds('s-maxage=30')).toBeNull();
    expect(maxAgeSeconds(null)).toBeNull();
  });
});

describe('summarizeProbe', () => {
  it('counts content changes, change intervals, 304s, errors and cache TTLs per source', () => {
    const rows = summarizeProbe([
      rec(0, { hash: 'a' }),
      rec(1000, { hash: 'a' }),
      rec(2000, { hash: 'b' }),
      rec(3000, { status: 304, hash: null, conditional: true }),
      rec(4000, { hash: 'b' }),
      rec(6000, { hash: 'c', cacheControl: 'max-age=3' }),
      rec(7000, { status: 403, hash: null }),
      rec(0, { source: 'espn_summary', etag: null, cacheControl: 'max-age=1' }),
    ]);
    const pbp = rows.find((r) => r.source === 'nba_pbp')!;
    expect(pbp.requests).toBe(7);
    expect(pbp.changes).toBe(2);                    // a→b at 2000, b→c at 6000
    expect(pbp.medianChangeIntervalMs).toBe(4000);
    expect(pbp.notModified).toBe(1);
    expect(pbp.errors).toBe(1);
    expect(pbp.maxAges).toEqual([3, 5]);
    expect(pbp.hasEtag).toBe(true);
    const espn = rows.find((r) => r.source === 'espn_summary')!;
    expect(espn.hasEtag).toBe(false);
    expect(espn.maxAges).toEqual([1]);
  });

  it('measures lag from the real play to the first time the feed showed it, skipping the play already visible at start', () => {
    const rows = summarizeProbe([
      rec(10_000, { newestEventAt: 1_000 }),   // already there when probing began: skipped
      rec(11_000, { newestEventAt: 1_000 }),
      rec(14_000, { newestEventAt: 12_000 }),  // lag 2000
      rec(15_000, { newestEventAt: 12_000 }),
      rec(21_000, { newestEventAt: 17_000 }),  // lag 4000
    ]);
    expect(rows[0].lagP50Ms).toBe(2000);
    expect(rows[0].lagP95Ms).toBe(4000);
  });
});
