# Live v2 — Plan 1: Feed Probe + Adaptive Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure the live feeds, then replace the game-night runner's fixed 12-second loop with an adaptive, change-driven poller. It writes one `live_state` row per game, which `/api/live` serves through Vercel's CDN, and clients poll at the cadence the runner advertises.

**Architecture:** Four pure modules and two thin shells:
- `live-cadence.ts` picks the game phase and the next poll delay.
- `live-state.ts` builds the `LiveStateDoc` and its fingerprint.
- `live-poller.ts` is one tick: fetch what's due, derive, save on change.
- `live-store.ts` holds the DB writes.
- The shells are `scripts/game-night.ts` and `/api/cron/poll-live`, both driven by `createPoller`.

`/api/live` keeps its response contract. It reads the one `live_state` row instead of rebuilding from `live_snapshots`, and adds `cadence` plus CDN cache headers.

**Tech Stack:** TypeScript (tsx scripts, ESM), postgres.js, Next.js 16 route handlers, SWR, Vitest, GitHub Actions.

**Spec:** `Docs/superpowers/specs/2026-09-27-live-v2-realtime-design.md` (§1, §3, §4, §5, §6.2 poll tier, §10 phase 0). Plan 1 of 3 — see "Plan series" at the end.

## Global Constraints

- Git tracks documentation under `Docs/` (capital D). Always use `Docs/...` paths in code, workflows and commits.
- Script imports use ESM `.js` suffixes (`import { x } from './lib/y.js'`).
- Modules imported by unit tests must not import `scripts/lib/db.ts` (it calls `process.exit` without `DATABASE_URL`). Keep pure logic in DB-free files; the DB client is always passed in.
- No new npm dependencies in this plan.
- Cadence constants (spec §3), until the probe (Task 1) says otherwise: PREGAME scoreboard 30 s · TIP_WATCH 10 s · LIVE 3 s · CLUTCH 2 s · STOPPAGE 8 s · HALFTIME 30 s for 10 min then 8 s · scoreboard refresh while live 60 s · backoff 3 → 6 → 12 → 24 → 60 s ±20 % jitter · CDN freshness floor capped at 15 s · clutch = period ≥ 4, ≤ 5:00 left, margin ≤ 10.
- The runner writes `live_state` at least every 15 s (heartbeat) so `/api/live` can tell a quiet game from a dead runner. Stale threshold: `max(30 s, cadence.next_ms + 20 s)`.
- `/api/live` cache headers: LIVE/DATA_DELAYED `Vercel-CDN-Cache-Control: max-age=2, stale-while-revalidate=10`; NO_ACTIVE_GAME `max-age=30, stale-while-revalidate=60`; browsers always get `Cache-Control: public, max-age=0, must-revalidate`; errors stay `no-store`.
- Integration tests need a local Postgres: `docker run -d --name ccc-fixture-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16`, then `createdb -h 127.0.0.1 -U postgres fixture`. Run with `FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/fixture npx vitest run scripts/lib/pipeline.integration.test.ts`.
- **Production writes and pushes need Luke's explicit go-ahead in chat** (migration, pushing branches, merging). Everything else runs locally / against the fixture DB.
- Work in a separate worktree: the main checkout is in use by the insights v2 session. Branch `live/v2-realtime` from `main` (see Task 0).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Coordination with the insights v2 plans

- Insights Plan 1 Task 5 adds a play-by-play ingest call right after `finalizeGame` in `scripts/game-night.ts`. This plan rewrites `pollLoop` in the same file (Task 7). Whichever merges second keeps both: the new `pollLoop` below calls `finalizeGame` in one place, and the ingest call goes right after it.
- Insights Plan 1 creates `pbp_events` and the `scripts/lib/pbp/` normalizer. This plan does not touch either.
- `src/lib/insights/live.ts` reads the latest `live_snapshots` row for its proof query. After this plan, that table gets a row per period end and at final (Task 5), so those proofs keep resolving until insights Plan 6 moves live generation into the runner.

## File Structure

| File | Responsibility |
|---|---|
| `scripts/lib/feed-probe-summary.ts` (create) | Pure: summarize probe records per source |
| `scripts/dev/feed-probe.ts` (create) | Spike: poll NBA + ESPN feeds each second, write NDJSON, print summary |
| `.github/workflows/feed-probe.yml` (create) | Run the probe on a GitHub runner (NBA CDN blocks Luke's home IP) |
| `scripts/lib/nba-live-client.ts` (modify) | `nbaGetConditional`, `parseFreshness`, `NbaHttpError`, conditional pbp/box fetchers |
| `src/lib/types/live.ts` (modify) | `PlayByPlayAction.timeActual`, `shotResult` |
| `src/lib/types/live-state.ts` (create) | `LivePhase`, `LivePlay`, `LiveStateDoc` — shared by runner and route |
| `scripts/lib/live-cadence.ts` (create) | Pure: `classifyPhase`, `nextDelayMs`, `isPeriodEnd`, constants |
| `scripts/lib/live-state.ts` (create) | Pure: `buildLiveState`, `fingerprint`, `lastPlays`, `toLivePlay` |
| `scripts/lib/live-fixtures.ts` (create) | DB-free test fixtures (actions, box scores, scoreboards, docs) |
| `scripts/lib/live-poller.ts` (create) | Pure orchestration: `createPoller(...).tick()` |
| `scripts/lib/live-store.ts` (create) | DB: `loadLiveSeq`, `saveLiveState`, `saveLiveMoment` |
| `scripts/lib/live-deps.ts` (create) | Wires real fetchers + store into `PollerDeps` |
| `scripts/lib/live-cycle.ts` (modify) | Keep `findLiveCandidates`, `LiveCandidate`, `scoreboardStatus`; delete `runLiveCycle`, `SnapshotPayload` |
| `scripts/game-night.ts` (modify) | Poll loop driven by `createPoller` |
| `app/api/cron/poll-live/route.ts` (modify) | One `tick()` per request |
| `scripts/dev/live-dry-run.ts` (create) | Run the poller against a real game with no DB (prints ticks) |
| `Docs/DB_SCHEMA.sql`, `Docs/migrations/2026-10-live-v2.sql` (create/modify) | `live_state` table |
| `Docs/DATA_DICTIONARY.md` (modify) | Document `live_state`, the new `live_snapshots` cadence |
| `src/lib/live-utils.ts` (modify) | `staleThresholdMs`, `livePollInterval` |
| `app/api/live/route.ts` (modify) | Read `live_state`; cadence passthrough; CDN headers |
| `src/lib/ui/types.ts` (modify) | `LivePayload.cadence` |
| `hooks/useLiveData.ts` (modify) | Poll at the runner's advertised cadence |

---

### Task 0: Worktree

- [ ] **Step 1: Create the worktree and bring the spec and plan along**

```bash
cd "/Users/luke/Claude Projects/CCC"
git worktree add -b live/v2-realtime "../CCC-live-v2" main
cd "../CCC-live-v2"
git checkout insights/espn-engine -- Docs/superpowers/specs/2026-09-27-live-v2-realtime-design.md Docs/superpowers/plans/2026-09-27-live-v2-plan-1-runner.md
cp "../CCC/.env.local" .env.local
npm ci
npm test
```

Expected: `npm test` passes on a clean `main`.

- [ ] **Step 2: Commit**

```bash
git add Docs/superpowers
git commit -m "docs: Live v2 spec and plan 1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Feed probe (spike tooling)

**Files:**
- Create: `scripts/lib/feed-probe-summary.ts`, `scripts/lib/feed-probe-summary.test.ts`, `scripts/dev/feed-probe.ts`, `.github/workflows/feed-probe.yml`

**Interfaces:**
- Produces: `ProbeRecord`, `SourceSummary`, `percentile(values: number[], p: number): number | null`, `maxAgeSeconds(cc: string | null): number | null`, `summarizeProbe(records: ProbeRecord[]): SourceSummary[]`, `formatSummary(rows: SourceSummary[]): string`.

- [ ] **Step 1: Write the failing test**

Create `scripts/lib/feed-probe-summary.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run scripts/lib/feed-probe-summary.test.ts`
Expected: FAIL — cannot find module `./feed-probe-summary.js`.

- [ ] **Step 3: Implement the summarizer**

Create `scripts/lib/feed-probe-summary.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/lib/feed-probe-summary.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the probe script**

Create `scripts/dev/feed-probe.ts`:

```ts
// scripts/dev/feed-probe.ts
// Live v2 spike (spec §10): during a live game, polls the NBA CDN and ESPN
// feeds once a second for --minutes, records caching headers, content hashes
// and the newest play's real-world time, writes NDJSON, and prints a summary.
// Throwaway tooling — run on a GitHub runner (.github/workflows/feed-probe.yml);
// the NBA CDN blocks some residential IPs.
//   npx tsx scripts/dev/feed-probe.ts [--minutes=20] [--nba-game=auto|0022600001] [--out=feed-probe.ndjson]

import { createHash } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import { formatSummary, summarizeProbe, type ProbeRecord } from '../lib/feed-probe-summary.js';

const NBA = 'https://cdn.nba.com/static/json/liveData';
const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const ESPN_CORE = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba';
const NBA_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  Referer: 'https://www.nba.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};
// ESPN abbreviations that differ from NBA tricodes.
const ESPN_ALIAS: Record<string, string> = { GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS', PHO: 'PHX' };

const arg = (name: string, fallback: string): string =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] || fallback;
const minutes = Number(arg('minutes', '20'));
const out = arg('out', 'feed-probe.ndjson');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Newest = (body: unknown) => number | null;
const none: Newest = () => null;
const maxTime = (times: Array<string | undefined>): number | null => {
  const ms = times.filter((t): t is string => Boolean(t)).map((t) => Date.parse(t)).filter(Number.isFinite);
  return ms.length ? Math.max(...ms) : null;
};
const nbaNewest: Newest = (b) => {
  const actions = (b as { game?: { actions?: Array<{ timeActual?: string }> } }).game?.actions ?? [];
  return maxTime(actions.slice(-5).map((a) => a.timeActual));
};
const espnSummaryNewest: Newest = (b) =>
  maxTime(((b as { plays?: Array<{ wallclock?: string }> }).plays ?? []).map((p) => p.wallclock));
const espnCoreNewest: Newest = (b) =>
  maxTime(((b as { items?: Array<{ wallclock?: string }> }).items ?? []).map((p) => p.wallclock));

async function probe(
  source: string,
  url: string,
  headers: Record<string, string>,
  newest: Newest,
  prevEtag: string | null = null
): Promise<{ record: ProbeRecord; body: unknown }> {
  const base = { source, conditional: Boolean(prevEtag) };
  try {
    const res = await fetch(url, {
      headers: prevEtag ? { ...headers, 'If-None-Match': prevEtag } : headers,
      cache: 'no-store',
    });
    const text = res.status === 200 ? await res.text() : '';
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const age = res.headers.get('age');
    return {
      body,
      record: {
        ...base,
        t: Date.now(),
        status: res.status,
        bytes: text.length,
        hash: text ? createHash('sha1').update(text).digest('hex') : null,
        cacheControl: res.headers.get('cache-control'),
        age: age === null ? null : Number(age),
        etag: res.headers.get('etag'),
        lastModified: res.headers.get('last-modified'),
        newestEventAt: body ? newest(body) : null,
      },
    };
  } catch {
    return {
      body: null,
      record: { ...base, t: Date.now(), status: 0, bytes: 0, hash: null, cacheControl: null, age: null, etag: null, lastModified: null, newestEventAt: null },
    };
  }
}

interface NbaSbGame { gameId: string; gameStatus: number; homeTeam: { teamTricode: string }; awayTeam: { teamTricode: string } }
interface EspnEvent { id: string; competitions: Array<{ competitors: Array<{ team: { abbreviation: string } }> }> }

async function discover(): Promise<{ nba: string; espn: string | null }> {
  const sbRes = await fetch(`${NBA}/scoreboard/todaysScoreboard_00.json`, { headers: NBA_HEADERS });
  if (!sbRes.ok) throw new Error(`NBA scoreboard ${sbRes.status}`);
  const games = ((await sbRes.json()) as { scoreboard: { games: NbaSbGame[] } }).scoreboard.games;
  const wanted = arg('nba-game', 'auto');
  const game = wanted === 'auto' ? games.find((g) => g.gameStatus === 2) : games.find((g) => g.gameId === wanted);
  if (!game) throw new Error(wanted === 'auto' ? 'No live game on the NBA scoreboard right now' : `Game ${wanted} not on today's scoreboard`);

  const tricodes = new Set([game.homeTeam.teamTricode, game.awayTeam.teamTricode]);
  const espnRes = await fetch(`${ESPN_SITE}/scoreboard`);
  const events = espnRes.ok ? ((await espnRes.json()) as { events?: EspnEvent[] }).events ?? [] : [];
  const match = events.find((e) =>
    e.competitions[0]?.competitors.every((c) => tricodes.has(ESPN_ALIAS[c.team.abbreviation] ?? c.team.abbreviation))
  );
  return { nba: game.gameId, espn: match?.id ?? null };
}

