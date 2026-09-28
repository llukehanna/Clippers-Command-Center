// scripts/lib/feed-probe-summary.ts
// Pure summary of feed-probe records (scripts/dev/feed-probe.ts): per source,
// how often content changed, what the CDN says about caching, and how long
// after the real play the feed first showed it. Sets the Live v2 cadence
// constants (spec §3, §10).

export interface ProbeRecord {
  t: number;                    // ms epoch when the response arrived
  source: string;               // nba_pbp | nba_pbp_conditional | nba_box | nba_scoreboard | espn_*
  status: number;               // HTTP status; 0 = network error
  conditional: boolean;         // request carried If-None-Match
  bytes: number;
  hash: string | null;          // sha1 of the body; null on 304 / error
  cacheControl: string | null;
  age: number | null;           // Age header, seconds
  etag: string | null;
  lastModified: string | null;
  newestEventAt: number | null; // ms epoch of the newest play in the body
}

export interface SourceSummary {
  source: string;
  requests: number;
  errors: number;
  notModified: number;
  changes: number;
  medianChangeIntervalMs: number | null;
  maxAges: number[];
  hasEtag: boolean;
  hasLastModified: boolean;
  lagP50Ms: number | null;
  lagP95Ms: number | null;
  medianBytes: number;
}

/** Nearest-rank percentile; null for an empty list. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

export function maxAgeSeconds(cacheControl: string | null): number | null {
  const m = cacheControl?.match(/(?:^|,)\s*max-age=(\d+)/i);
  return m ? Number(m[1]) : null;
}

export function summarizeProbe(records: ProbeRecord[]): SourceSummary[] {
  const bySource = new Map<string, ProbeRecord[]>();
  for (const r of records) {
    const list = bySource.get(r.source) ?? [];
    list.push(r);
    bySource.set(r.source, list);
  }

  const out: SourceSummary[] = [];
  for (const [source, list] of bySource) {
    const rs = [...list].sort((a, b) => a.t - b.t);
    let prevHash: string | null = null;
    const changeTimes: number[] = [];
    const firstSeen = new Map<number, number>();
    for (const r of rs) {
      if (r.hash) {
        if (prevHash !== null && r.hash !== prevHash) changeTimes.push(r.t);
        prevHash = r.hash;
      }
      if (r.newestEventAt !== null && !firstSeen.has(r.newestEventAt)) firstSeen.set(r.newestEventAt, r.t);
    }
    const intervals = changeTimes.slice(1).map((t, i) => t - changeTimes[i]);
    // The first newest-play value was already on the feed when probing began.
    const lags = [...firstSeen.entries()].slice(1).map(([eventAt, seenAt]) => seenAt - eventAt);
    const maxAges = new Set<number>();
    for (const r of rs) {
      const v = maxAgeSeconds(r.cacheControl);
      if (v !== null) maxAges.add(v);
    }
    out.push({
      source,
      requests: rs.length,
      errors: rs.filter((r) => r.status === 0 || r.status >= 400).length,
      notModified: rs.filter((r) => r.status === 304).length,
      changes: changeTimes.length,
      medianChangeIntervalMs: percentile(intervals, 50),
      maxAges: [...maxAges].sort((a, b) => a - b),
      hasEtag: rs.some((r) => r.etag),
      hasLastModified: rs.some((r) => r.lastModified),
      lagP50Ms: percentile(lags, 50),
      lagP95Ms: percentile(lags, 95),
      medianBytes: percentile(rs.filter((r) => r.status === 200).map((r) => r.bytes), 50) ?? 0,
    });
  }
  return out.sort((a, b) => a.source.localeCompare(b.source));
}

export function formatSummary(rows: SourceSummary[]): string {
  const ms = (v: number | null) => (v === null ? '—' : `${(v / 1000).toFixed(1)}s`);
  const header = 'source                req  err  304  changes  every   max-age   etag  lag p50  lag p95  bytes';
  const lines = rows.map((r) =>
    [
      r.source.padEnd(20),
      String(r.requests).padStart(5),
      String(r.errors).padStart(4),
      String(r.notModified).padStart(4),
      String(r.changes).padStart(8),
      ms(r.medianChangeIntervalMs).padStart(6),
      (r.maxAges.join(',') || '—').padStart(9),
      (r.hasEtag ? 'yes' : 'no').padStart(5),
      ms(r.lagP50Ms).padStart(8),
      ms(r.lagP95Ms).padStart(8),
      String(r.medianBytes).padStart(7),
    ].join(' ')
  );
  return [header, ...lines].join('\n');
}