async function main(): Promise<void> {
  const { nba, espn } = await discover();
  console.log(`[feed-probe] NBA ${nba}, ESPN ${espn ?? 'not found'}; ${minutes} min at 1/s → ${out}`);
  writeFileSync(out, '');
  const records: ProbeRecord[] = [];
  let pbpEtag: string | null = null;
  let corePage = 1;
  const end = Date.now() + minutes * 60_000;

  while (Date.now() < end) {
    const started = Date.now();
    const results = await Promise.all([
      probe('nba_pbp', `${NBA}/playbyplay/playbyplay_${nba}.json`, NBA_HEADERS, nbaNewest),
      probe('nba_pbp_conditional', `${NBA}/playbyplay/playbyplay_${nba}.json`, NBA_HEADERS, nbaNewest, pbpEtag),
      probe('nba_box', `${NBA}/boxscore/boxscore_${nba}.json`, NBA_HEADERS, none),
      probe('nba_scoreboard', `${NBA}/scoreboard/todaysScoreboard_00.json`, NBA_HEADERS, none),
      ...(espn
        ? [
            probe('espn_summary', `${ESPN_SITE}/summary?event=${espn}`, {}, espnSummaryNewest),
            probe('espn_core_status', `${ESPN_CORE}/events/${espn}/competitions/${espn}/status`, {}, none),
            probe('espn_core_plays', `${ESPN_CORE}/events/${espn}/competitions/${espn}/plays?limit=25&page=${corePage}`, {}, espnCoreNewest),
          ]
        : []),
    ]);
    for (const { record, body } of results) {
      records.push(record);
      appendFileSync(out, `${JSON.stringify(record)}\n`);
      if (record.source === 'nba_pbp' && record.etag) pbpEtag = record.etag;
      if (record.source === 'espn_core_plays' && body) {
        corePage = Math.max(1, (body as { pageCount?: number }).pageCount ?? corePage);
      }
    }
    await sleep(Math.max(0, 1000 - (Date.now() - started)));
  }
  console.log(formatSummary(summarizeProbe(records)));
}

main().catch((err) => {
  console.error('[feed-probe] Failed:', err);
  process.exit(1);
});
```

- [ ] **Step 6: Write the workflow**

Create `.github/workflows/feed-probe.yml`:

```yaml
name: Feed probe (spike)

# Live v2 spike (Docs/superpowers/specs/2026-09-27-live-v2-realtime-design.md §10).
# Polls the NBA CDN and ESPN live feeds once a second during a live game and
# uploads the raw records plus a summary. Triggered manually (needs this file on
# main) or by pushing any probe/** branch (auto-discovers the first live game).

on:
  workflow_dispatch:
    inputs:
      minutes:
        description: 'Minutes to probe'
        default: '20'
      nba_game:
        description: 'NBA game id (10 chars) or auto'
        default: 'auto'
  push:
    branches: ['probe/**']

permissions:
  contents: read

jobs:
  probe:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-node@v5
        with:
          node-version: '24'
          cache: 'npm'

      - run: npm ci

      - name: Probe feeds
        run: node node_modules/.bin/tsx scripts/dev/feed-probe.ts --minutes="${MINUTES}" --nba-game="${GAME}" --out=feed-probe.ndjson
        env:
          MINUTES: ${{ inputs.minutes || '20' }}
          GAME: ${{ inputs.nba_game || 'auto' }}

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: feed-probe
          path: feed-probe.ndjson
```

- [ ] **Step 7: Lint, test, commit**

Run: `npm run lint && npm test`
Expected: both pass.

```bash
git add scripts/lib/feed-probe-summary.ts scripts/lib/feed-probe-summary.test.ts scripts/dev/feed-probe.ts .github/workflows/feed-probe.yml
git commit -m "feat(live): feed probe spike for cadence measurement

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8 (operational, needs Luke): run the probe during a preseason game (Oct 3–20)**

Ask Luke before pushing. Once he approves, push when any NBA game is live:

```bash
git push origin HEAD:probe/feed-1
```

Then fetch the results: `gh run list --workflow feed-probe.yml --limit 1` and `gh run download <id> -n feed-probe`. Record the printed summary in the spec as a new §10.1 "Probe results". Then update the Global Constraints cadence line in this plan if either of these holds:
- `nba_pbp` max-age is above 3 s.
- `nba_pbp_conditional` never returned 304. The poller still works, but drop the "conditional requests" claim from the spec.

Delete the branch afterwards: `git push origin --delete probe/feed-1`.

---

### Task 2: Conditional fetches with freshness

**Files:**
- Modify: `scripts/lib/nba-live-client.ts` (after `fetchPlayByPlay`, ~line 478)
- Modify: `src/lib/types/live.ts:142-156` (`PlayByPlayAction`)
- Test: `scripts/lib/nba-live-client.test.ts`

**Interfaces:**
- Produces:
  - `interface Validators { etag?: string | null; lastModified?: string | null }`
  - `interface Freshness { maxAgeMs: number | null; ageMs: number }`
  - `type CondResult<T> = { status: 200; body: T; validators: Validators; freshness: Freshness } | { status: 304; validators: Validators; freshness: Freshness }`
  - `class NbaHttpError extends Error { status: number }`
  - `parseFreshness(headers: Headers): Freshness`
  - `nbaGetConditional<T>(path: string, prev?: Validators): Promise<CondResult<T>>`
  - `fetchPlayByPlayConditional(gameId: string, prev?: Validators): Promise<CondResult<NBAPlayByPlayResponse>>`
  - `fetchBoxscoreConditional(gameId: string, prev?: Validators): Promise<CondResult<NBABoxscoreResponse>>`
  - `PlayByPlayAction` gains `timeActual?: string` and `shotResult?: string`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/lib/nba-live-client.test.ts` (and add `vi, afterEach` to the vitest import, plus the new names to the `./nba-live-client.js` import):

```ts
import { afterEach, vi } from 'vitest';
import { nbaGetConditional, parseFreshness, NbaHttpError } from './nba-live-client.js';

describe('parseFreshness', () => {
  it('reads max-age and Age in milliseconds', () => {
    expect(parseFreshness(new Headers({ 'cache-control': 'public, max-age=5', age: '2' }))).toEqual({ maxAgeMs: 5000, ageMs: 2000 });
  });

  it('ignores s-maxage and tolerates missing headers', () => {
    expect(parseFreshness(new Headers({ 'cache-control': 's-maxage=30' }))).toEqual({ maxAgeMs: null, ageMs: 0 });
    expect(parseFreshness(new Headers())).toEqual({ maxAgeMs: null, ageMs: 0 });
  });
});

describe('nbaGetConditional', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the body, validators and freshness on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { etag: '"abc"', 'cache-control': 'max-age=3' } })
    ));
    const r = await nbaGetConditional<{ ok: number }>('/x.json');
    expect(r.status).toBe(200);
    if (r.status === 200) expect(r.body).toEqual({ ok: 1 });
    expect(r.validators.etag).toBe('"abc"');
    expect(r.freshness.maxAgeMs).toBe(3000);
  });

  it('sends If-None-Match and reports 304 with the previous validators kept', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)['If-None-Match']).toBe('"abc"');
      return new Response(null, { status: 304 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = await nbaGetConditional('/x.json', { etag: '"abc"', lastModified: null });
    expect(r.status).toBe(304);
    expect(r.validators.etag).toBe('"abc"');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('throws NbaHttpError carrying the status on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })));
    await expect(nbaGetConditional('/x.json')).rejects.toBeInstanceOf(NbaHttpError);
    await expect(nbaGetConditional('/x.json')).rejects.toMatchObject({ status: 403 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run scripts/lib/nba-live-client.test.ts`
Expected: FAIL — `nbaGetConditional` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/types/live.ts`, add two optional fields to `PlayByPlayAction` after `pointsTotal`:

```ts
  timeActual?: string;     // wall-clock time of the real play, ISO 8601 (cdn only)
  shotResult?: string;     // "Made" | "Missed" on shots
```

In `scripts/lib/nba-live-client.ts`, add the type imports `NBAPlayByPlayResponse` and `NBABoxscoreResponse` if they aren't imported already. Then, after `fetchPlayByPlay`, add:

```ts
// ── Conditional fetches (Live v2 runner) ─────────────────────────────────────

export interface Validators {
  etag?: string | null;
  lastModified?: string | null;
}

/** What the CDN says about how long this response stays fresh. */
export interface Freshness {
  maxAgeMs: number | null;
  ageMs: number;
}

export type CondResult<T> =
  | { status: 200; body: T; validators: Validators; freshness: Freshness }
  | { status: 304; validators: Validators; freshness: Freshness };

export class NbaHttpError extends Error {
  constructor(public readonly status: number, path: string) {
    super(`NBA CDN ${status}: ${path}`);
    this.name = 'NbaHttpError';
  }
}

export function parseFreshness(headers: Headers): Freshness {
  const m = (headers.get('cache-control') ?? '').match(/(?:^|,)\s*max-age=(\d+)/i);
  const age = Number(headers.get('age') ?? 0);
  return { maxAgeMs: m ? Number(m[1]) * 1000 : null, ageMs: Number.isFinite(age) ? age * 1000 : 0 };
}

/**
 * GET with If-None-Match / If-Modified-Since from the previous response.
 * A 304 means nothing changed since `prev`. Non-2xx/304 throws NbaHttpError.
 */
export async function nbaGetConditional<T>(path: string, prev?: Validators): Promise<CondResult<T>> {
  const headers: Record<string, string> = { ...(NBA_CDN_HEADERS as Record<string, string>) };
  if (prev?.etag) headers['If-None-Match'] = prev.etag;
  if (prev?.lastModified) headers['If-Modified-Since'] = prev.lastModified;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${NBA_CDN}${path}`, { signal: controller.signal, headers, cache: 'no-store' });
    const validators: Validators = {
      etag: res.headers.get('etag') ?? prev?.etag ?? null,
      lastModified: res.headers.get('last-modified') ?? prev?.lastModified ?? null,
    };
    const freshness = parseFreshness(res.headers);
    if (res.status === 304) return { status: 304, validators, freshness };
    if (!res.ok) throw new NbaHttpError(res.status, path);
    return { status: 200, body: (await res.json()) as T, validators, freshness };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error(`TIMEOUT after ${REQUEST_TIMEOUT_MS}ms: ${path}`);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export function fetchPlayByPlayConditional(gameId: string, prev?: Validators): Promise<CondResult<NBAPlayByPlayResponse>> {
  return nbaGetConditional<NBAPlayByPlayResponse>(`/playbyplay/playbyplay_${gameId}.json`, prev);
}

export function fetchBoxscoreConditional(gameId: string, prev?: Validators): Promise<CondResult<NBABoxscoreResponse>> {
  return nbaGetConditional<NBABoxscoreResponse>(`/boxscore/boxscore_${gameId}.json`, prev);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run scripts/lib/nba-live-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/nba-live-client.ts scripts/lib/nba-live-client.test.ts src/lib/types/live.ts
git commit -m "feat(live): conditional NBA CDN fetches with cache freshness

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Cadence state machine

**Files:**
- Create: `src/lib/types/live-state.ts` (only `LivePhase` in this task; the rest in Task 4)
- Create: `scripts/lib/live-cadence.ts`, `scripts/lib/live-cadence.test.ts`

**Interfaces:**
- Produces:
  - `type LivePhase = 'PREGAME' | 'TIP_WATCH' | 'LIVE' | 'CLUTCH' | 'STOPPAGE' | 'HALFTIME' | 'FINAL'` (in `src/lib/types/live-state.ts`)
  - `PHASE_DELAY_MS: Record<LivePhase, number>`, `HALFTIME_QUIET_MS`, `HALFTIME_QUIET_DELAY_MS`, `SCOREBOARD_EVERY_MS`, `NOT_LISTED_DELAY_MS`, `HEARTBEAT_MS`, `FRESHNESS_FLOOR_CAP_MS`
  - `interface LastAction { actionType: string; subType: string; period: number }`
  - `isPeriodEnd(a: LastAction | null): boolean`
  - `interface PhaseInput { gameStatus: number; now: number; tipAt: number | null; period: number; clockSec: number; margin: number; lastAction: LastAction | null }`
  - `classifyPhase(i: PhaseInput): LivePhase`
  - `interface DelayInput { phase: LivePhase; phaseSince: number; now: number; failures: number; notBeforeMs: number; random?: () => number }`
  - `nextDelayMs(i: DelayInput): number`

- [ ] **Step 1: Create the phase type**

Create `src/lib/types/live-state.ts`:

```ts
// src/lib/types/live-state.ts
// The live runner's derived state for one game (Live v2 spec §4). Written by
// scripts/lib/live-poller.ts into live_state.state, read by /api/live.
// Zero runtime imports — importable by scripts/ and src/.

/** Where the game is, as far as polling cadence is concerned (spec §3). */
export type LivePhase = 'PREGAME' | 'TIP_WATCH' | 'LIVE' | 'CLUTCH' | 'STOPPAGE' | 'HALFTIME' | 'FINAL';
```

- [ ] **Step 2: Write the failing tests**

Create `scripts/lib/live-cadence.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyPhase, isPeriodEnd, nextDelayMs, type PhaseInput } from './live-cadence.js';

const NOW = 1_000_000;
const base: PhaseInput = { gameStatus: 2, now: NOW, tipAt: NOW - 60_000, period: 1, clockSec: 600, margin: 0, lastAction: null };
const act = (actionType: string, subType = '', period = 1) => ({ actionType, subType, period });

describe('classifyPhase', () => {
  it('is PREGAME before the scheduled tip and TIP_WATCH after it', () => {
    expect(classifyPhase({ ...base, gameStatus: 1, tipAt: NOW + 60_000 })).toBe('PREGAME');
    expect(classifyPhase({ ...base, gameStatus: 1, tipAt: null })).toBe('PREGAME');
    expect(classifyPhase({ ...base, gameStatus: 1, tipAt: NOW - 1 })).toBe('TIP_WATCH');
  });

  it('is FINAL once the game is final', () => {
    expect(classifyPhase({ ...base, gameStatus: 3 })).toBe('FINAL');
  });

  it('is LIVE on a live-ball action', () => {
    expect(classifyPhase({ ...base, lastAction: act('2pt', 'jumpshot') })).toBe('LIVE');
  });

  it('is STOPPAGE on a timeout, a replay review, or the end of Q1/Q3', () => {
    expect(classifyPhase({ ...base, lastAction: act('timeout', 'full') })).toBe('STOPPAGE');
    expect(classifyPhase({ ...base, lastAction: act('instantreplay', 'request') })).toBe('STOPPAGE');
    expect(classifyPhase({ ...base, clockSec: 0, lastAction: act('period', 'end', 1) })).toBe('STOPPAGE');
    expect(classifyPhase({ ...base, period: 3, clockSec: 0, lastAction: act('period', 'end', 3) })).toBe('STOPPAGE');
  });

  it('is HALFTIME at the end of Q2', () => {
    expect(classifyPhase({ ...base, period: 2, clockSec: 0, lastAction: act('Period', 'End', 2) })).toBe('HALFTIME');
  });

  it('is CLUTCH late in a close game, even during a timeout, but not at the end of a period', () => {
    const late = { ...base, period: 4, clockSec: 240, margin: -7 };
    expect(classifyPhase({ ...late, lastAction: act('3pt', 'jumpshot', 4) })).toBe('CLUTCH');
    expect(classifyPhase({ ...late, lastAction: act('timeout', 'full', 4) })).toBe('CLUTCH');
    expect(classifyPhase({ ...late, clockSec: 0, margin: 0, lastAction: act('period', 'end', 4) })).toBe('STOPPAGE');
    expect(classifyPhase({ ...late, margin: 11, lastAction: act('2pt', '', 4) })).toBe('LIVE');
    expect(classifyPhase({ ...late, clockSec: 301, lastAction: act('2pt', '', 4) })).toBe('LIVE');
    expect(classifyPhase({ ...base, period: 5, clockSec: 300, margin: 0, lastAction: act('period', 'start', 5) })).toBe('CLUTCH');
  });
});

describe('isPeriodEnd', () => {
  it('matches period end case-insensitively', () => {
    expect(isPeriodEnd(act('period', 'end'))).toBe(true);
    expect(isPeriodEnd(act('Period', 'End'))).toBe(true);
    expect(isPeriodEnd(act('period', 'start'))).toBe(false);
    expect(isPeriodEnd(null)).toBe(false);
  });
});

describe('nextDelayMs', () => {
  const d = { phaseSince: NOW, now: NOW, failures: 0, notBeforeMs: 0, random: () => 0.5 };

  it('uses the phase delay', () => {
    expect(nextDelayMs({ ...d, phase: 'PREGAME' })).toBe(30_000);
    expect(nextDelayMs({ ...d, phase: 'TIP_WATCH' })).toBe(10_000);
    expect(nextDelayMs({ ...d, phase: 'LIVE' })).toBe(3_000);
    expect(nextDelayMs({ ...d, phase: 'CLUTCH' })).toBe(2_000);
    expect(nextDelayMs({ ...d, phase: 'STOPPAGE' })).toBe(8_000);
  });

  it('polls slowly for the first 10 minutes of halftime, then every 8 s', () => {
    expect(nextDelayMs({ ...d, phase: 'HALFTIME', now: NOW + 5 * 60_000 })).toBe(30_000);
    expect(nextDelayMs({ ...d, phase: 'HALFTIME', now: NOW + 11 * 60_000 })).toBe(8_000);
  });

  it('never polls before the CDN copy expires, capped at 15 s', () => {
    expect(nextDelayMs({ ...d, phase: 'LIVE', notBeforeMs: NOW + 5_000 })).toBe(5_000);
    expect(nextDelayMs({ ...d, phase: 'LIVE', notBeforeMs: NOW + 900_000 })).toBe(15_000);
    expect(nextDelayMs({ ...d, phase: 'STOPPAGE', notBeforeMs: NOW + 5_000 })).toBe(8_000);
  });

  it('backs off exponentially with ±20 % jitter on failures', () => {
    expect(nextDelayMs({ ...d, phase: 'LIVE', failures: 1 })).toBe(3_000);
    expect(nextDelayMs({ ...d, phase: 'LIVE', failures: 2 })).toBe(6_000);
    expect(nextDelayMs({ ...d, phase: 'LIVE', failures: 5 })).toBe(48_000);
    expect(nextDelayMs({ ...d, phase: 'LIVE', failures: 9 })).toBe(60_000);
    expect(nextDelayMs({ ...d, phase: 'LIVE', failures: 1, random: () => 0 })).toBe(2_400);
    expect(nextDelayMs({ ...d, phase: 'LIVE', failures: 1, random: () => 1 })).toBe(3_600);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run scripts/lib/live-cadence.test.ts`
Expected: FAIL — cannot find module `./live-cadence.js`.

- [ ] **Step 4: Implement**

Create `scripts/lib/live-cadence.ts`:

```ts
// scripts/lib/live-cadence.ts
// How often the live runner polls the NBA CDN (Live v2 spec §3). Pure: the
// poller feeds in what it last saw, this decides the game phase and the delay
// until the next play-by-play request.

import type { LivePhase } from '../../src/lib/types/live-state';

export const PHASE_DELAY_MS: Record<LivePhase, number> = {
  PREGAME: 30_000,
  TIP_WATCH: 10_000,
  LIVE: 3_000,
  CLUTCH: 2_000,
  STOPPAGE: 8_000,
  HALFTIME: 8_000,
  FINAL: 0,
};
/** Halftime is 15 minutes; nothing happens for the first 10. */
export const HALFTIME_QUIET_MS = 10 * 60_000;
export const HALFTIME_QUIET_DELAY_MS = 30_000;
/** Once the game is live, the scoreboard only feeds other games and cross-checks status. */
export const SCOREBOARD_EVERY_MS = 60_000;
/** The CDN scoreboard rolls over mid-morning ET; before tip a game can be missing. */
export const NOT_LISTED_DELAY_MS = 60_000;
/** The runner rewrites live_state at least this often so /api/live can tell quiet from dead. */
export const HEARTBEAT_MS = 15_000;
/** A misconfigured max-age must not stall live polling. */
export const FRESHNESS_FLOOR_CAP_MS = 15_000;

const CLUTCH_CLOCK_SEC = 300;
const CLUTCH_MARGIN = 10;
const BACKOFF_BASE_MS = 3_000;
const BACKOFF_MAX_MS = 60_000;
const STOPPAGE_TYPES = new Set(['timeout', 'instantreplay', 'stoppage']);

export interface LastAction {
  actionType: string;
  subType: string;
  period: number;
}

export function isPeriodEnd(a: LastAction | null): boolean {
  return a !== null && a.actionType.toLowerCase() === 'period' && a.subType.toLowerCase() === 'end';
}

export interface PhaseInput {
  gameStatus: number;        // 1 scheduled, 2 live, 3 final
  now: number;               // ms epoch
  tipAt: number | null;      // scheduled tip, ms epoch
  period: number;
  clockSec: number;          // seconds left in the period
  margin: number;            // home − away
  lastAction: LastAction | null;
}

export function classifyPhase(i: PhaseInput): LivePhase {
  if (i.gameStatus >= 3) return 'FINAL';
  if (i.gameStatus <= 1) return i.tipAt !== null && i.now >= i.tipAt ? 'TIP_WATCH' : 'PREGAME';
  if (isPeriodEnd(i.lastAction)) return i.lastAction!.period === 2 ? 'HALFTIME' : 'STOPPAGE';
  if (i.period >= 4 && i.clockSec <= CLUTCH_CLOCK_SEC && Math.abs(i.margin) <= CLUTCH_MARGIN) return 'CLUTCH';
  if (i.lastAction && STOPPAGE_TYPES.has(i.lastAction.actionType.toLowerCase())) return 'STOPPAGE';
  return 'LIVE';
}

export interface DelayInput {
  phase: LivePhase;
  phaseSince: number;        // when the current phase began, ms epoch
  now: number;
  failures: number;          // consecutive failed ticks
  notBeforeMs: number;       // the heartbeat URL's cached copy expires at this ms epoch (0 = unknown)
  random?: () => number;     // jitter source, 0..1
}

export function nextDelayMs(i: DelayInput): number {
  if (i.failures > 0) {
    const base = Math.min(BACKOFF_BASE_MS * 2 ** (i.failures - 1), BACKOFF_MAX_MS);
    const jitter = 0.8 + 0.4 * (i.random ?? Math.random)();
    return Math.min(Math.round(base * jitter), BACKOFF_MAX_MS);
  }
  let delay = PHASE_DELAY_MS[i.phase];
  if (i.phase === 'HALFTIME' && i.now - i.phaseSince < HALFTIME_QUIET_MS) delay = HALFTIME_QUIET_DELAY_MS;
  const floor = Math.min(Math.max(0, i.notBeforeMs - i.now), FRESHNESS_FLOOR_CAP_MS);
  return Math.max(delay, floor);
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run scripts/lib/live-cadence.test.ts`
Expected: PASS. The `failures: 9` case: 3000·2⁸ caps at 60 000, and with jitter 0.5 → 60 000.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types/live-state.ts scripts/lib/live-cadence.ts scripts/lib/live-cadence.test.ts
git commit -m "feat(live): adaptive poll cadence state machine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Live state document

**Files:**
- Modify: `src/lib/types/live-state.ts`
- Create: `scripts/lib/live-state.ts`, `scripts/lib/live-state.test.ts`, `scripts/lib/live-fixtures.ts`

**Interfaces:**
- Consumes: `parseNBAClock` (`nba-live-client.ts`), `extractRecentScoring`, `lineScore`, `summarizeOtherGames` (`poll-live-logic.ts`), `LivePhase`.
- Produces (types): `LivePlay`, `LiveRecentScoring`, `LiveStateDoc` exactly as below.
- Produces (live-state.ts): `LAST_PLAYS = 15`, `RECENT_SCORING_LOOKBACK_SECONDS = 120`, `type LiveStateBody = Omit<LiveStateDoc, 'seq'>`, `interface StateInputs`, `toLivePlay(a: PlayByPlayAction): LivePlay`, `lastPlays(actions: PlayByPlayAction[], n?: number): LivePlay[]`, `buildLiveState(i: StateInputs): LiveStateBody`, `fingerprint(body: LiveStateBody): string`.
- Produces (live-fixtures.ts): `LAC_ID`, `SAC_ID`, `GAME_ID = '0022600093'`, `action(n, over?)`, `box(o?)`, `sbGame(o?)`, `scoreboard(...games)`, `liveDoc(seq, over?)`.

- [ ] **Step 1: Complete the shared types**

Append to `src/lib/types/live-state.ts`:

```ts
import type { BoxscoreTeam } from './live';

/** One play-by-play action, trimmed for clients. */
export interface LivePlay {
  action_number: number;
  period: number;
  clock: string;               // "4:32"
  team_tricode: string | null;
  person_id: number | null;
  action_type: string;
  sub_type: string;
  description: string;
  score_home: number;
  score_away: number;
  time_actual: string | null;  // wall clock of the real play
}

/** Same shape as scripts/lib/poll-live-logic.ts RecentScoringEvent (read by live insights). */
export interface LiveRecentScoring {
  team_id: string;
  team_tricode?: string;
  points: number;
  event_time_seconds: number;
}

/**
 * The runner's latest state for one game. A superset of the pre-Live-v2
 * snapshot payload, so /api/live's existing builders read it unchanged.
 */
export interface LiveStateDoc {
  v: 1;
  seq: number;                 // +1 per saved change, per game
  source: 'nba';
  nba_game_id: string;         // 10-char CDN id
  status: 'scheduled' | 'in_progress' | 'final';
  status_text: string;
  period: number;
  clock: string;               // "4:32"
  home_score: number;
  away_score: number;
  periods: { period: number; home: number; away: number }[];
  home_box: BoxscoreTeam | null;
  away_box: BoxscoreTeam | null;
  recent_scoring: LiveRecentScoring[];
  last_plays: LivePlay[];      // newest first, at most 15
  other_games: unknown[];      // poll-live-logic OtherGame[]
  observed_at: string | null;  // time_actual of the newest play
  fetched_at: string;          // when the runner built this state
  cadence: { phase: LivePhase; next_ms: number };
  is_stale: boolean;           // always false from the runner; kept for the /api/live contract
  stale_reason: string | null;
}
```

Move the `import type { BoxscoreTeam } from './live';` line to the top of the file, under the header comment.

- [ ] **Step 2: Create the fixtures**

Create `scripts/lib/live-fixtures.ts`:

```ts
// scripts/lib/live-fixtures.ts
// DB-free fixtures for live runner tests. Opening night 2026-27: SAC @ LAC.

import type {
  BoxscoreGame,
  BoxscoreTeam,
  NBAScoreboardResponse,
  PlayByPlayAction,
  ScoreboardGame,
  ScoreboardTeam,
  TeamStatistics,
} from '../../src/lib/types/live';
import type { LiveStateDoc } from '../../src/lib/types/live-state';

export const LAC_ID = 1610612746;
export const SAC_ID = 1610612758;
export const GAME_ID = '0022600093';
const T0 = Date.UTC(2026, 9, 22, 2, 40, 0);

export function action(n: number, over: Partial<PlayByPlayAction> = {}): PlayByPlayAction {
  return {
    actionNumber: n,
    clock: 'PT10M00.00S',
    period: 1,
    teamId: LAC_ID,
    teamTricode: 'LAC',
    actionType: '2pt',
    subType: 'jumpshot',
    qualifiers: [],
    personId: 201,
    description: `Play ${n}`,
    scoreHome: '2',
    scoreAway: '0',
    pointsTotal: 2,
    timeActual: new Date(T0 + n * 10_000).toISOString(),
    ...over,
  };
}

const ZERO: TeamStatistics = {
  assists: 0, blocks: 0, fieldGoalsAttempted: 0, fieldGoalsMade: 0, fieldGoalsPercentage: 0,
  foulsPersonal: 0, freeThrowsAttempted: 0, freeThrowsMade: 0, freeThrowsPercentage: 0, points: 0,
  reboundsDefensive: 0, reboundsOffensive: 0, reboundsTotal: 0, steals: 0, threePointersAttempted: 0,
  threePointersMade: 0, threePointersPercentage: 0, turnovers: 0,
};

function boxTeam(teamId: number, tricode: string, score: number, periods: number[]): BoxscoreTeam {
  return {
    teamId, teamName: tricode, teamCity: tricode, teamTricode: tricode, score,
    periods: periods.map((s, i) => ({ period: i + 1, periodType: 'REGULAR', score: s })),
    statistics: { ...ZERO, points: score },
    players: [],
  };
}

export function box(o: {
  status?: number; period?: number; clock?: string; home?: number; away?: number;
  homePeriods?: number[]; awayPeriods?: number[];
} = {}): BoxscoreGame {
  const home = o.home ?? 2;
  const away = o.away ?? 0;
  return {
    gameId: GAME_ID,
    gameStatus: o.status ?? 2,
    gameStatusText: o.status === 3 ? 'Final' : 'Q1 10:00',
    period: o.period ?? 1,
    gameClock: o.clock ?? 'PT10M00.00S',
    gameTimeUTC: '2026-10-22T02:30:00Z',
    regulationPeriods: 4,
    homeTeam: boxTeam(LAC_ID, 'LAC', home, o.homePeriods ?? [home]),
    awayTeam: boxTeam(SAC_ID, 'SAC', away, o.awayPeriods ?? [away]),
  };
}

function sbTeam(teamId: number, tricode: string, score: number): ScoreboardTeam {
  return { teamId, teamName: tricode, teamCity: tricode, teamTricode: tricode, wins: 0, losses: 0, score, periods: [], timeoutsRemaining: 7, inBonus: '0' };
}

export function sbGame(o: { status?: number; period?: number; clock?: string; home?: number; away?: number; gameId?: string } = {}): ScoreboardGame {
  return {
    gameId: o.gameId ?? GAME_ID,
    gameCode: '20261021/SACLAC',
    gameStatus: o.status ?? 2,
    gameStatusText: o.status === 1 ? '7:30 pm ET' : 'Q1',
    period: o.period ?? 1,
    gameClock: o.clock ?? 'PT10M00.00S',
    gameTimeUTC: '2026-10-22T02:30:00Z',
    homeTeam: sbTeam(LAC_ID, 'LAC', o.home ?? 0),
    awayTeam: sbTeam(SAC_ID, 'SAC', o.away ?? 0),
  };
}

export function scoreboard(...games: ScoreboardGame[]): NBAScoreboardResponse {
  return {
    meta: { version: 1, code: 200, request: 'scoreboard', time: '' },
    scoreboard: { gameDate: '2026-10-21', leagueId: '00', leagueName: 'NBA', games },
  };
}

export function liveDoc(seq: number, over: Partial<LiveStateDoc> = {}): LiveStateDoc {
  return {
    v: 1, seq, source: 'nba', nba_game_id: GAME_ID, status: 'in_progress', status_text: 'Q1 10:00',
    period: 1, clock: '10:00', home_score: 2, away_score: 0, periods: [{ period: 1, home: 2, away: 0 }],
    home_box: null, away_box: null, recent_scoring: [], last_plays: [], other_games: [],
    observed_at: '2026-10-22T02:40:10.000Z', fetched_at: '2026-10-22T02:40:12.000Z',
    cadence: { phase: 'LIVE', next_ms: 3000 }, is_stale: false, stale_reason: null,
    ...over,
  };
}
```

- [ ] **Step 3: Write the failing tests**

Create `scripts/lib/live-state.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildLiveState, fingerprint, lastPlays, type StateInputs } from './live-state.js';
import { action, box, GAME_ID, sbGame } from './live-fixtures.js';

const NOW = Date.UTC(2026, 9, 22, 2, 45, 0);
const other = sbGame({ gameId: '0022600094', status: 2, home: 50, away: 48 });

function inputs(over: Partial<StateInputs> = {}): StateInputs {
  const sb = sbGame({ status: 2, home: 0, away: 0 });
  return { sbGame: sb, sbGames: [sb, other], box: null, actions: [], phase: 'LIVE', nextMs: 3000, now: NOW, ...over };
}

describe('lastPlays', () => {
  it('returns the newest 15 plays, newest first, trimmed for clients', () => {
    const actions = Array.from({ length: 20 }, (_, i) => action(i + 1));
    const plays = lastPlays(actions);
    expect(plays).toHaveLength(15);
    expect(plays[0].action_number).toBe(20);
    expect(plays[14].action_number).toBe(6);
    expect(plays[0]).toEqual({
      action_number: 20, period: 1, clock: '10:00', team_tricode: 'LAC', person_id: 201,
      action_type: '2pt', sub_type: 'jumpshot', description: 'Play 20', score_home: 2, score_away: 0,
      time_actual: actions[19].timeActual,
    });
  });
});

describe('buildLiveState', () => {
  it('prefers the box score for status, score, clock and line score', () => {
    const actions = [action(1), action(2, { clock: 'PT04M32.00S', scoreHome: '30', scoreAway: '28' })];
    const body = buildLiveState(inputs({
      box: box({ period: 2, clock: 'PT04M32.00S', home: 30, away: 28, homePeriods: [20, 10], awayPeriods: [15, 13] }),
      actions,
    }));
    expect(body).toMatchObject({
      v: 1, source: 'nba', nba_game_id: GAME_ID, status: 'in_progress', period: 2, clock: '4:32',
      home_score: 30, away_score: 28,
      periods: [{ period: 1, home: 20, away: 15 }, { period: 2, home: 10, away: 13 }],
      observed_at: actions[1].timeActual, fetched_at: new Date(NOW).toISOString(),
      cadence: { phase: 'LIVE', next_ms: 3000 }, is_stale: false, stale_reason: null,
    });
    expect(body.home_box?.teamTricode).toBe('LAC');
    expect(body.last_plays[0].action_number).toBe(2);
  });

  it('falls back to the scoreboard before tip', () => {
    const body = buildLiveState(inputs({ sbGame: sbGame({ status: 1 }), phase: 'PREGAME', nextMs: 30_000 }));
    expect(body.status).toBe('scheduled');
    expect(body.home_box).toBeNull();
    expect(body.last_plays).toEqual([]);
    expect(body.observed_at).toBeNull();
    expect(body.recent_scoring).toEqual([]);
  });

  it('summarizes the other games on the scoreboard, not this one', () => {
    const body = buildLiveState(inputs());
    expect(body.other_games).toHaveLength(1);
    expect((body.other_games[0] as { game_id: string }).game_id).toBe('0022600094');
  });

  it('reports final when the box score is final even if the scoreboard lags', () => {
    const body = buildLiveState(inputs({ box: box({ status: 3, home: 110, away: 101 }), phase: 'FINAL', nextMs: 0 }));
    expect(body.status).toBe('final');
  });
});

describe('fingerprint', () => {
  it('ignores fetched_at and next_ms, but not phase or content', () => {
    const a = buildLiveState(inputs({ actions: [action(1)] }));
    expect(fingerprint({ ...a, fetched_at: 'later', cadence: { phase: 'LIVE', next_ms: 5000 } })).toBe(fingerprint(a));
    expect(fingerprint({ ...a, cadence: { phase: 'STOPPAGE', next_ms: 3000 } })).not.toBe(fingerprint(a));
    const b = buildLiveState(inputs({ actions: [action(1), action(2)] }));
    expect(fingerprint(b)).not.toBe(fingerprint(a));
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run scripts/lib/live-state.test.ts`
Expected: FAIL — cannot find module `./live-state.js`.

- [ ] **Step 5: Implement**

Create `scripts/lib/live-state.ts`:

```ts
// scripts/lib/live-state.ts
// Builds the live_state document (Live v2 spec §4) from the latest scoreboard,
// box score and play-by-play. Pure. The box score is the freshest source for
// score/clock (it is fetched right after play-by-play changes); the scoreboard
// covers pre-tip and other games.

import { createHash } from 'node:crypto';
import type { BoxscoreGame, BoxscoreTeam, PlayByPlayAction, ScoreboardGame } from '../../src/lib/types/live';
import type { LivePhase, LivePlay, LiveStateDoc } from '../../src/lib/types/live-state';
import { parseNBAClock } from './nba-live-client.js';
import { extractRecentScoring, lineScore, summarizeOtherGames } from './poll-live-logic.js';

export const LAST_PLAYS = 15;
export const RECENT_SCORING_LOOKBACK_SECONDS = 120;

export type LiveStateBody = Omit<LiveStateDoc, 'seq'>;

export interface StateInputs {
  sbGame: ScoreboardGame;          // this game's scoreboard entry
  sbGames: ScoreboardGame[];       // the whole scoreboard
  box: BoxscoreGame | null;
  actions: PlayByPlayAction[];     // full play-by-play so far (empty pre-tip)
  phase: LivePhase;
  nextMs: number;
  now: number;
}

export function toLivePlay(a: PlayByPlayAction): LivePlay {
  return {
    action_number: a.actionNumber,
    period: a.period,
    clock: parseNBAClock(a.clock),
    team_tricode: a.teamTricode || null,
    person_id: a.personId || null,
    action_type: a.actionType,
    sub_type: a.subType ?? '',
    description: a.description ?? '',
    score_home: Number(a.scoreHome) || 0,
    score_away: Number(a.scoreAway) || 0,
    time_actual: a.timeActual ?? null,
  };
}

export function lastPlays(actions: PlayByPlayAction[], n = LAST_PLAYS): LivePlay[] {
  return actions.slice(-n).reverse().map(toLivePlay);
}

function boxPeriods(home: BoxscoreTeam, away: BoxscoreTeam): LiveStateDoc['periods'] {
  const awayBy = new Map((away.periods ?? []).map((p) => [p.period, p.score]));
  return (home.periods ?? []).map((p) => ({ period: p.period, home: p.score, away: awayBy.get(p.period) ?? 0 }));
}

function statusOf(code: number): LiveStateDoc['status'] {
  return code >= 3 ? 'final' : code === 2 ? 'in_progress' : 'scheduled';
}

export function buildLiveState(i: StateInputs): LiveStateBody {
  const b = i.box;
  const period = b?.period ?? i.sbGame.period;
  const isoClock = b?.gameClock ?? i.sbGame.gameClock;
  const observed = [...i.actions].reverse().find((a) => a.timeActual)?.timeActual ?? null;
  return {
    v: 1,
    source: 'nba',
    nba_game_id: i.sbGame.gameId,
    status: statusOf(Math.max(i.sbGame.gameStatus, b?.gameStatus ?? 0)),
    status_text: b?.gameStatusText ?? i.sbGame.gameStatusText,
    period,
    clock: parseNBAClock(isoClock),
    home_score: b?.homeTeam.score ?? i.sbGame.homeTeam.score,
    away_score: b?.awayTeam.score ?? i.sbGame.awayTeam.score,
    periods: b ? boxPeriods(b.homeTeam, b.awayTeam) : lineScore(i.sbGame),
    home_box: b?.homeTeam ?? null,
    away_box: b?.awayTeam ?? null,
    recent_scoring: i.actions.length
      ? extractRecentScoring(
          i.actions,
          { period, clock: isoClock },
          {
            homeTeamId: i.sbGame.homeTeam.teamId,
            awayTeamId: i.sbGame.awayTeam.teamId,
            homeTricode: i.sbGame.homeTeam.teamTricode,
            awayTricode: i.sbGame.awayTeam.teamTricode,
          },
          RECENT_SCORING_LOOKBACK_SECONDS
        )
      : [],
    last_plays: lastPlays(i.actions),
    other_games: summarizeOtherGames(i.sbGames, i.sbGame.gameId),
    observed_at: observed,
    fetched_at: new Date(i.now).toISOString(),
    cadence: { phase: i.phase, next_ms: i.nextMs },
    is_stale: false,
    stale_reason: null,
  };
}

/** Content hash: changes when anything a fan would see changes, including the phase. */
export function fingerprint(body: LiveStateBody): string {
  const comparable = { ...body, fetched_at: '', cadence: { phase: body.cadence.phase, next_ms: 0 } };
  return createHash('sha1').update(JSON.stringify(comparable)).digest('hex');
}
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run scripts/lib/live-state.test.ts && npx tsc --noEmit -p .`
Expected: PASS; no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types/live-state.ts scripts/lib/live-state.ts scripts/lib/live-state.test.ts scripts/lib/live-fixtures.ts
git commit -m "feat(live): live state document builder and fingerprint

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `live_state` table and store

**Files:**
- Modify: `Docs/DB_SCHEMA.sql` (after the `live_snapshots` indexes, ~line 209)
- Create: `Docs/migrations/2026-10-live-v2.sql`
- Create: `scripts/lib/live-store.ts`
- Modify: `Docs/DATA_DICTIONARY.md`
- Test: `scripts/lib/pipeline.integration.test.ts` (new `it` at the end of the existing `describe`)

**Interfaces:**
- Consumes: `LiveStateDoc`.
- Produces: `loadLiveSeq(sql: Sql, gameDbId: string): Promise<number>`, `saveLiveState(sql: Sql, gameDbId: string, doc: LiveStateDoc): Promise<boolean>` (false when a newer seq is already stored), `saveLiveMoment(sql: Sql, gameDbId: string, doc: LiveStateDoc, reason: 'period_end' | 'final'): Promise<void>`.

- [ ] **Step 1: Add the schema**

In `Docs/DB_SCHEMA.sql`, after `CREATE INDEX IF NOT EXISTS idx_live_snapshots_captured ...;`, add:

```sql
-- Live v2: the game-night runner's latest derived state, one row per game,
-- rewritten on every change (and at least every 15 s). Read by /api/live.
-- live_snapshots now only gets a row per period end and at final.
CREATE TABLE IF NOT EXISTS live_state (
  game_id          BIGINT PRIMARY KEY REFERENCES games(game_id) ON DELETE CASCADE,
  seq              INTEGER NOT NULL,              -- +1 per saved change
  state            JSONB NOT NULL,                -- src/lib/types/live-state.ts LiveStateDoc
  fetched_at       TIMESTAMPTZ NOT NULL,          -- when the runner built the state
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_live_state_fetched ON live_state (fetched_at DESC);
```

Create `Docs/migrations/2026-10-live-v2.sql`:

```sql
-- Live v2 (Docs/superpowers/specs/2026-09-27-live-v2-realtime-design.md §5).
-- Idempotent; safe to re-run.
BEGIN;

CREATE TABLE IF NOT EXISTS live_state (
  game_id          BIGINT PRIMARY KEY REFERENCES games(game_id) ON DELETE CASCADE,
  seq              INTEGER NOT NULL,
  state            JSONB NOT NULL,
  fetched_at       TIMESTAMPTZ NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_live_state_fetched ON live_state (fetched_at DESC);

COMMIT;
```

- [ ] **Step 2: Write the failing integration test**

Append inside the `describe.skipIf(!url)(...)` block of `scripts/lib/pipeline.integration.test.ts`, as the last test:

```ts
  it('stores live state: newer seq wins, games row follows, moments go to live_snapshots', async () => {
    const { saveLiveState, saveLiveMoment, loadLiveSeq } = await import('./live-store');
    const { liveDoc } = await import('./live-fixtures');
    const [game] = await sql<{ game_id: string; status: string; period: number | null; clock: string | null; home_score: number | null; away_score: number | null }[]>`
      SELECT g.game_id::text, g.status, g.period, g.clock, g.home_score, g.away_score
      FROM games g JOIN teams t ON t.abbreviation = 'LAC' AND t.team_id IN (g.home_team_id, g.away_team_id)
      WHERE g.status <> 'final' ORDER BY g.game_date LIMIT 1`;
    try {
      expect(await loadLiveSeq(sql, game.game_id)).toBe(0);
      expect(await saveLiveState(sql, game.game_id, liveDoc(2, { home_score: 10, away_score: 8, clock: '6:00' }))).toBe(true);
      expect(await saveLiveState(sql, game.game_id, liveDoc(1, { home_score: 99 }))).toBe(false);   // older: ignored
      expect(await loadLiveSeq(sql, game.game_id)).toBe(2);

      const [row] = await sql<{ seq: number; home: number }[]>`
        SELECT seq, (state->>'home_score')::int AS home FROM live_state WHERE game_id = ${game.game_id}::bigint`;
      expect(row).toEqual({ seq: 2, home: 10 });
      const [g] = await sql<{ status: string; clock: string; home_score: number }[]>`
        SELECT status, clock, home_score FROM games WHERE game_id = ${game.game_id}::bigint`;
      expect(g).toEqual({ status: 'in_progress', clock: '6:00', home_score: 10 });

      await saveLiveMoment(sql, game.game_id, liveDoc(3, { period: 2, clock: '0:00' }), 'period_end');
      const [snap] = await sql<{ period: number; reason: string }[]>`
        SELECT period, payload->>'reason' AS reason FROM live_snapshots
        WHERE game_id = ${game.game_id}::bigint ORDER BY captured_at DESC LIMIT 1`;
      expect(snap).toEqual({ period: 2, reason: 'period_end' });
    } finally {
      await sql`DELETE FROM live_state WHERE game_id = ${game.game_id}::bigint`;
      await sql`DELETE FROM live_snapshots WHERE game_id = ${game.game_id}::bigint`;
      await sql`UPDATE games SET status = ${game.status}, period = ${game.period}, clock = ${game.clock},
                home_score = ${game.home_score}, away_score = ${game.away_score}
                WHERE game_id = ${game.game_id}::bigint`;
    }
  });
```

- [ ] **Step 3: Run to verify failure**

Run: `FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/fixture npx vitest run scripts/lib/pipeline.integration.test.ts -t "stores live state"`
Expected: FAIL — cannot find module `./live-store`.

- [ ] **Step 4: Implement the store**

Create `scripts/lib/live-store.ts`:

```ts
// scripts/lib/live-store.ts
// Database writes for the live runner (Live v2 spec §5). The caller passes its
// postgres client (scripts: scripts/lib/db.ts; the cron route: src/lib/db.ts).

import type { Sql } from 'postgres';
import type { LiveStateDoc } from '../../src/lib/types/live-state';

type Json = Parameters<Sql['json']>[0];

/** The last saved seq for a game (0 if none) — a restarted runner continues from it. */
export async function loadLiveSeq(sql: Sql, gameDbId: string): Promise<number> {
  const [row] = await sql<{ seq: number }[]>`SELECT seq FROM live_state WHERE game_id = ${gameDbId}::bigint`;
  return row?.seq ?? 0;
}

/**
 * Upserts the game's live state if `doc.seq` is newer than what's stored, then
 * mirrors status/score/clock onto the games row. Returns false when a newer
 * state was already stored (nothing written).
 */
export async function saveLiveState(sql: Sql, gameDbId: string, doc: LiveStateDoc): Promise<boolean> {
  const written = await sql`
    INSERT INTO live_state (game_id, seq, state, fetched_at)
    VALUES (${gameDbId}::bigint, ${doc.seq}, ${sql.json(doc as unknown as Json)}, ${doc.fetched_at})
    ON CONFLICT (game_id) DO UPDATE
      SET seq = EXCLUDED.seq, state = EXCLUDED.state, fetched_at = EXCLUDED.fetched_at, updated_at = now()
      WHERE live_state.seq < EXCLUDED.seq
    RETURNING seq
  `;
  if (written.length === 0) return false;

  // A game can't go back from final on a stale read.
  await sql`
    UPDATE games SET
      status = ${doc.status}, period = ${doc.period}, clock = ${doc.clock},
      home_score = ${doc.home_score}, away_score = ${doc.away_score}, updated_at = now()
    WHERE game_id = ${gameDbId}::bigint AND status <> 'final'
  `;
  await sql`
    INSERT INTO app_kv (key, value, updated_at)
    VALUES ('live:last_poll_at', ${sql.json(doc.fetched_at)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
  return true;
}

/** A compact live_snapshots row at a period end or the final buzzer (insight proofs read these). */
export async function saveLiveMoment(
  sql: Sql,
  gameDbId: string,
  doc: LiveStateDoc,
  reason: 'period_end' | 'final'
): Promise<void> {
  const payload = { reason, seq: doc.seq, status: doc.status, status_text: doc.status_text, periods: doc.periods };
  await sql`
    INSERT INTO live_snapshots (game_id, captured_at, provider_ts, period, clock, home_score, away_score, payload)
    VALUES (${gameDbId}::bigint, now(), ${doc.observed_at}, ${doc.period}, ${doc.clock},
            ${doc.home_score}, ${doc.away_score}, ${sql.json(payload as unknown as Json)})
  `;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/fixture npx vitest run scripts/lib/pipeline.integration.test.ts`
Expected: PASS, the whole file including the new test. The seed script applies `Docs/DB_SCHEMA.sql`, so `live_state` exists.

- [ ] **Step 6: Document the table**

In `Docs/DATA_DICTIONARY.md`, next to the `live_snapshots` entry, add:

```markdown
## live_state

The game-night runner's latest derived state for a game — one row per game, rewritten whenever anything a fan would see changes and at least every 15 seconds. `/api/live` reads this row.

| Column | Meaning |
|---|---|
| `game_id` | `games.game_id` (primary key) |
| `seq` | Increments by one per saved change; a restarted runner continues from the stored value, and older writes are ignored |
| `state` | `LiveStateDoc` (`src/lib/types/live-state.ts`): score, clock, line score, both box scores, last 15 plays, recent scoring, other games, `observed_at` (time of the newest real play), `fetched_at`, `cadence` `{phase, next_ms}` |
| `fetched_at` | When the runner built the state; `/api/live` treats the game as delayed when this is older than `max(30 s, cadence.next_ms + 20 s)` |
```

Also update the `live_snapshots` entry's description: "Since Live v2, one compact row per period end and one at final (`payload.reason`), not one per poll."

- [ ] **Step 7: Commit**

```bash
git add Docs/DB_SCHEMA.sql Docs/migrations/2026-10-live-v2.sql Docs/DATA_DICTIONARY.md scripts/lib/live-store.ts scripts/lib/pipeline.integration.test.ts
git commit -m "feat(live): live_state table and store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The poller tick

**Files:**
- Create: `scripts/lib/live-poller.ts`, `scripts/lib/live-poller.test.ts`

**Interfaces:**
- Consumes: `CondResult`, `Validators` (Task 2); `classifyPhase`, `nextDelayMs`, `isPeriodEnd`, `SCOREBOARD_EVERY_MS`, `NOT_LISTED_DELAY_MS`, `HEARTBEAT_MS` (Task 3); `buildLiveState`, `fingerprint` (Task 4); `matchScoreboardGame`, `clockToSecondsRemaining` (existing).
- Produces:
  - `interface PollerDeps { fetchScoreboard(): Promise<NBAScoreboardResponse>; fetchPbp(gameId: string, prev?: Validators): Promise<CondResult<NBAPlayByPlayResponse>>; fetchBox(gameId: string, prev?: Validators): Promise<CondResult<NBABoxscoreResponse>>; saveState(doc: LiveStateDoc): Promise<void>; saveMoment(doc: LiveStateDoc, reason: 'period_end' | 'final'): Promise<void>; now(): number; random?(): number; log?(msg: string): void }`
  - `interface TickResult { status: 'ok' | 'not_on_scoreboard' | 'error'; phase: LivePhase | null; delayMs: number; doc: LiveStateDoc | null; saved: boolean; final: boolean }`
  - `createPoller(nbaGameId: string, tipAt: number | null, deps: PollerDeps, initialSeq?: number): { tick(): Promise<TickResult> }`

- [ ] **Step 1: Write the failing tests**

Create `scripts/lib/live-poller.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { NBABoxscoreResponse, NBAPlayByPlayResponse, PlayByPlayAction, BoxscoreGame } from '../../src/lib/types/live';
import type { CondResult } from './nba-live-client.js';
import { createPoller, type PollerDeps } from './live-poller.js';
import { action, box, GAME_ID, sbGame, scoreboard } from './live-fixtures.js';

const TIP = Date.UTC(2026, 9, 22, 2, 30, 0);

const ok = <T>(body: T, maxAgeMs: number | null = null): CondResult<T> =>
  ({ status: 200, body, validators: { etag: '"e"', lastModified: null }, freshness: { maxAgeMs, ageMs: 0 } });
const notModified = <T>(): CondResult<T> =>
  ({ status: 304, validators: { etag: '"e"', lastModified: null }, freshness: { maxAgeMs: null, ageMs: 0 } });
const pbpOf = (...actions: PlayByPlayAction[]): NBAPlayByPlayResponse =>
  ({ meta: { version: 1, code: 200, request: '', time: '' }, game: { gameId: GAME_ID, actions } });
const boxOf = (game: BoxscoreGame): NBABoxscoreResponse =>
  ({ meta: { version: 1, code: 200, request: '', time: '' }, game });

function harness(start = TIP + 60_000) {
  const h = {
    t: start,
    sb: scoreboard(sbGame({ status: 2 })),
    pbp: ok(pbpOf(action(1))) as CondResult<NBAPlayByPlayResponse>,
    box: ok(boxOf(box())) as CondResult<NBABoxscoreResponse>,
    fail: null as Error | null,
  };
  const deps = {
    fetchScoreboard: vi.fn(async () => { if (h.fail) throw h.fail; return h.sb; }),
    fetchPbp: vi.fn(async () => { if (h.fail) throw h.fail; return h.pbp; }),
    fetchBox: vi.fn(async () => h.box),
    saveState: vi.fn(async () => {}),
    saveMoment: vi.fn(async () => {}),
    now: () => h.t,
    random: () => 0.5,
  } satisfies PollerDeps;
  return { h, deps };
}

describe('createPoller', () => {
  it('pre-tip: polls only the scoreboard every 30 s and saves a scheduled state', async () => {
    const { h, deps } = harness(TIP - 5 * 60_000);
    h.sb = scoreboard(sbGame({ status: 1 }));
    const r = await createPoller(GAME_ID, TIP, deps).tick();
    expect(r).toMatchObject({ status: 'ok', phase: 'PREGAME', delayMs: 30_000, saved: true, final: false });
    expect(r.doc?.status).toBe('scheduled');
    expect(deps.fetchPbp).not.toHaveBeenCalled();
  });

  it('past the scheduled tip but not started: watches for the tip every 10 s', async () => {
    const { h, deps } = harness(TIP + 60_000);
    h.sb = scoreboard(sbGame({ status: 1 }));
    expect((await createPoller(GAME_ID, TIP, deps).tick()).delayMs).toBe(10_000);
  });

  it('is not_on_scoreboard when the game is missing', async () => {
    const { h, deps } = harness();
    h.sb = scoreboard(sbGame({ gameId: '0022600001' }));
    expect(await createPoller(GAME_ID, TIP, deps).tick()).toMatchObject({ status: 'not_on_scoreboard', delayMs: 60_000, doc: null });
  });

  it('live: fetches the box only when play-by-play advances, and saves only on change', async () => {
    const { h, deps } = harness();
    const poller = createPoller(GAME_ID, TIP, deps, 41);

    const first = await poller.tick();
    expect(first).toMatchObject({ status: 'ok', phase: 'LIVE', delayMs: 3_000, saved: true });
    expect(first.doc?.seq).toBe(42);
    expect(deps.fetchBox).toHaveBeenCalledTimes(1);

    h.t += 3_000;
    h.pbp = notModified();
    const second = await poller.tick();
    expect(second.saved).toBe(false);
    expect(deps.fetchBox).toHaveBeenCalledTimes(1);
    expect(deps.fetchScoreboard).toHaveBeenCalledTimes(1);   // not again within 60 s

    h.t += 3_000;
    h.pbp = ok(pbpOf(action(1), action(2, { scoreHome: '4' })));
    h.box = ok(boxOf(box({ home: 4 })));
    const third = await poller.tick();
    expect(third.saved).toBe(true);
    expect(third.doc).toMatchObject({ seq: 43, home_score: 4 });
    expect(deps.fetchBox).toHaveBeenCalledTimes(2);
  });

  it('rewrites the state as a heartbeat after 15 s without changes', async () => {
    const { h, deps } = harness();
    const poller = createPoller(GAME_ID, TIP, deps);
    await poller.tick();
    h.pbp = notModified();
    h.t += 9_000;
    expect((await poller.tick()).saved).toBe(false);
    h.t += 7_000;
    const beat = await poller.tick();
    expect(beat.saved).toBe(true);
    expect(beat.doc?.seq).toBe(2);
  });

  it('slows down on a timeout and at halftime, and records the period end once', async () => {
    const { h, deps } = harness();
    const poller = createPoller(GAME_ID, TIP, deps);
    h.pbp = ok(pbpOf(action(1), action(2, { actionType: 'timeout', subType: 'full' })));
    expect((await poller.tick()).phase).toBe('STOPPAGE');
    expect((await poller.tick()).delayMs).toBe(8_000);

    h.t += 8_000;
    h.pbp = ok(pbpOf(action(1), action(2), action(3, { actionType: 'period', subType: 'end', period: 2, clock: 'PT00M00.00S' })));
    h.box = ok(boxOf(box({ period: 2, clock: 'PT00M00.00S' })));
    const half = await poller.tick();
    expect(half).toMatchObject({ phase: 'HALFTIME', delayMs: 30_000 });
    h.t += 30_000;
    await poller.tick();
    expect(deps.saveMoment).toHaveBeenCalledTimes(1);
    expect(deps.saveMoment).toHaveBeenCalledWith(expect.objectContaining({ period: 2 }), 'period_end');
  });

  it('honors the CDN freshness floor', async () => {
    const { h, deps } = harness();
    h.pbp = ok(pbpOf(action(1)), 5_000);
    expect((await createPoller(GAME_ID, TIP, deps).tick()).delayMs).toBe(5_000);
  });

  it('finishes when the box score goes final', async () => {
    const { h, deps } = harness();
    h.pbp = ok(pbpOf(action(1), action(2, { actionType: 'game', subType: 'end', period: 4 })));
    h.box = ok(boxOf(box({ status: 3, period: 4, home: 110, away: 101 })));
    const r = await createPoller(GAME_ID, TIP, deps).tick();
    expect(r).toMatchObject({ phase: 'FINAL', final: true });
    expect(r.doc?.status).toBe('final');
    expect(deps.saveMoment).toHaveBeenCalledWith(expect.anything(), 'final');
  });

  it('backs off on fetch errors and recovers', async () => {
    const { h, deps } = harness();
    const poller = createPoller(GAME_ID, TIP, deps);
    h.fail = new Error('NBA CDN 503');
    expect(await poller.tick()).toMatchObject({ status: 'error', delayMs: 3_000, saved: false });
    expect((await poller.tick()).delayMs).toBe(6_000);
    h.fail = null;
    expect(await poller.tick()).toMatchObject({ status: 'ok', delayMs: 3_000 });
  });

  it('a failed save is retried on the next tick with a higher seq', async () => {
    const { deps } = harness();
    deps.saveState.mockRejectedValueOnce(new Error('db down'));
    const poller = createPoller(GAME_ID, TIP, deps);
    expect((await poller.tick()).saved).toBe(false);
    const retry = await poller.tick();
    expect(retry.saved).toBe(true);
    expect(retry.doc?.seq).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run scripts/lib/live-poller.test.ts`
Expected: FAIL — cannot find module `./live-poller.js`.

- [ ] **Step 3: Implement**

Create `scripts/lib/live-poller.ts`:

```ts
// scripts/lib/live-poller.ts
// One game's live polling loop body (Live v2 spec §3). Each tick fetches only
// what is due — the scoreboard pre-tip and once a minute after, play-by-play as
// the heartbeat, the box score only when play-by-play advanced — derives the
// live state, saves it when it changed (or as a 15 s heartbeat), and returns
// how long to wait. All I/O is injected, so the loop is unit-testable.

import type {
  BoxscoreGame,
  NBABoxscoreResponse,
  NBAPlayByPlayResponse,
  NBAScoreboardResponse,
  PlayByPlayAction,
  ScoreboardGame,
} from '../../src/lib/types/live';
import type { LivePhase, LiveStateDoc } from '../../src/lib/types/live-state';
import { clockToSecondsRemaining, type CondResult, type Validators } from './nba-live-client.js';
import { matchScoreboardGame } from './poll-live-logic.js';
import {
  classifyPhase,
  HEARTBEAT_MS,
  isPeriodEnd,
  nextDelayMs,
  NOT_LISTED_DELAY_MS,
  SCOREBOARD_EVERY_MS,
} from './live-cadence.js';
import { buildLiveState, fingerprint } from './live-state.js';

export interface PollerDeps {
  fetchScoreboard(): Promise<NBAScoreboardResponse>;
  fetchPbp(gameId: string, prev?: Validators): Promise<CondResult<NBAPlayByPlayResponse>>;
  fetchBox(gameId: string, prev?: Validators): Promise<CondResult<NBABoxscoreResponse>>;
  saveState(doc: LiveStateDoc): Promise<void>;
  saveMoment(doc: LiveStateDoc, reason: 'period_end' | 'final'): Promise<void>;
  now(): number;
  random?(): number;
  log?(msg: string): void;
}

export interface TickResult {
  status: 'ok' | 'not_on_scoreboard' | 'error';
  phase: LivePhase | null;
  delayMs: number;
  doc: LiveStateDoc | null;     // latest state, saved this tick or not
  saved: boolean;
  final: boolean;
}

export interface Poller {
  tick(): Promise<TickResult>;
}

export function createPoller(nbaGameId: string, tipAt: number | null, deps: PollerDeps, initialSeq = 0): Poller {
  const log = deps.log ?? (() => {});
  let seq = initialSeq;
  let savedFp = '';
  let savedAt = Number.NEGATIVE_INFINITY;
  let doc: LiveStateDoc | null = null;
  let phase: LivePhase | null = null;
  let phaseSince = 0;
  let failures = 0;
  let sbGames: ScoreboardGame[] = [];
  let sbGame: ScoreboardGame | null = null;
  let sbAt = Number.NEGATIVE_INFINITY;
  let actions: PlayByPlayAction[] = [];
  let box: BoxscoreGame | null = null;
  let pbpValidators: Validators | undefined;
  let boxValidators: Validators | undefined;
  let notBefore = 0;
  const moments = new Set<string>();

  const started = () => Math.max(sbGame?.gameStatus ?? 0, box?.gameStatus ?? 0) >= 2;

  async function refreshFeeds(now: number): Promise<void> {
    if (!sbGame || !started() || now - sbAt >= SCOREBOARD_EVERY_MS) {
      const sb = await deps.fetchScoreboard();
      sbGames = sb.scoreboard.games;
      sbAt = now;
      // Late West Coast games can outlive the scoreboard's rollover: keep the last match.
      sbGame = matchScoreboardGame(sbGames, nbaGameId) ?? sbGame;
    }
    if (!sbGame || !started()) return;

    const pbp = await deps.fetchPbp(sbGame.gameId, pbpValidators);
    pbpValidators = pbp.validators;
    if (pbp.freshness.maxAgeMs !== null) {
      notBefore = now + Math.max(0, pbp.freshness.maxAgeMs - pbp.freshness.ageMs);
    }
    let advanced = false;
    if (pbp.status === 200) {
      const newest = pbp.body.game.actions.at(-1)?.actionNumber ?? -1;
      advanced = newest !== (actions.at(-1)?.actionNumber ?? -1);
      actions = pbp.body.game.actions;
    }
    if (advanced || !box) {
      const b = await deps.fetchBox(sbGame.gameId, boxValidators);
      boxValidators = b.validators;
      if (b.status === 200) box = b.body.game;
    }
  }

  async function tick(): Promise<TickResult> {
    const now = deps.now();
    try {
      await refreshFeeds(now);
      failures = 0;
    } catch (err) {
      failures += 1;
      log(`fetch failed (${failures}x): ${(err as Error).message}`);
      const delayMs = nextDelayMs({ phase: phase ?? 'LIVE', phaseSince, now, failures, notBeforeMs: 0, random: deps.random });
      return { status: 'error', phase, delayMs, doc, saved: false, final: false };
    }
    if (!sbGame) {
      return { status: 'not_on_scoreboard', phase: null, delayMs: NOT_LISTED_DELAY_MS, doc: null, saved: false, final: false };
    }

    const last = actions.at(-1) ?? null;
    const lastAction = last ? { actionType: last.actionType, subType: last.subType ?? '', period: last.period } : null;
    const home = box?.homeTeam.score ?? sbGame.homeTeam.score;
    const away = box?.awayTeam.score ?? sbGame.awayTeam.score;
    const next = classifyPhase({
      gameStatus: Math.max(sbGame.gameStatus, box?.gameStatus ?? 0),
      now,
      tipAt,
      period: last?.period ?? box?.period ?? sbGame.period,
      clockSec: clockToSecondsRemaining(last?.clock ?? box?.gameClock ?? sbGame.gameClock),
      margin: home - away,
      lastAction,
    });
    if (next !== phase) {
      phase = next;
      phaseSince = now;
    }
    const delayMs = nextDelayMs({ phase, phaseSince, now, failures: 0, notBeforeMs: notBefore, random: deps.random });

    const body = buildLiveState({ sbGame, sbGames, box, actions, phase, nextMs: delayMs, now });
    const fp = fingerprint(body);
    let saved = false;
    if (fp !== savedFp || now - savedAt >= HEARTBEAT_MS) {
      seq += 1;
      doc = { ...body, seq };
      try {
        await deps.saveState(doc);
        savedFp = fp;
        savedAt = now;
        saved = true;
      } catch (err) {
        log(`save failed: ${(err as Error).message}`);
      }
    } else if (doc) {
      doc = { ...doc, fetched_at: body.fetched_at, cadence: body.cadence };
    }

    if (doc && isPeriodEnd(lastAction)) await recordMoment(`period_end:${lastAction!.period}`, doc, 'period_end');
    const final = phase === 'FINAL';
    if (doc && final) await recordMoment('final', doc, 'final');
    return { status: 'ok', phase, delayMs, doc, saved, final };
  }

  async function recordMoment(key: string, d: LiveStateDoc, reason: 'period_end' | 'final'): Promise<void> {
    if (moments.has(key)) return;
    moments.add(key);
    try {
      await deps.saveMoment(d, reason);
    } catch (err) {
      log(`moment ${key} not saved: ${(err as Error).message}`);
    }
  }

  return { tick };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run scripts/lib/live-poller.test.ts`
Expected: PASS (10 tests). Notes if a test fails:
- **Heartbeat test:** ticks at +9 s (saved: false) and +16 s (saved: true, since 16 s ≥ 15 s after the first save).
- **Halftime test:** the second `tick()` after the timeout sees the same `pbp` result (200 with unchanged actions), so `advanced` is false and the delay is 8 s.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/live-poller.ts scripts/lib/live-poller.test.ts
git commit -m "feat(live): change-driven poller tick

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Drive the runner and the cron route with the poller

**Files:**
- Create: `scripts/lib/live-deps.ts`, `scripts/dev/live-dry-run.ts`
- Modify: `scripts/game-night.ts` (imports; replace `pollLoop`)
- Modify: `scripts/lib/live-cycle.ts` (delete `runLiveCycle`, `SnapshotPayload`, `CycleResult`, `RECENT_SCORING_LOOKBACK_SECONDS` and the now-unused imports)
- Modify: `app/api/cron/poll-live/route.ts`
- Modify: `.github/workflows/feed-probe.yml` (add the dry run)

**Interfaces:**
- Consumes: `createPoller`, `PollerDeps`, `TickResult` (Task 6); `loadLiveSeq`, `saveLiveState`, `saveLiveMoment` (Task 5); `fetchScoreboard`, `fetchBoxscore`, `fetchPlayByPlayConditional`, `fetchBoxscoreConditional`, `NbaHttpError` (Task 2).
- Produces: `nbaPollerDeps(sql: Sql, gameDbId: string): PollerDeps`.

- [ ] **Step 1: Wire real dependencies**

Create `scripts/lib/live-deps.ts`:

```ts
// scripts/lib/live-deps.ts
// Real I/O for the live poller: NBA CDN fetchers and the live_state store.

import type { Sql } from 'postgres';
import {
  fetchBoxscore,
  fetchBoxscoreConditional,
  fetchPlayByPlayConditional,
  fetchScoreboard,
  NbaHttpError,
} from './nba-live-client.js';
import type { PollerDeps } from './live-poller.js';
import { saveLiveMoment, saveLiveState } from './live-store.js';

export function nbaPollerDeps(sql: Sql, gameDbId: string): PollerDeps {
  return {
    fetchScoreboard,
    fetchPbp: fetchPlayByPlayConditional,
    async fetchBox(gameId, prev) {
      try {
        return await fetchBoxscoreConditional(gameId, prev);
      } catch (err) {
        // Same fallback as before Live v2: stats.nba.com when the CDN refuses us.
        if (err instanceof NbaHttpError && err.status === 403) {
          const body = await fetchBoxscore(gameId, gameId);
          return { status: 200, body, validators: {}, freshness: { maxAgeMs: null, ageMs: 0 } };
        }
        throw err;
      }
    },
    saveState: async (doc) => {
      await saveLiveState(sql, gameDbId, doc);
    },
    saveMoment: (doc, reason) => saveLiveMoment(sql, gameDbId, doc, reason),
    now: Date.now,
    log: (msg) => console.log(`[live] ${msg}`),
  };
}
```

- [ ] **Step 2: Replace the game-night poll loop**

In `scripts/game-night.ts`:
- Update the header comment's step 2 to: "Sleeps until ~10 minutes before tip, then polls with the adaptive cadence in scripts/lib/live-cadence.ts (2–30 s by game phase) via scripts/lib/live-poller.ts, writing live_state on every change."
- Replace the imports of `calculateBackoff`, `runLiveCycle` and `parseNBAClock` with:

```ts
import { findLiveCandidates, type LiveCandidate } from './lib/live-cycle.js';
import { createPoller } from './lib/live-poller.js';
import { nbaPollerDeps } from './lib/live-deps.js';
import { loadLiveSeq } from './lib/live-store.js';
```

- Delete `POLL_INTERVAL_MS`, and replace `pollLoop` with:

```ts
async function pollLoop(candidate: LiveCandidate, tip: Date | null): Promise<void> {
  const initialSeq = await loadLiveSeq(sql, candidate.game_id);
  const poller = createPoller(candidate.nba_game_id, tip?.getTime() ?? null, nbaPollerDeps(sql, candidate.game_id), initialSeq);
  let notListedSince: number | null = null;
  let saves = 0;

  while (Date.now() - startedAt < MAX_RUNTIME_MS) {
    const r = await poller.tick();

    if (r.status === 'not_on_scoreboard') {
      // The CDN scoreboard rolls over mid-morning ET; before tip the game can
      // legitimately be missing for a while. Long after tip, stop.
      notListedSince ??= Date.now();
      const pastTip = !tip || Date.now() > tip.getTime();
      if (pastTip && Date.now() - notListedSince > NOT_LISTED_GIVE_UP_MS) {
        console.warn('[game-night] Game not on the scoreboard for 30 min after tip. Stopping.');
        return;
      }
    } else if (r.status === 'ok') {
      notListedSince = null;
    }

    if (r.saved && r.doc) {
      saves++;
      if (saves === 1 || saves % 50 === 0 || r.final) {
        const d = r.doc;
        console.log(
          `[game-night] seq ${d.seq} ${d.status_text} ${d.away_score}-${d.home_score} ` +
            `Q${d.period} ${d.clock} · ${r.phase} next ${r.delayMs}ms`
        );
      }
    }

    if (r.final && r.doc) {
      console.log('[game-night] Final. Finalizing…');
      try {
        await finalizeGame(candidate.game_id, r.doc.nba_game_id);
        await sql`
          INSERT INTO app_kv (key, value, updated_at)
          VALUES ('pipeline:last_sync_at', ${sql.json(new Date().toISOString())}, now())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
        `;
        console.log('[game-night] Finalization complete.');
      } catch (err) {
        // The nightly post-game pipeline retries games without box scores.
        console.error(`[game-night] Finalization failed: ${(err as Error).message}`);
        process.exitCode = 1;
      }
      return;
    }

    await sleep(r.delayMs);
  }
  console.warn('[game-night] Max runtime reached; the next hourly launch continues.');
}
```

- [ ] **Step 3: Trim `live-cycle.ts`**

In `scripts/lib/live-cycle.ts`, delete `RECENT_SCORING_LOOKBACK_SECONDS`, `SnapshotPayload`, `CycleResult` and `runLiveCycle`. Also delete the imports only they used: `fetchScoreboard`, `fetchBoxscore`, `fetchPlayByPlay`, `parseNBAClock`, the `poll-live-logic` helpers and `ScoreboardGame`/`BoxscoreTeam`. Keep `LiveCandidate`, `scoreboardStatus` and `findLiveCandidates`. Update the header comment to:

```ts
// scripts/lib/live-cycle.ts
// Finds Clippers games that may be live now. The polling itself lives in
// scripts/lib/live-poller.ts (Live v2); callers are the game-night runner and
// the on-demand /api/cron/poll-live route.
```

Run: `grep -rn "runLiveCycle\|SnapshotPayload\|RECENT_SCORING_LOOKBACK_SECONDS" app src scripts`
Expected: only `app/api/live/route.ts`'s own local `SnapshotPayload` interface (changed in Task 8).

- [ ] **Step 4: One tick per cron request**

In `app/api/cron/poll-live/route.ts`, replace the import of `findLiveCandidates, runLiveCycle` and the `try` block body:

```ts
import { findLiveCandidates } from '../../../../scripts/lib/live-cycle';
import { createPoller } from '../../../../scripts/lib/live-poller';
import { nbaPollerDeps } from '../../../../scripts/lib/live-deps';
import { loadLiveSeq } from '../../../../scripts/lib/live-store';
```

```ts
  try {
    const [candidate] = await findLiveCandidates(sql);
    if (!candidate) {
      return NextResponse.json({ state: 'NO_ACTIVE_GAME' }, { status: 200 });
    }
    const initialSeq = await loadLiveSeq(sql, candidate.game_id);
    const poller = createPoller(
      candidate.nba_game_id,
      candidate.start_time_utc ? new Date(candidate.start_time_utc).getTime() : null,
      nbaPollerDeps(sql, candidate.game_id),
      initialSeq
    );
    const result = await poller.tick();
    if (result.status !== 'ok' || !result.doc) {
      return NextResponse.json({ state: 'NO_ACTIVE_GAME' }, { status: 200 });
    }
    return NextResponse.json(
      { state: 'OK', snapshot_written: result.saved, status: result.doc.status, seq: result.doc.seq },
      { status: 200 }
    );
  } catch (err) {
```

Update the route's header comment. Replace "one scoreboard fetch + snapshot write per request" with "one live poller tick per request (writes live_state)", and replace "every 12s" with "adaptive cadence".

- [ ] **Step 5: Dry-run tool**

Create `scripts/dev/live-dry-run.ts`:

```ts
// scripts/dev/live-dry-run.ts
// Runs the Live v2 poller against a real game with no database and prints
// every save: phase, delay, seq, score and state size. Use with the feed probe
// (.github/workflows/feed-probe.yml) to check the cadence on a real game.
//   npx tsx scripts/dev/live-dry-run.ts [--nba-game=auto|0022600001] [--minutes=20]

import {
  fetchBoxscoreConditional,
  fetchPlayByPlayConditional,
  fetchScoreboard,
} from '../lib/nba-live-client.js';
import { createPoller } from '../lib/live-poller.js';

const arg = (name: string, fallback: string): string =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] || fallback;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  let gameId = arg('nba-game', 'auto');
  if (gameId === 'auto') {
    const games = (await fetchScoreboard()).scoreboard.games;
    const g = games.find((x) => x.gameStatus === 2) ?? games.find((x) => x.gameStatus === 1);
    if (!g) {
      console.log('[dry-run] No game on today\'s scoreboard.');
      return;
    }
    gameId = g.gameId;
  }
  const end = Date.now() + Number(arg('minutes', '20')) * 60_000;
  const poller = createPoller(gameId, null, {
    fetchScoreboard,
    fetchPbp: fetchPlayByPlayConditional,
    fetchBox: fetchBoxscoreConditional,
    saveState: async (d) =>
      console.log(
        `[dry-run] ${new Date().toISOString()} seq ${d.seq} ${d.cadence.phase} next ${d.cadence.next_ms}ms ` +
          `Q${d.period} ${d.clock} ${d.away_score}-${d.home_score} observed ${d.observed_at ?? '—'} ` +
          `${JSON.stringify(d).length} bytes`
      ),
    saveMoment: async (d, reason) => console.log(`[dry-run] moment ${reason} seq ${d.seq}`),
    now: Date.now,
    log: (m) => console.log(`[dry-run] ${m}`),
  });
  while (Date.now() < end) {
    const r = await poller.tick();
    if (r.final) break;
    await sleep(r.delayMs);
  }
}

main().catch((err) => {
  console.error('[dry-run] Failed:', err);
  process.exit(1);
});
```

In `.github/workflows/feed-probe.yml`, replace the "Probe feeds" step's `run:` with a concurrent probe + dry run, and upload both files:

```yaml
      - name: Probe feeds and dry-run the poller
        run: |
          node node_modules/.bin/tsx scripts/dev/feed-probe.ts --minutes="${MINUTES}" --nba-game="${GAME}" --out=feed-probe.ndjson &
          node node_modules/.bin/tsx scripts/dev/live-dry-run.ts --minutes="${MINUTES}" --nba-game="${GAME}" > live-dry-run.log 2>&1 &
          wait
          tail -40 live-dry-run.log
        env:
          MINUTES: ${{ inputs.minutes || '20' }}
          GAME: ${{ inputs.nba_game || 'auto' }}

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: feed-probe
          path: |
            feed-probe.ndjson
            live-dry-run.log
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit -p . && npm run lint && npm test`
Expected: all pass. `src/lib/api-live.test.ts` still passes: the route hasn't changed yet.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/live-deps.ts scripts/dev/live-dry-run.ts scripts/game-night.ts scripts/lib/live-cycle.ts app/api/cron/poll-live/route.ts .github/workflows/feed-probe.yml
git commit -m "feat(live): game-night runner and cron route use the adaptive poller

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Do not deploy between Task 7 and Task 8.** After Task 7 the runner writes `live_state`, but `/api/live` still reads per-poll `live_snapshots`, which now only gets period-end rows.

---

### Task 8: `/api/live` reads `live_state`; clients follow the runner's cadence

**Files:**
- Modify: `src/lib/live-utils.ts`, `src/lib/ui/types.ts` (`LivePayload`), `app/api/live/route.ts`, `hooks/useLiveData.ts`
- Test: `src/lib/api-live.test.ts`, create `src/lib/live-utils.test.ts` (if it doesn't exist; otherwise append)

**Interfaces:**
- Consumes: `LiveStateDoc` shape (Task 4) via the `live_state.state` column.
- Produces: `staleThresholdMs(cadence?: { next_ms: number } | null): number`, `livePollInterval(d?: { state: string; game?: { status?: string } | null; cadence?: { next_ms: number } | null }): number`; `LivePayload.cadence?: { phase: string; next_ms: number } | null`; `/api/live` response gains `cadence`.

- [ ] **Step 1: Write the failing helper tests**

Create or append `src/lib/live-utils.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { livePollInterval, staleThresholdMs } from './live-utils';

describe('staleThresholdMs', () => {
  it('is 30 s at live cadence and cadence + 20 s when slower', () => {
    expect(staleThresholdMs({ next_ms: 3_000 })).toBe(30_000);
    expect(staleThresholdMs({ next_ms: 30_000 })).toBe(50_000);
  });

  it('assumes the old 12 s runner when there is no cadence', () => {
    expect(staleThresholdMs(null)).toBe(32_000);
    expect(staleThresholdMs(undefined)).toBe(32_000);
  });
});

describe('livePollInterval', () => {
  it('polls every 5 minutes with no game and every minute after the final', () => {
    expect(livePollInterval({ state: 'NO_ACTIVE_GAME' })).toBe(300_000);
    expect(livePollInterval({ state: 'LIVE', game: { status: 'final' } })).toBe(60_000);
  });

  it('follows the runner cadence, clamped to 4–30 s', () => {
    expect(livePollInterval({ state: 'LIVE', cadence: { next_ms: 3_000 } })).toBe(4_000);
    expect(livePollInterval({ state: 'LIVE', cadence: { next_ms: 8_000 } })).toBe(8_000);
    expect(livePollInterval({ state: 'DATA_DELAYED', cadence: { next_ms: 60_000 } })).toBe(30_000);
  });

  it('falls back to 12 s while loading or without a cadence', () => {
    expect(livePollInterval(undefined)).toBe(12_000);
    expect(livePollInterval({ state: 'LIVE' })).toBe(12_000);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/live-utils.test.ts`
Expected: FAIL — `livePollInterval` is not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/lib/live-utils.ts`:

```ts
const MIN_STALE_MS = 30_000
const STALE_GRACE_MS = 20_000
const LEGACY_CADENCE_MS = 12_000

/**
 * How old the runner's live state may get before /api/live calls the feed
 * delayed. The runner rewrites it at least every 15 s and polls at
 * cadence.next_ms, so anything past next_ms + 20 s (min 30 s) means it stopped.
 */
export function staleThresholdMs(cadence?: { next_ms: number } | null): number {
  return Math.max(MIN_STALE_MS, (cadence?.next_ms ?? LEGACY_CADENCE_MS) + STALE_GRACE_MS)
}

const IDLE_POLL_MS = 300_000
const FINAL_POLL_MS = 60_000
const DEFAULT_LIVE_POLL_MS = 12_000
const MIN_LIVE_POLL_MS = 4_000   // the CDN caches /api/live for 2 s; faster polls only re-read the cache
const MAX_LIVE_POLL_MS = 30_000

/** SWR refresh interval for /api/live, following the cadence the runner advertises. */
export function livePollInterval(
  d?: { state: string; game?: { status?: string } | null; cadence?: { next_ms: number } | null }
): number {
  if (!d) return DEFAULT_LIVE_POLL_MS
  if (d.state === 'NO_ACTIVE_GAME') return IDLE_POLL_MS
  if (d.game?.status === 'final') return FINAL_POLL_MS
  const hint = d.cadence?.next_ms
  return hint ? Math.min(Math.max(hint, MIN_LIVE_POLL_MS), MAX_LIVE_POLL_MS) : DEFAULT_LIVE_POLL_MS
}
```

Run: `npx vitest run src/lib/live-utils.test.ts`
Expected: PASS.

- [ ] **Step 4: Update the route tests first**

In `src/lib/api-live.test.ts`:
- Rename the first test to `'returns state:"NO_ACTIVE_GAME" with game:null when there is no live state'`.
- Replace the test `'treats a 90s-old snapshot as LIVE (runner polls every 12s, backs off to 60s; stale threshold is 2 min)'` with the tests below.
- Add the header tests below.

```ts
  it('is LIVE while the state is younger than max(30 s, cadence + 20 s)', async () => {
    const fresh = makeFreshSnapRow();
    const snap = {
      ...fresh,
      captured_at: new Date(Date.now() - 25_000).toISOString(),
      payload: { ...fresh.payload, cadence: { phase: 'LIVE', next_ms: 3_000 } },
    };
    mockedSql.mockResolvedValueOnce([snap]).mockResolvedValueOnce([gameRow]);
    const body = await (await GET()).json();
    expect(body.state).toBe('LIVE');
    expect(body.cadence).toEqual({ phase: 'LIVE', next_ms: 3_000 });
  });

  it('is DATA_DELAYED once the state outlives its cadence', async () => {
    const fresh = makeFreshSnapRow();
    const snap = {
      ...fresh,
      captured_at: new Date(Date.now() - 40_000).toISOString(),
      payload: { ...fresh.payload, cadence: { phase: 'LIVE', next_ms: 3_000 } },
    };
    mockedSql.mockResolvedValueOnce([snap]).mockResolvedValueOnce([gameRow]);
    const body = await (await GET()).json();
    expect(body.state).toBe('DATA_DELAYED');
    expect(body.meta.stale_reason).toBe('poll daemon offline');
  });

  it('allows a slow halftime cadence', async () => {
    const fresh = makeFreshSnapRow();
    const snap = {
      ...fresh,
      captured_at: new Date(Date.now() - 45_000).toISOString(),
      payload: { ...fresh.payload, cadence: { phase: 'HALFTIME', next_ms: 30_000 } },
    };
    mockedSql.mockResolvedValueOnce([snap]).mockResolvedValueOnce([gameRow]);
    expect((await (await GET()).json()).state).toBe('LIVE');
  });

  it('lets the Vercel CDN cache live responses for 2 s and idle ones for 30 s, never the browser', async () => {
    mockedSql.mockResolvedValueOnce([makeFreshSnapRow()]).mockResolvedValueOnce([gameRow]);
    const live = await GET();
    expect(live.headers.get('Vercel-CDN-Cache-Control')).toBe('max-age=2, stale-while-revalidate=10');
    expect(live.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');

    mockedSql.mockResolvedValueOnce([]);
    const idle = await GET();
    expect(idle.headers.get('Vercel-CDN-Cache-Control')).toBe('max-age=30, stale-while-revalidate=60');
  });

  it('never caches errors', async () => {
    mockedSql.mockRejectedValueOnce(new Error('boom'));
    const res = await GET();
    expect(res.status).toBe(500);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Vercel-CDN-Cache-Control')).toBeNull();
  });
```

Run: `npx vitest run src/lib/api-live.test.ts`
Expected: the new tests FAIL (no `cadence`, no CDN headers; the 40 s case is still LIVE under the 2-minute threshold).

- [ ] **Step 5: Change the route**

In `app/api/live/route.ts`:

1. Header comment: replace "All data comes from live_snapshots table" with "All data comes from the live_state row the game-night runner writes (scripts/lib/live-poller.ts); no CDN calls from this route."
2. Add `cadence?: { phase: string; next_ms: number };` to the local `SnapshotPayload` interface (the `live_state.state` document is a superset of it).
3. Add the import `import { staleThresholdMs } from '@/src/lib/live-utils';`.
4. Replace `NO_STORE` and the `STALE_THRESHOLD_MS` constant and comment with:

```ts
const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };
// Vercel's CDN absorbs polling: every fan in a region shares one function call
// per 2 s during games (spec §6.2); browsers always revalidate.
const CDN_LIVE = {
  headers: {
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Vercel-CDN-Cache-Control': 'max-age=2, stale-while-revalidate=10',
  },
};
const CDN_IDLE = {
  headers: {
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Vercel-CDN-Cache-Control': 'max-age=30, stale-while-revalidate=60',
  },
};
```

5. Replace the Step 1 query (keep the column aliases, so everything downstream is unchanged):

```ts
    const [snap] = await sql<SnapRow[]>`
      SELECT
        ls.seq                    AS snapshot_id,
        ls.game_id::text          AS game_id,
        (ls.state->>'period')::int       AS period,
        ls.state->>'clock'               AS clock,
        (ls.state->>'home_score')::int   AS home_score,
        (ls.state->>'away_score')::int   AS away_score,
        g.home_team_id::text      AS home_team_id,
        g.away_team_id::text      AS away_team_id,
        to_char(ls.fetched_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS captured_at,
        lac.team_id::text         AS lac_team_id,
        lower(g.status)           AS game_status,
        ls.state                  AS payload
      FROM live_state ls
      JOIN games g ON g.game_id = ls.game_id
      JOIN teams lac ON lac.nba_team_id = ${LAC_NBA_TEAM_ID}
      WHERE (g.home_team_id = lac.team_id OR g.away_team_id = lac.team_id)
        AND (
          (lower(g.status) = 'in_progress' AND ls.fetched_at > now() - interval '12 hours')
          OR ls.fetched_at > now() - interval '30 minutes'
        )
      ORDER BY ls.fetched_at DESC
      LIMIT 1
    `;
```

Update the comment above it: "Only consider live states whose game is still in progress, or that were written in the last 30 minutes…"

6. Replace the age check: `const isAgeStale = status !== 'final' && snapshotAgeMs > STALE_THRESHOLD_MS;` becomes `const isAgeStale = status !== 'final' && snapshotAgeMs > staleThresholdMs(payload.cadence);`. Update its comment to: "Time-based stale check: the runner rewrites live_state at least every 15 s and polls at cadence.next_ms; older than that plus a grace period means it stopped."
7. In the NO_ACTIVE_GAME response, add `cadence: null,` and use `CDN_IDLE` instead of `NO_STORE`.
8. In the DATA_DELAYED and LIVE responses, add `cadence: payload.cadence ?? null,` and use `CDN_LIVE` instead of `NO_STORE`.
9. Leave the 500 response on `NO_STORE`.

In `src/lib/ui/types.ts`, add to `LivePayload`:

```ts
  cadence?: { phase: string; next_ms: number } | null
```

- [ ] **Step 6: Follow the cadence on the client**

Replace `hooks/useLiveData.ts` with:

```ts
'use client'

import useSWR from 'swr'
import { livePollInterval } from '@/src/lib/live-utils'
import type { LivePayload } from '@/src/lib/ui/types'

/** Shape returned by the /api/live endpoint */
export type LiveDashboardPayload = LivePayload

const FETCH_TIMEOUT_MS = 15_000

// Abort hung requests so the page can't sit on its loading skeleton forever.
const fetcher = (url: string): Promise<LivePayload> =>
  fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  })

/**
 * Shared live feed — the TopBar and the Live page read the same SWR key.
 * Polls at the cadence the game-night runner advertises (2–30 s by game phase,
 * clamped to ≥ 4 s because the CDN caches /api/live for 2 s); 5 min when idle.
 * SWR pauses polling while the tab is hidden and refetches on focus.
 */
export function useLiveData() {
  return useSWR<LivePayload>('/api/live', fetcher, {
    refreshInterval: (d) => livePollInterval(d),
    revalidateOnFocus: true,
    dedupingInterval: 2_000,
  })
}
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit -p . && npm run lint && npm test`
Expected: all pass, including the updated `api-live.test.ts`. The '8 min ago' test is still DATA_DELAYED: with no cadence the threshold is 32 s.

- [ ] **Step 8: Check the page against a fixture state**

Run `npm run dev`, then open `http://localhost:3000/dev/live` (the existing live fixture page).
Expected: it renders as before. The fixture page doesn't call `/api/live`, so this only checks nothing in the view broke.

- [ ] **Step 9: Commit**

```bash
git add src/lib/live-utils.ts src/lib/live-utils.test.ts src/lib/ui/types.ts app/api/live/route.ts src/lib/api-live.test.ts hooks/useLiveData.ts
git commit -m "feat(live): /api/live serves live_state through the CDN; clients follow the runner cadence

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Rollout (operational — needs Luke at each step)

- [ ] **Step 1: Production migration** (ask Luke first)

```bash
node --env-file=.env.local -e "const postgres=require('postgres');const fs=require('fs');const sql=postgres(process.env.DATABASE_URL,{max:1});sql.unsafe(fs.readFileSync('Docs/migrations/2026-10-live-v2.sql','utf8')).then(()=>sql\`SELECT to_regclass('public.live_state') AS t\`).then(r=>{console.log(r[0]);return sql.end()}).catch(e=>{console.error(e);process.exit(1)})"
```

Expected: `{ t: 'live_state' }`.

- [ ] **Step 2: Preview deploy and CDN check** (ask Luke before pushing)

```bash
git push -u origin live/v2-realtime
```

Once Vercel builds the preview, request `/api/live` twice within 2 s. If the preview is behind Vercel Deployment Protection, use the `vercel:access-protected-vercel-deployment` skill.

```bash
curl -sI "https://<preview-url>/api/live" | grep -iE "x-vercel-cache|cache-control"
```

Expected: the second request shows `x-vercel-cache: HIT` (or `STALE`), and `cache-control: public, max-age=0, must-revalidate`.

- [ ] **Step 3: Real-game dry run**

The Task 1 probe branch run (or a new `probe/*` push) now also runs `live-dry-run.ts`. Read `live-dry-run.log` and check:
- Phases change sensibly: LIVE 3 s, STOPPAGE on timeouts, HALFTIME.
- Seq increments only on change or every 15 s.
- States are about 60–90 KB.

- [ ] **Step 4: Merge** (Luke's call)

Open a PR `live/v2-realtime → main`. Merging deploys production, which is Git-connected. The next game-night run uses the new poller. After the first Clippers game (opening night is Oct 21 vs SAC), check:
- Vercel usage: function invocations for `/api/live` should be roughly one per 2 s during the game.
- Neon: `live_state` should be 1 row, and `live_snapshots` about 5 rows for the game.
- The `game-night` log.

---

## Plan series

Plans are written just-in-time against the code the previous plan produced:

1. **Feed probe + adaptive runner** — this plan.
2. **Push hub + stream client.** Includes:
   - A Cloudflare Worker `live-hub` with a `GameRoom` Durable Object: hibernating WebSockets, a 150 s ring buffer, bearer-auth `POST /publish`, and an origin check. It's served at `live.lukeghanna.com` (the DNS is already on Cloudflare).
   - A `wrangler` deploy workflow, and a Cloudflare egress check against the NBA CDN.
   - The runner publishing keyframes and deltas (`src/lib/live/protocol.ts`, `applyMessage`).
   - `hooks/useLiveStream.ts` with three tiers: push, `/api/live` poll, ESPN backup.
   - The runner's ESPN source for sustained 403s.
   - A `FeedSource` indicator and a latency debug overlay.
3. **Features** — game flow chart + `stern-v1` win probability (with `calibrate-wp`), the rotation clipboard (on-court stints, foul trouble, minutes vs. usual, units), and spoiler sync (delay buffer, "Sync to my screen", delayed tab title).
