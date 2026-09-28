# Live v2 — Plan 2: Push Hub + Stream Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fans on `/live` get each state change pushed over a WebSocket within about a second of the runner seeing it, for $0/month. `/api/live` polling becomes the fallback, and ESPN's public scoreboard becomes the last-resort backup when the runner is down.

**Architecture:**
- **Runner → hub.** The game-night runner keeps writing `live_state` to Neon. It also publishes each change to a Cloudflare Worker (`live-hub`, at `live.lukeghanna.com`), as a *keyframe* (the full `LiveStateDoc`) every 30 s and as *deltas* in between.
- **Hub → fans.** One Durable Object per game keeps the last ~150 s of messages in SQLite and broadcasts over hibernating WebSockets.
- **Browser.** It rebuilds the page payload by overlaying pushed state on the last `/api/live` response, using the same builders the route uses. It drops to polling if the socket fails, and to ESPN if the runner goes stale.

**Tech Stack:**
- The app: TypeScript, Next.js 16 route handlers, React 19 + SWR, Vitest 4.
- The hub: Cloudflare Workers + Durable Objects (SQLite backend, WebSocket Hibernation API), deployed with `wrangler` 4 and tested with `@cloudflare/vitest-plugin` 1.3 (Vitest 4).

**Spec:** `Docs/superpowers/specs/2026-09-27-live-v2-realtime-design.md` (§4 messages, §6 fan-out, §9 failure modes). Plan 2 of 3 — Plan 1 (`Docs/superpowers/plans/2026-09-27-live-v2-plan-1-runner.md`) is merged and deployed.

## Global Constraints

- **Imports:**
  - Code reachable from `app/` (anything `app/api/**` or a page imports, including `scripts/lib/live-*` via the cron route) uses **suffix-less relative imports** (`from './live-state'`). `.js` suffixes break `next build`.
  - Tests and standalone CLI scripts may keep the existing `.js` style.
- **Verification before every commit:** `npm test`, `npx tsc --noEmit -p .` (prints nothing), `npm run lint` (no new warnings), and **`npm run build`**. Tasks touching `workers/live-hub` also run `npm test` and `npm run typecheck` inside that directory.
- **Documentation paths:** git tracks documentation under `Docs/` (capital D).
- **Unit-tested modules stay DB-free:** modules imported by unit tests must not import `scripts/lib/db.ts` or `src/lib/db.ts`.
- **Dependencies:** no new dependencies in the root `package.json`. `workers/live-hub/` is its own package with its own `package.json` and lockfile. The root `tsconfig.json`, ESLint config and Vitest config must ignore `workers/`.
- **Protocol constants:**
  - Keyframe every 30 s.
  - Hub replay window 150 s (always keeping the newest keyframe older than the window).
  - Hub idle cleanup 6 h after the last publish.
  - Max publish body 512 KB.
  - Hub key = `String(Number(nbaGameId))`, so `0022600093` and `22600093` hit the same room.
- **Client constants:**
  - Reconnect backoff 1 → 2 → 4 → 8 → 16 → 30 s.
  - 3 drops within 60 s → pause push for 60 s.
  - Push counts as fresh while a message arrived < 30 s ago (the runner saves at least every 15 s).
  - Close the socket after 30 s hidden; ping every 25 s.
  - ESPN backup polls every 5 s, only while `/api/live` says DATA_DELAYED, push isn't fresh, and the game is in progress.
  - While push is fresh, `/live` drops its `/api/live` polling to the 30 s "chip" budget.
- **Names:**
  - Env: `NEXT_PUBLIC_LIVE_HUB_URL` (browser, `wss://live.lukeghanna.com`), `LIVE_HUB_URL` (runner, `https://live.lukeghanna.com`), `LIVE_HUB_SECRET` (runner + hub).
  - Everything degrades gracefully when unset. No hub URL means no push and the app behaves as in Plan 1.
- **Hub auth:**
  - `POST /publish/:gameId` and `GET /probe/nba` need `Authorization: Bearer $LIVE_HUB_SECRET` (constant-time compare).
  - `GET /ws/:gameId` needs an `Origin` listed in `ALLOWED_ORIGINS` (`https://clippers.lukeghanna.com,http://localhost:3000`).
- **Approvals:** production actions (Cloudflare deploy, secrets, Vercel env, pushing, merging) need Luke's go-ahead in chat. Everything else runs locally.
- **Fixture DB:** integration tests run on `FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54330/fixture`. The container is `ccc-live-pg`; start it with `docker start ccc-live-pg`.
- **Commit trailer:** commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Deferred items and deviations (rulings carried from Plan 1)

- **Runner ESPN source on sustained NBA 403s (spec §3 rule 3): deferred.**
  - GitHub runners reach the NBA CDN today, and the browser-side ESPN backup (Task 6) covers the fan-facing failure.
  - Revisit if the feed probe or a game night shows 403s.
- **Stays deferred:**
  - A rejected `saveLiveState` write (newer seq stored) is treated as saved. Only the manual cron route could cause it, and the protocol below survives it: deltas carry `base_seq`, and the hub resets on a lower-seq keyframe.
  - `other_games` shows the next day's slate after the scoreboard rolls over.
  - Re-saving `live_state` after `finalizeGame`.
  - Surfacing a BACKOFF phase to clients.
- **Fixed in this plan:**
  - The pre-tip "tip seen up to ~5 min late" issue (Task 1: `upcoming` + 30 s pre-tip polling + early socket).
  - `LivePayload.cadence.phase` typing (Task 1).
  - The route redeclaring the snapshot type (Task 1).

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/live/payload.ts` (create) | Pure builders moved out of `/api/live`: key metrics, box score, live insights; `overlayLiveDoc` |
| `app/api/live/route.ts` (modify) | Use the shared builders; `upcoming` pre-tip; typed payload |
| `src/lib/ui/types.ts`, `src/lib/live-utils.ts` (modify) | `LivePayload.upcoming`, typed `cadence`; 30 s pre-tip polling |
| `src/lib/live/protocol.ts` (create) | `LiveMessage` (keyframe/delta), `diffDocs`, `applyMessage` |
| `scripts/lib/live-publish.ts` (create) | `createPublisher`, `httpPost`, `hubPublisherFromEnv`, `saveThenPublish` |
| `scripts/lib/live-deps.ts`, `scripts/game-night.ts`, `app/api/cron/poll-live/route.ts`, `scripts/dev/live-dry-run.ts`, `.github/workflows/game-night.yml` (modify) | Publish every saved state to the hub |
| `workers/live-hub/**` (create) | Worker + `GameRoom` Durable Object, tests, wrangler config |
| `tsconfig.json`, `eslint.config.mjs` (modify) | Ignore `workers/` |
| `.github/workflows/ci.yml` (modify), `.github/workflows/deploy-live-hub.yml` (create) | Test the hub in CI; deploy it on changes to `main` |
| `src/lib/live/espn-backup.ts` (create) | Parse ESPN's scoreboard; overlay a backup score |
| `src/lib/live/stream.ts` (create) | Pure stream helpers: reconnect, flapping, source, socket URL |
| `hooks/useLiveStream.ts`, `hooks/useVisibleWithGrace.ts` (create) | The three-tier connection manager |
| `components/live/FeedSource.tsx`, `components/live/LatencyOverlay.tsx` (create) | Source indicator; `?debug=latency` overlay |
| `components/live/LiveView.tsx`, `app/live/page.tsx` (modify) | Show the source; use the stream |
| `.env.example` (modify) | The three hub variables |

---

### Task 0: Branch

The worktree `/Users/luke/Claude Projects/CCC-live-v2` is on branch `live/v2-plan2`, created from `main` @ c04d087. This plan is committed there.

- [ ] **Step 1: Verify the baseline**

```bash
cd "/Users/luke/Claude Projects/CCC-live-v2"
git status -sb        # ## live/v2-plan2
npm ci && npm test && npx tsc --noEmit -p . && npm run build
```

Expected: all green. The build lists `/api/live` and `/live`.

---

### Task 1: Shared payload builders, pre-tip `upcoming`, typed cadence

**Files:**
- Create: `src/lib/live/payload.ts`, `src/lib/live/payload.test.ts`
- Modify: `app/api/live/route.ts`, `src/lib/ui/types.ts`, `src/lib/live-utils.ts`, `src/lib/live-utils.test.ts`, `src/lib/api-live.test.ts`

**Interfaces:**
- Produces:
  - `computeKeyMetrics(lacBox: BoxscoreTeam, oppBox: BoxscoreTeam): KeyMetric[]`
  - `buildBoxScore(lacBox, oppBox, lacAbbr: string, oppAbbr: string): NonNullable<LivePayload['box_score']>`
  - `liveInsights(s: LiveInsightInput): Insight[]`
  - `overlayLiveDoc(base: LivePayload, doc: LiveStateDoc): LivePayload`
  - In ui types: `LivePayload.upcoming?: { nba_game_id: string } | null`, `LivePayload.cadence?: { phase: LivePhase; next_ms: number } | null`
  - `livePollInterval` returns 30 000 for NO_ACTIVE_GAME with `upcoming`.

- [ ] **Step 1: Move the builders**

Create `src/lib/live/payload.ts` with this header and imports:

```ts
// src/lib/live/payload.ts
// Pure builders for /api/live's derived fields (key metrics, box score, live
// insights). Shared by the route and by the browser, which rebuilds the page
// payload from pushed live state (Live v2 plan 2). No DB, no Next imports.

import type { BoxscorePlayer, BoxscoreTeam, TeamStatistics } from '../types/live';
import type { LiveStateDoc } from '../types/live-state';
import type { Insight, KeyMetric, LivePayload } from '../ui/types';
import { generateLiveInsights } from '../insights/live';
```

Move these functions **verbatim** from `app/api/live/route.ts`, everything from the `// ── Key metrics computation` banner through the end of `buildBoxScore`: `computeEfg`, `estimatePossessions`, `parseMinutes`, `computeGameMinutes`, the local `KeyMetric` interface, `computeKeyMetrics`, `formatFraction`, `parseMinutesToDisplay`, `buildPlayerRow`, `buildTeamTotals`, `buildBoxScore`. Then delete them from the route.

- Export `computeKeyMetrics` and `buildBoxScore`.
- Replace the local `KeyMetric` interface with the imported ui `KeyMetric`, and give `buildBoxScore` the return type `NonNullable<LivePayload['box_score']>`.
- If a type doesn't line up, change only return-type annotations, never returned values. If values would have to change, stop and report NEEDS_CONTEXT.

Append:

```ts
export interface LiveInsightInput {
  game_id: string;
  home_team_id: string;
  away_team_id: string;
  period: number;
  clock: string;
  home_score: number;
  away_score: number;
  recent_scoring: LiveStateDoc['recent_scoring'];
}

/** Live run/clutch insights, shaped like the route has always returned them. */
export function liveInsights(s: LiveInsightInput): Insight[] {
  return generateLiveInsights(
    {
      game_id: s.game_id,
      period: s.period,
      clock: s.clock,
      home_score: s.home_score,
      away_score: s.away_score,
      home_team_id: s.home_team_id,
      away_team_id: s.away_team_id,
      recent_scoring: s.recent_scoring,
    },
    { home_rolling_10: null, away_rolling_10: null }
  ).map((c, idx) => ({
    insight_id: `live-${s.game_id}-${idx}`,
    category: c.category,
    headline: c.headline,
    detail: c.detail,
    importance: c.importance,
    proof: { summary: c.category, result: c.proof_result[0] ?? null },
  }));
}

/**
 * The page payload with pushed live state laid over the last /api/live
 * response. `base` supplies what the runner doesn't know (team names and ids,
 * odds); everything that changes during a game comes from `doc`.
 */
export function overlayLiveDoc(base: LivePayload, doc: LiveStateDoc): LivePayload {
  const game = base.game;
  if (!game) return base;
  const lacIsHome = game.home.abbreviation === 'LAC';
  const lacBox = lacIsHome ? doc.home_box : doc.away_box;
  const oppBox = lacIsHome ? doc.away_box : doc.home_box;
  const lacAbbr = (lacIsHome ? game.home.abbreviation : game.away.abbreviation) ?? 'LAC';
  const oppAbbr = (lacIsHome ? game.away.abbreviation : game.home.abbreviation) ?? 'OPP';
  return {
    ...base,
    meta: { ...base.meta, generated_at: doc.fetched_at, stale: false, stale_reason: null },
    state: 'LIVE',
    snapshot_captured_at: doc.fetched_at,
    game: {
      ...game,
      status: doc.status,
      status_text: doc.status_text,
      period: doc.period,
      clock: doc.clock,
      periods: doc.periods,
      home: { ...game.home, score: doc.home_score },
      away: { ...game.away, score: doc.away_score },
    },
    key_metrics: lacBox && oppBox ? computeKeyMetrics(lacBox, oppBox) : [],
    box_score: lacBox && oppBox ? buildBoxScore(lacBox, oppBox, lacAbbr, oppAbbr) : null,
    insights: liveInsights({
      game_id: game.game_id,
      home_team_id: game.home.team_id ?? '',
      away_team_id: game.away.team_id ?? '',
      period: doc.period,
      clock: doc.clock,
      home_score: doc.home_score,
      away_score: doc.away_score,
      recent_scoring: doc.recent_scoring,
    }),
    other_games: doc.other_games,
    cadence: doc.cadence,
  };
}
```

In the route's LIVE branch, replace the `liveSnap` + `generateLiveInsights` + `.map(...)` block with:

```ts
    const insights = liveInsights({
      game_id: snap.game_id,
      home_team_id: snap.home_team_id,
      away_team_id: snap.away_team_id,
      period: snap.period,
      clock: snap.clock,
      home_score: snap.home_score,
      away_score: snap.away_score,
      recent_scoring: payload.recent_scoring ?? [],
    });
```

Update the route's imports:
- Add `computeKeyMetrics, buildBoxScore, liveInsights` from `@/src/lib/live/payload`.
- Remove the now-unused `generateLiveInsights` import and the `BoxscorePlayer`/`TeamStatistics` type imports.
- `src/lib/api-live.test.ts` mocks `@/src/lib/insights/live`. The mock keeps working because `payload.ts` imports that same module.

- [ ] **Step 2: Type the snapshot payload from the shared doc**

In the route, replace the local `interface SnapshotPayload { ... }` with:

```ts
import type { LiveStateDoc } from '@/src/lib/types/live-state';

/** The live_state.state document (older rows may lack Live v2 fields). */
type SnapshotPayload = Pick<LiveStateDoc, 'is_stale' | 'stale_reason' | 'home_box' | 'away_box' | 'recent_scoring'> &
  Partial<LiveStateDoc>;
```

In `src/lib/ui/types.ts`, add `import type { LivePhase } from '../types/live-state'` and change `LivePayload`:

```ts
  cadence?: { phase: LivePhase; next_ms: number } | null
  /** Pre-tip: the game the runner is already watching, so clients can connect early. */
  upcoming?: { nba_game_id: string } | null
```

- [ ] **Step 3: Write the failing tests**

Create `src/lib/live/payload.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { overlayLiveDoc } from './payload';
import { box, liveDoc } from '../../../scripts/lib/live-fixtures';
import type { LivePayload } from '../ui/types';

function base(over: Partial<LivePayload> = {}): LivePayload {
  return {
    meta: { generated_at: '2026-10-22T02:40:00.000Z', source: 'mixed', stale: false, stale_reason: null, ttl_seconds: 5 },
    state: 'LIVE',
    game: {
      game_id: '9999', nba_game_id: '22600093', season_id: 2026, game_date: '2026-10-21',
      start_time_utc: '2026-10-22T02:30:00Z', status: 'in_progress', period: 1, clock: '10:00',
      status_text: 'Q1 10:00', periods: [],
      home: { team_id: '13', abbreviation: 'LAC', name: 'Clippers', score: 2, is_home: true },
      away: { team_id: '24', abbreviation: 'SAC', name: 'Kings', score: 0, is_home: false },
    },
    key_metrics: [], box_score: null, insights: [], other_games: [], odds: null,
    cadence: { phase: 'LIVE', next_ms: 3000 },
    ...over,
  };
}

describe('overlayLiveDoc', () => {
  it('returns the base unchanged when there is no game yet', () => {
    const b = base({ state: 'NO_ACTIVE_GAME', game: null });
    expect(overlayLiveDoc(b, liveDoc(5))).toBe(b);
  });

  it('lays the pushed score, clock, line score, cadence and other games over the base', () => {
    const doc = liveDoc(7, {
      home_score: 30, away_score: 28, period: 2, clock: '4:32', status_text: 'Q2 4:32',
      periods: [{ period: 1, home: 20, away: 15 }, { period: 2, home: 10, away: 13 }],
      other_games: [{ game_id: 'x' }], cadence: { phase: 'STOPPAGE', next_ms: 8000 },
      fetched_at: '2026-10-22T03:05:00.000Z',
    });
    const out = overlayLiveDoc(base(), doc);
    expect(out.state).toBe('LIVE');
    expect(out.snapshot_captured_at).toBe('2026-10-22T03:05:00.000Z');
    expect(out.game).toMatchObject({
      period: 2, clock: '4:32', status_text: 'Q2 4:32', periods: doc.periods,
      home: { abbreviation: 'LAC', name: 'Clippers', score: 30 }, away: { abbreviation: 'SAC', score: 28 },
    });
    expect(out.cadence).toEqual({ phase: 'STOPPAGE', next_ms: 8000 });
    expect(out.other_games).toEqual([{ game_id: 'x' }]);
    expect(out.odds).toBeNull();
  });

  it('builds the box score and key metrics with LAC on the correct side', () => {
    const b = box({ home: 30, away: 28 });
    const out = overlayLiveDoc(base(), liveDoc(8, { home_box: b.homeTeam, away_box: b.awayTeam }));
    expect(out.key_metrics.map((m) => m.key)).toEqual(['efg_pct', 'tov_margin', 'reb_margin', 'pace']);
    expect(out.box_score?.teams.map((t) => t.team_abbr)).toEqual(['LAC', 'SAC']);
  });

  it('regenerates live insights from the pushed state (clutch)', () => {
    const out = overlayLiveDoc(base(), liveDoc(9, { period: 4, clock: '3:00', home_score: 100, away_score: 98 }));
    expect(out.insights.some((i) => i.category === 'clutch')).toBe(true);
    expect(out.insights.every((i) => i.insight_id.startsWith('live-9999-'))).toBe(true);
  });
});
```

Also add these tests.

In `src/lib/live-utils.test.ts`:

```ts
  it('polls every 30 s before tip when the runner is already watching a game', () => {
    expect(livePollInterval({ state: 'NO_ACTIVE_GAME', upcoming: { nba_game_id: '22600093' } }, 'cadence')).toBe(30_000);
    expect(livePollInterval({ state: 'NO_ACTIVE_GAME', upcoming: { nba_game_id: '22600093' } }, 'chip')).toBe(30_000);
    expect(livePollInterval({ state: 'NO_ACTIVE_GAME', upcoming: null }, 'cadence')).toBe(300_000);
  });
```

In `src/lib/api-live.test.ts`:
- Extend `'a pre-tip snapshot is NO_ACTIVE_GAME but still feeds other_games'`: add `nba_game_id: '0022600093'` to the payload and assert `expect(body.upcoming).toEqual({ nba_game_id: '0022600093' })`.
- In the first NO_ACTIVE_GAME test, assert `expect(body.upcoming).toBeNull()`.

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run src/lib/live/payload.test.ts src/lib/live-utils.test.ts src/lib/api-live.test.ts`
Expected: `payload.test.ts` passes only if Step 1 is done. The `upcoming` tests FAIL.

- [ ] **Step 5: Implement `upcoming`**

In the route's NO_ACTIVE_GAME response, add:

```ts
          upcoming: payload?.status === 'scheduled' && payload.nba_game_id ? { nba_game_id: payload.nba_game_id } : null,
```

In `src/lib/live-utils.ts`:
- Add `const PRETIP_POLL_MS = 30_000`.
- Widen the `d` parameter type with `upcoming?: { nba_game_id: string } | null`.
- Change the NO_ACTIVE_GAME line to `if (d.state === 'NO_ACTIVE_GAME') return d.upcoming ? PRETIP_POLL_MS : IDLE_POLL_MS`.
- Update the doc comment: "NO_ACTIVE_GAME: 30 s while a game is about to tip (`upcoming`), else 5 min".

- [ ] **Step 6: Verify and commit**

Run the Global Constraints verification, including `npm run build`.

```bash
git add src/lib/live/payload.ts src/lib/live/payload.test.ts app/api/live/route.ts src/lib/ui/types.ts src/lib/live-utils.ts src/lib/live-utils.test.ts src/lib/api-live.test.ts
git commit -m "refactor(live): shared payload builders; pre-tip upcoming game; typed cadence

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Wire protocol

**Files:**
- Create: `src/lib/live/protocol.ts`, `src/lib/live/protocol.test.ts`

**Interfaces:**
- Produces: `TeamPatch`, `KeyframeMessage`, `DeltaMessage`, `LiveMessage` (below), `diffDocs(prev: LiveStateDoc, next: LiveStateDoc): DeltaMessage`, `applyMessage(state: LiveStateDoc | null, msg: LiveMessage): ApplyResult` where `ApplyResult = { state: LiveStateDoc | null; applied: boolean; needKeyframe: boolean }`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/live/protocol.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { BoxscorePlayer, BoxscoreTeam } from '../types/live';
import { applyMessage, diffDocs, type KeyframeMessage } from './protocol';
import { box, liveDoc } from '../../../scripts/lib/live-fixtures';

function player(personId: number, points: number): BoxscorePlayer {
  return {
    status: 'ACTIVE', order: 1, personId, jerseyNum: '1', name: `P${personId}`, nameI: `P${personId}`,
    position: 'G', starter: '1', oncourt: '1', played: '1',
    statistics: {
      assists: 0, blocks: 0, fieldGoalsAttempted: 0, fieldGoalsMade: 0, fieldGoalsPercentage: 0, foulsPersonal: 0,
      freeThrowsAttempted: 0, freeThrowsMade: 0, freeThrowsPercentage: 0, minutes: 'PT10M00.00S',
      minutesCalculated: 'PT10M', plus: 0, minus: 0, plusMinusPoints: 0, points, reboundsDefensive: 0,
      reboundsOffensive: 0, reboundsTotal: 0, steals: 0, threePointersAttempted: 0, threePointersMade: 0,
      threePointersPercentage: 0, turnovers: 0,
    },
  };
}
const team = (side: 'homeTeam' | 'awayTeam', players: BoxscorePlayer[], score: number): BoxscoreTeam =>
  ({ ...box({ home: score, away: score })[side], score, players });

describe('diffDocs + applyMessage', () => {
  const prev = liveDoc(1, { home_box: team('homeTeam', [player(1, 2), player(2, 0)], 2), away_box: team('awayTeam', [player(9, 0)], 0) });

  it('round-trips: applying the delta to prev yields next, sending only what changed', () => {
    const next = liveDoc(2, {
      home_score: 4, clock: '9:40',
      home_box: team('homeTeam', [player(1, 4), player(2, 0)], 4), away_box: prev.away_box,
    });
    const delta = diffDocs(prev, next);
    expect(delta).toMatchObject({ kind: 'delta', seq: 2, base_seq: 1 });
    expect(delta.patch).toMatchObject({ home_score: 4, clock: '9:40' });
    expect(delta.patch).not.toHaveProperty('away_score');
    expect(delta.box?.home?.players.map((p) => p.personId)).toEqual([1]);
    expect(delta.box).not.toHaveProperty('away');
    expect(applyMessage(prev, delta)).toEqual({ state: next, applied: true, needKeyframe: false });
  });

  it('appends new players, and replaces the list when a player disappears', () => {
    const added = liveDoc(2, { home_box: team('homeTeam', [player(1, 2), player(2, 0), player(3, 0)], 2), away_box: prev.away_box });
    const d1 = diffDocs(prev, added);
    expect(d1.box?.home?.players.map((p) => p.personId)).toEqual([3]);
    expect(d1.box?.home?.replace).toBeUndefined();
    expect(applyMessage(prev, d1).state).toEqual(added);

    const removed = liveDoc(2, { home_box: team('homeTeam', [player(1, 2)], 2), away_box: prev.away_box });
    const d2 = diffDocs(prev, removed);
    expect(d2.box?.home?.replace).toBe(true);
    expect(applyMessage(prev, d2).state).toEqual(removed);
  });

  it('sends null when a box disappears', () => {
    const next = liveDoc(2, { home_box: null, away_box: prev.away_box });
    const delta = diffDocs(prev, next);
    expect(delta.box?.home).toBeNull();
    expect(applyMessage(prev, delta).state?.home_box).toBeNull();
  });

  it('needs a keyframe before any delta, and on a base mismatch', () => {
    const delta = diffDocs(prev, liveDoc(2, { home_box: prev.home_box, away_box: prev.away_box }));
    expect(applyMessage(null, delta)).toEqual({ state: null, applied: false, needKeyframe: true });
    const other = liveDoc(0); // behind the delta's seq, but not its base
    expect(applyMessage(other, delta)).toEqual({ state: other, applied: false, needKeyframe: true });
  });

  it('ignores replayed deltas it already has', () => {
    const at3 = liveDoc(3);
    const old = diffDocs(liveDoc(1), liveDoc(2));
    expect(applyMessage(at3, old)).toEqual({ state: at3, applied: false, needKeyframe: false });
  });

  it('takes a newer keyframe; ignores an older one unless it is fresher (runner restart)', () => {
    const current = liveDoc(10, { fetched_at: '2026-10-22T03:00:00.000Z' });
    const newer: KeyframeMessage = { kind: 'keyframe', seq: 11, doc: liveDoc(11) };
    expect(applyMessage(current, newer)).toEqual({ state: newer.doc, applied: true, needKeyframe: false });
    const replayed: KeyframeMessage = { kind: 'keyframe', seq: 4, doc: liveDoc(4, { fetched_at: '2026-10-22T02:58:00.000Z' }) };
    expect(applyMessage(current, replayed)).toEqual({ state: current, applied: false, needKeyframe: false });
    const restarted: KeyframeMessage = { kind: 'keyframe', seq: 3, doc: liveDoc(3, { fetched_at: '2026-10-22T03:00:05.000Z' }) };
    expect(applyMessage(current, restarted).state).toBe(restarted.doc);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/live/protocol.test.ts`
Expected: FAIL — cannot find module `./protocol`.

- [ ] **Step 3: Implement**

Create `src/lib/live/protocol.ts`:

```ts
// src/lib/live/protocol.ts
// Live v2 wire protocol (spec §4): the runner publishes a full keyframe every
// 30 s and deltas in between; the hub relays them; clients rebuild state with
// applyMessage. A delta applies only on top of the exact state it was diffed
// from (base_seq), so a lost message costs one keyframe resync, never a wrong
// score. Pure — shared by scripts/ (publisher) and the browser (hook).

import type { BoxscorePlayer, BoxscoreTeam } from '../types/live';
import type { LiveStateDoc } from '../types/live-state';

/** A changed box score team: header/statistics whole, player rows only if changed. */
export interface TeamPatch {
  team: Omit<BoxscoreTeam, 'players'>;
  players: BoxscorePlayer[];
  /** true → `players` is the complete list (a player disappeared). */
  replace?: true;
}

export interface KeyframeMessage {
  kind: 'keyframe';
  seq: number;
  doc: LiveStateDoc;
  hub_at?: number;              // ms epoch, stamped by the hub on relay
}

export interface DeltaMessage {
  kind: 'delta';
  seq: number;
  base_seq: number;
  patch: Partial<Omit<LiveStateDoc, 'seq' | 'home_box' | 'away_box'>>;
  /** Key present → that box changed; null → it became null. */
  box?: { home?: TeamPatch | null; away?: TeamPatch | null };
  hub_at?: number;
}

export type LiveMessage = KeyframeMessage | DeltaMessage;

export interface ApplyResult {
  state: LiveStateDoc | null;
  applied: boolean;
  needKeyframe: boolean;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function diffTeam(prev: BoxscoreTeam | null, next: BoxscoreTeam | null): TeamPatch | null | undefined {
  if (next === null) return prev === null ? undefined : null;
  const { players, ...team } = next;
  if (!prev) return { team, players };
  const { players: prevPlayers, ...prevTeam } = prev;
  const nextIds = new Set(players.map((p) => p.personId));
  if (prevPlayers.some((p) => !nextIds.has(p.personId))) return { team, players, replace: true };
  const prevRows = new Map(prevPlayers.map((p) => [p.personId, JSON.stringify(p)]));
  const changed = players.filter((p) => prevRows.get(p.personId) !== JSON.stringify(p));
  if (changed.length === 0 && same(prevTeam, team)) return undefined;
  return { team, players: changed };
}

export function diffDocs(prev: LiveStateDoc, next: LiveStateDoc): DeltaMessage {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof LiveStateDoc)[]) {
    if (key === 'seq' || key === 'home_box' || key === 'away_box') continue;
    if (!same(prev[key], next[key])) patch[key] = next[key];
  }
  const box: NonNullable<DeltaMessage['box']> = {};
  const home = diffTeam(prev.home_box, next.home_box);
  if (home !== undefined) box.home = home;
  const away = diffTeam(prev.away_box, next.away_box);
  if (away !== undefined) box.away = away;
  return {
    kind: 'delta',
    seq: next.seq,
    base_seq: prev.seq,
    patch: patch as DeltaMessage['patch'],
    ...(Object.keys(box).length > 0 ? { box } : {}),
  };
}

function applyTeam(prev: BoxscoreTeam | null, patch: TeamPatch | null): BoxscoreTeam | null {
  if (patch === null) return null;
  if (patch.replace || !prev) return { ...patch.team, players: patch.players };
  const byId = new Map(patch.players.map((p) => [p.personId, p]));
  const players = prev.players.map((p) => byId.get(p.personId) ?? p);
  const known = new Set(prev.players.map((p) => p.personId));
  for (const p of patch.players) if (!known.has(p.personId)) players.push(p);
  return { ...patch.team, players };
}

export function applyMessage(state: LiveStateDoc | null, msg: LiveMessage): ApplyResult {
  if (msg.kind === 'keyframe') {
    const fresher = !state || msg.seq > state.seq || Date.parse(msg.doc.fetched_at) > Date.parse(state.fetched_at);
    return fresher
      ? { state: msg.doc, applied: true, needKeyframe: false }
      : { state, applied: false, needKeyframe: false };
  }
  if (!state) return { state, applied: false, needKeyframe: true };
  if (msg.seq <= state.seq) return { state, applied: false, needKeyframe: false };
  if (msg.base_seq !== state.seq) return { state, applied: false, needKeyframe: true };
  const next = { ...state, ...msg.patch, seq: msg.seq } as LiveStateDoc;
  if (msg.box && 'home' in msg.box) next.home_box = applyTeam(state.home_box, msg.box.home ?? null);
  if (msg.box && 'away' in msg.box) next.away_box = applyTeam(state.away_box, msg.box.away ?? null);
  return { state: next, applied: true, needKeyframe: false };
}
```

- [ ] **Step 4: Verify and commit**

Run `npx vitest run src/lib/live/protocol.test.ts` (PASS), then the Global Constraints verification.

```bash
git add src/lib/live/protocol.ts src/lib/live/protocol.test.ts
git commit -m "feat(live): keyframe/delta wire protocol

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Runner publishes to the hub

**Files:**
- Create: `scripts/lib/live-publish.ts`, `scripts/lib/live-publish.test.ts`
- Modify: `scripts/lib/live-deps.ts`, `scripts/game-night.ts`, `app/api/cron/poll-live/route.ts`, `scripts/dev/live-dry-run.ts`, `.github/workflows/game-night.yml`, `.env.example`

**Interfaces:**
- Consumes: `LiveMessage`, `diffDocs` (Task 2).
- Produces:
  - `KEYFRAME_EVERY_MS = 30_000`
  - `interface Publisher { publish(doc: LiveStateDoc): Promise<boolean> }`
  - `createPublisher(o: { post(msg: LiveMessage): Promise<void>; now(): number; keyframeEveryMs?: number; log?(m: string): void }): Publisher`
  - `httpPost(hubUrl: string, secret: string, nbaGameId: string, timeoutMs?: number): (msg: LiveMessage) => Promise<void>`
  - `hubPublisherFromEnv(nbaGameId: string, env?: NodeJS.ProcessEnv): Publisher | null`
  - `saveThenPublish(doc, save: (d) => Promise<unknown>, publisher: Publisher | null): Promise<void>`
  - `nbaPollerDeps(sql, gameDbId, nbaGameId)` (third parameter added)

- [ ] **Step 1: Write the failing tests**

Create `scripts/lib/live-publish.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveMessage } from '../../src/lib/live/protocol';
import { createPublisher, hubPublisherFromEnv, saveThenPublish } from './live-publish';
import { liveDoc } from './live-fixtures';

describe('createPublisher', () => {
  it('sends a keyframe first, deltas within 30 s, and a keyframe again after 30 s', async () => {
    let t = 0;
    const sent: LiveMessage[] = [];
    const p = createPublisher({ post: async (m) => { sent.push(m); }, now: () => t });
    await p.publish(liveDoc(1));
    t += 3_000;
    await p.publish(liveDoc(2, { home_score: 4 }));
    t += 30_000;
    await p.publish(liveDoc(3, { home_score: 6 }));
    expect(sent.map((m) => m.kind)).toEqual(['keyframe', 'delta', 'keyframe']);
    expect(sent[1]).toMatchObject({ seq: 2, base_seq: 1, patch: { home_score: 4 } });
  });

  it('never throws; after a failed post the next message is a keyframe', async () => {
    const sent: LiveMessage[] = [];
    const post = vi.fn(async (m: LiveMessage) => { sent.push(m); })
      .mockImplementationOnce(async () => {})               // keyframe ok
      .mockImplementationOnce(async () => { throw new Error('hub 503'); });
    const p = createPublisher({ post, now: () => 0 });
    expect(await p.publish(liveDoc(1))).toBe(true);
    expect(await p.publish(liveDoc(2))).toBe(false);
    expect(await p.publish(liveDoc(3))).toBe(true);
    expect(sent.at(-1)?.kind).toBe('keyframe');
  });
});

describe('hubPublisherFromEnv', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is null without both env vars', () => {
    expect(hubPublisherFromEnv('0022600093', {})).toBeNull();
    expect(hubPublisherFromEnv('0022600093', { LIVE_HUB_URL: 'https://hub' })).toBeNull();
  });

  it('POSTs messages to /publish/:gameId with the bearer secret', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const p = hubPublisherFromEnv('0022600093', { LIVE_HUB_URL: 'https://hub/', LIVE_HUB_SECRET: 's3cret' })!;
    expect(await p.publish(liveDoc(1))).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://hub/publish/0022600093');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer s3cret');
    expect(JSON.parse(init.body as string)).toMatchObject({ kind: 'keyframe', seq: 1 });
  });

  it('treats a non-2xx hub response as a failed publish', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 401 })));
    const p = hubPublisherFromEnv('1', { LIVE_HUB_URL: 'https://hub', LIVE_HUB_SECRET: 'x' })!;
    expect(await p.publish(liveDoc(1))).toBe(false);
  });
});

describe('saveThenPublish', () => {
  it('fails only when the database save fails', async () => {
    const pub = { publish: vi.fn(async () => false) };
    await expect(saveThenPublish(liveDoc(1), async () => true, pub)).resolves.toBeUndefined();
    await expect(saveThenPublish(liveDoc(1), async () => { throw new Error('db down'); }, pub)).rejects.toThrow('db down');
    await expect(saveThenPublish(liveDoc(1), async () => true, null)).resolves.toBeUndefined();
    expect(pub.publish).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run scripts/lib/live-publish.test.ts`
Expected: FAIL — cannot find module `./live-publish`.

- [ ] **Step 3: Implement**

Create `scripts/lib/live-publish.ts`:

```ts
// scripts/lib/live-publish.ts
// Publishes the runner's live state to the Cloudflare live hub (spec §6.1):
// a keyframe every 30 s (and after any failed post), deltas in between.
// Publishing is best-effort — the database write is the source of truth and
// /api/live keeps working without the hub.

import type { LiveStateDoc } from '../../src/lib/types/live-state';
import { diffDocs, type LiveMessage } from '../../src/lib/live/protocol';

export const KEYFRAME_EVERY_MS = 30_000;
const PUBLISH_TIMEOUT_MS = 3_000;

export interface Publisher {
  publish(doc: LiveStateDoc): Promise<boolean>;
}

export function createPublisher(o: {
  post(msg: LiveMessage): Promise<void>;
  now(): number;
  keyframeEveryMs?: number;
  log?(msg: string): void;
}): Publisher {
  let last: LiveStateDoc | null = null;
  let lastKeyframeAt = Number.NEGATIVE_INFINITY;
  const every = o.keyframeEveryMs ?? KEYFRAME_EVERY_MS;
  return {
    async publish(doc) {
      const now = o.now();
      const keyframe = last === null || now - lastKeyframeAt >= every;
      const msg: LiveMessage = keyframe ? { kind: 'keyframe', seq: doc.seq, doc } : diffDocs(last!, doc);
      try {
        await o.post(msg);
      } catch (err) {
        o.log?.(`hub publish failed (seq ${doc.seq}): ${(err as Error).message}`);
        last = null; // the next publish resynchronizes everyone with a keyframe
        return false;
      }
      last = doc;
      if (keyframe) lastKeyframeAt = now;
      return true;
    },
  };
}

export function httpPost(hubUrl: string, secret: string, nbaGameId: string, timeoutMs = PUBLISH_TIMEOUT_MS) {
  const url = `${hubUrl.replace(/\/+$/, '')}/publish/${nbaGameId}`;
  return async (msg: LiveMessage): Promise<void> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`hub ${res.status}`);
  };
}

/** A publisher for this game when LIVE_HUB_URL and LIVE_HUB_SECRET are set, else null. */
export function hubPublisherFromEnv(nbaGameId: string, env: NodeJS.ProcessEnv = process.env): Publisher | null {
  const url = env.LIVE_HUB_URL;
  const secret = env.LIVE_HUB_SECRET;
  if (!url || !secret) return null;
  return createPublisher({
    post: httpPost(url, secret, nbaGameId),
    now: Date.now,
    log: (m) => console.log(`[live] ${m}`),
  });
}

/** Save to the database and publish concurrently; only a failed save is an error. */
export async function saveThenPublish(
  doc: LiveStateDoc,
  save: (doc: LiveStateDoc) => Promise<unknown>,
  publisher: Publisher | null
): Promise<void> {
  const [saved] = await Promise.allSettled([save(doc), publisher?.publish(doc)]);
  if (saved.status === 'rejected') throw saved.reason;
}
```

In `scripts/lib/live-deps.ts`:
- Change the signature to `nbaPollerDeps(sql: Sql, gameDbId: string, nbaGameId: string): PollerDeps`.
- Add `const hub = hubPublisherFromEnv(nbaGameId);` at the top of the function.
- Replace `saveState` with `saveState: (doc) => saveThenPublish(doc, (d) => saveLiveState(sql, gameDbId, d), hub),`.
- Import `hubPublisherFromEnv, saveThenPublish` from `'./live-publish'` (no suffix).

Update both callers to pass the third argument:
- `scripts/game-night.ts`: `nbaPollerDeps(sql, candidate.game_id, candidate.nba_game_id)`.
- `app/api/cron/poll-live/route.ts`: `nbaPollerDeps(sql, candidate.game_id, candidate.nba_game_id)`.

In `scripts/dev/live-dry-run.ts`:
- Add a `--publish` flag.
- When it's set and `hubPublisherFromEnv(gameId)` isn't null, call `await hub.publish(d)` inside `saveState` after logging, and log `publish ok|failed`.
- The dry run can then push any live NBA game to the hub during preseason.

In `.github/workflows/game-night.yml`, add to the poller step's `env:`:

```yaml
          LIVE_HUB_URL: ${{ vars.LIVE_HUB_URL }}
          LIVE_HUB_SECRET: ${{ secrets.LIVE_HUB_SECRET }}
```

Append to `.env.example`:

```bash
# Live v2 push hub (Cloudflare Worker, workers/live-hub). Unset → no push; /live polls /api/live.
# Runner + cron route publish here (https), browsers connect here (wss).
LIVE_HUB_URL=https://live.lukeghanna.com
LIVE_HUB_SECRET=generate_with_openssl_rand_hex_32
NEXT_PUBLIC_LIVE_HUB_URL=wss://live.lukeghanna.com
```

- [ ] **Step 4: Verify and commit**

Run `npx vitest run scripts/lib/live-publish.test.ts` (PASS), then the Global Constraints verification, including `npm run build` (the cron route now bundles `live-publish` and `protocol`).

```bash
git add scripts/lib/live-publish.ts scripts/lib/live-publish.test.ts scripts/lib/live-deps.ts scripts/game-night.ts app/api/cron/poll-live/route.ts scripts/dev/live-dry-run.ts .github/workflows/game-night.yml .env.example
git commit -m "feat(live): runner publishes keyframes and deltas to the live hub

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The hub — Worker + `GameRoom` Durable Object

**Files:**
- Create: `workers/live-hub/package.json`, `workers/live-hub/wrangler.jsonc`, `workers/live-hub/tsconfig.json`, `workers/live-hub/vitest.config.ts`, `workers/live-hub/src/index.ts`, `workers/live-hub/src/game-room.ts`, `workers/live-hub/src/secrets.d.ts`, `workers/live-hub/test/hub.test.ts`, `workers/live-hub/.gitignore`, generated `workers/live-hub/worker-configuration.d.ts`, `workers/live-hub/package-lock.json`
- Modify: `tsconfig.json` (exclude `workers`), `eslint.config.mjs` (ignore `workers/**`)

**Interfaces:**
- Produces:
  - HTTP: `GET /health` → 200 `ok`.
  - `POST /publish/:gameId` (bearer) → 204. Returns 400 for bad JSON, a bad message or a bad id; 401 without auth; 413 when over 512 KB.
  - `GET /ws/:gameId` (Upgrade + allowed Origin) → 101. Returns 426 without an upgrade, 403 for a bad origin.
  - `GET /probe/nba` (bearer) → JSON `{ status, bytes, ms }`.
  - Every relayed message is the published JSON plus `hub_at` (ms epoch). A client sending `resync` gets the replay again.
  - Exports `gameKey(raw: string): string | null`, `isAllowedOrigin(origin: string | null, allowed: string): boolean`, `GameRoom` (with public `replay(): string[]` and `prune(now: number): void`), and the default `{ fetch }`.

- [ ] **Step 1: Scaffold the package**

Create `workers/live-hub/package.json`:

```json
{
  "name": "ccc-live-hub",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "types": "wrangler types",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@cloudflare/vitest-plugin": "^1.3.0",
    "typescript": "^5.9.3",
    "vitest": "^4.1.0",
    "wrangler": "^4.142.0"
  }
}
```

Create `workers/live-hub/wrangler.jsonc`:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "ccc-live-hub",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "durable_objects": {
    "bindings": [{ "name": "GAME_ROOM", "class_name": "GameRoom" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["GameRoom"] }],
  "vars": {
    "ALLOWED_ORIGINS": "https://clippers.lukeghanna.com,http://localhost:3000"
  },
  "observability": { "enabled": true }
}
```

Create `workers/live-hub/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "es2024",
    "lib": ["es2024"],
    "module": "es2022",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["@cloudflare/vitest-plugin/types"]
  },
  "include": ["src", "test", "worker-configuration.d.ts", "vitest.config.ts"]
}
```

Create `workers/live-hub/vitest.config.ts`:

```ts
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { bindings: { LIVE_HUB_SECRET: 'test-secret' } },
    }),
  ],
});
```

Create `workers/live-hub/src/secrets.d.ts`:

```ts
// Secrets aren't in wrangler.jsonc, so `wrangler types` doesn't emit them.
declare namespace Cloudflare {
  interface Env {
    LIVE_HUB_SECRET: string;
  }
}
```

Create `workers/live-hub/.gitignore` with `node_modules/`, `.wrangler/` and `.dev.vars`.

Then:

```bash
cd workers/live-hub && npm install && npx wrangler types
```

This writes `package-lock.json` and `worker-configuration.d.ts`; commit both. Check that `worker-configuration.d.ts` declares `GAME_ROOM: DurableObjectNamespace<...>` and `ALLOWED_ORIGINS`.

In the repo root:
- In `tsconfig.json`, change `"exclude": ["node_modules"]` to `"exclude": ["node_modules", "workers"]`.
- In `eslint.config.mjs`, add `"workers/**",` to `globalIgnores`.
- Root Vitest only includes `scripts/lib` and `src/lib`, so it needs no change.

- [ ] **Step 2: Write the failing tests**

Create `workers/live-hub/test/hub.test.ts`:

```ts
import { env } from 'cloudflare:workers';
import { createExecutionContext, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker, { gameKey, isAllowedOrigin, type GameRoom } from '../src/index';

const AUTH = { Authorization: 'Bearer test-secret' };
const call = (req: Request) => worker.fetch(req, env, createExecutionContext());
const publish = (game: string, msg: unknown, headers: Record<string, string> = AUTH) =>
  call(new Request(`https://hub/publish/${game}`, { method: 'POST', headers, body: JSON.stringify(msg) }));
const keyframe = (seq: number) => ({ kind: 'keyframe', seq, doc: { seq, fetched_at: new Date().toISOString() } });
const delta = (seq: number) => ({ kind: 'delta', seq, base_seq: seq - 1, patch: {} });

async function openSocket(game: string, origin = 'http://localhost:3000') {
  const res = await call(new Request(`https://hub/ws/${game}`, { headers: { Upgrade: 'websocket', Origin: origin } }));
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  const got: Array<{ kind: string; seq: number; hub_at: number }> = [];
  ws.addEventListener('message', (e) => { if (e.data !== 'pong') got.push(JSON.parse(e.data as string)); });
  ws.accept();
  return { ws, got };
}

async function until(check: () => boolean, ms = 2_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('helpers', () => {
  it('normalizes game ids so 10-char and numeric ids share a room', () => {
    expect(gameKey('0022600093')).toBe('22600093');
    expect(gameKey('22600093')).toBe('22600093');
    expect(gameKey('abc')).toBeNull();
    expect(gameKey('0')).toBeNull();
  });

  it('allows only listed origins', () => {
    expect(isAllowedOrigin('http://localhost:3000', env.ALLOWED_ORIGINS)).toBe(true);
    expect(isAllowedOrigin('https://evil.example', env.ALLOWED_ORIGINS)).toBe(false);
    expect(isAllowedOrigin(null, env.ALLOWED_ORIGINS)).toBe(false);
  });
});

describe('http', () => {
  it('serves health', async () => {
    const res = await call(new Request('https://hub/health'));
    expect(res.status).toBe(200);
  });

  it('rejects publishes without the secret, with a bad id, or with a bad body', async () => {
    expect((await publish('1', keyframe(1), {})).status).toBe(401);
    expect((await publish('1', keyframe(1), { Authorization: 'Bearer nope' })).status).toBe(401);
    expect((await publish('nope', keyframe(1))).status).toBe(400);
    expect((await publish('1', { kind: 'other', seq: 1 })).status).toBe(400);
    const bad = await call(new Request('https://hub/publish/1', { method: 'POST', headers: AUTH, body: '{' }));
    expect(bad.status).toBe(400);
  });

  it('rejects sockets without an upgrade or from other origins', async () => {
    expect((await call(new Request('https://hub/ws/1'))).status).toBe(426);
    const res = await call(new Request('https://hub/ws/1', { headers: { Upgrade: 'websocket', Origin: 'https://evil.example' } }));
    expect(res.status).toBe(403);
  });
});

describe('GameRoom', () => {
  it('replays from the oldest keyframe to a new socket, stamped with hub_at', async () => {
    expect((await publish('101', keyframe(1))).status).toBe(204);
    await publish('101', delta(2));
    const { got } = await openSocket('101');
    await until(() => got.length === 2);
    expect(got.map((m) => [m.kind, m.seq])).toEqual([['keyframe', 1], ['delta', 2]]);
    expect(typeof got[0].hub_at).toBe('number');
  });

  it('broadcasts new messages to connected sockets, and replays on resync', async () => {
    await publish('102', keyframe(1));
    const { ws, got } = await openSocket('0000000102');
    await until(() => got.length === 1);
    await publish('102', delta(2));
    await until(() => got.length === 2);
    ws.send('resync');
    await until(() => got.length === 4);
    expect(got.map((m) => m.seq)).toEqual([1, 2, 1, 2]);
  });

  it('keeps the newest keyframe older than the window and everything after it', async () => {
    const stub = env.GAME_ROOM.getByName('103');
    await publish('103', keyframe(1));
    await runInDurableObject(stub, async (room: GameRoom, state) => {
      const old = Date.now() - 200_000;
      state.storage.sql.exec('DELETE FROM messages');
      const insert = (seq: number, kind: string, at: number) =>
        state.storage.sql.exec('INSERT INTO messages (seq, kind, at_ms, body) VALUES (?, ?, ?, ?)', seq, kind, at, JSON.stringify({ kind, seq }));
      insert(1, 'keyframe', old);
      insert(2, 'delta', old);
      insert(3, 'keyframe', old + 10_000);
      insert(4, 'delta', Date.now());
      room.prune(Date.now());
      expect(room.replay().map((b) => JSON.parse(b).seq)).toEqual([3, 4]);
    });
  });

  it('starts over when a restarted runner publishes a lower-seq keyframe', async () => {
    await publish('104', keyframe(50));
    await publish('104', delta(51));
    await publish('104', keyframe(3));
    const { got } = await openSocket('104');
    await until(() => got.length === 1);
    expect(got.map((m) => m.seq)).toEqual([3]);
  });

  it('clears its messages when the idle alarm fires', async () => {
    const stub = env.GAME_ROOM.getByName('105');
    await publish('105', keyframe(1));
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await runInDurableObject(stub, (room: GameRoom) => {
      expect(room.replay()).toEqual([]);
    });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd workers/live-hub && npm test`
Expected: FAIL — `../src/index` not found.

- [ ] **Step 4: Implement**

Create `workers/live-hub/src/game-room.ts`:

```ts
// workers/live-hub/src/game-room.ts
// One Durable Object per game (Live v2 spec §6.1). Keeps the last ~150 s of
// published messages in SQLite so a new or reconnecting fan can rebuild state
// from a keyframe, and relays every new message to all connected sockets.
// Sockets use the Hibernation API: an idle room costs nothing.

import { DurableObject } from 'cloudflare:workers';

export const REPLAY_WINDOW_MS = 150_000;
export const IDLE_CLEANUP_MS = 6 * 60 * 60_000;

export class GameRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY, kind TEXT NOT NULL, at_ms INTEGER NOT NULL, body TEXT NOT NULL)'
    );
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') === 'websocket') return this.connect();
    if (request.method === 'POST' && new URL(request.url).pathname === '/publish') {
      return this.publish(await request.text());
    }
    return new Response('not found', { status: 404 });
  }

  private connect(): Response {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    for (const body of this.replay()) server.send(body);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async publish(raw: string): Promise<Response> {
    let msg: { kind?: unknown; seq?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return new Response('bad json', { status: 400 });
    }
    if ((msg.kind !== 'keyframe' && msg.kind !== 'delta') || !Number.isInteger(msg.seq)) {
      return new Response('bad message', { status: 400 });
    }
    const seq = msg.seq as number;
    const now = Date.now();
    // A restarted runner continues from the database's seq, which can be
    // behind what it already published: its first keyframe starts a new epoch.
    const max = this.ctx.storage.sql.exec<{ seq: number | null }>('SELECT max(seq) AS seq FROM messages').one().seq;
    if (msg.kind === 'keyframe' && max !== null && seq <= max) this.ctx.storage.sql.exec('DELETE FROM messages');

    const body = JSON.stringify({ ...msg, hub_at: now });
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO messages (seq, kind, at_ms, body) VALUES (?, ?, ?, ?)',
      seq, msg.kind, now, body
    );
    this.prune(now);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(body);
      } catch {
        // The socket is closing; the runtime drops it.
      }
    }
    await this.ctx.storage.setAlarm(now + IDLE_CLEANUP_MS);
    return new Response(null, { status: 204 });
  }

  /** Drop everything before the newest keyframe that is already outside the replay window. */
  prune(now: number): void {
    const cut = this.ctx.storage.sql
      .exec<{ seq: number | null }>("SELECT max(seq) AS seq FROM messages WHERE kind = 'keyframe' AND at_ms <= ?", now - REPLAY_WINDOW_MS)
      .one().seq;
    if (cut !== null) this.ctx.storage.sql.exec('DELETE FROM messages WHERE seq < ?', cut);
  }

  /** The oldest stored keyframe and every message after it, in order. */
  replay(): string[] {
    const first = this.ctx.storage.sql
      .exec<{ seq: number | null }>("SELECT min(seq) AS seq FROM messages WHERE kind = 'keyframe'")
      .one().seq;
    if (first === null) return [];
    return this.ctx.storage.sql
      .exec<{ body: string }>('SELECT body FROM messages WHERE seq >= ? ORDER BY seq', first)
      .toArray()
      .map((row) => row.body);
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === 'resync') for (const body of this.replay()) ws.send(body);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    ws.close(code, reason);
  }

  async alarm(): Promise<void> {
    this.ctx.storage.sql.exec('DELETE FROM messages');
  }
}
```

Create `workers/live-hub/src/index.ts`:

```ts
// workers/live-hub/src/index.ts
// Live v2 push hub (spec §6.1): the game-night runner POSTs live state here;
// fans' browsers hold a WebSocket per game. Routing, auth and origin checks
// live here; each game's state and sockets live in a GameRoom Durable Object.

import { GameRoom } from './game-room';

export { GameRoom };

const MAX_BODY_BYTES = 512 * 1024;
const NBA_PROBE_URL = 'https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json';
const NBA_HEADERS = {
  Accept: 'application/json',
  Referer: 'https://www.nba.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

/** "0022600093" and "22600093" name the same room. */
export function gameKey(raw: string): string | null {
  if (!/^\d{1,12}$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 ? String(n) : null;
}

export function isAllowedOrigin(origin: string | null, allowed: string): boolean {
  if (!origin) return false;
  return allowed.split(',').map((s) => s.trim()).filter(Boolean).includes(origin);
}

function authorized(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const got = request.headers.get('Authorization') ?? '';
  const want = `Bearer ${secret}`;
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

async function probeNba(): Promise<Response> {
  const started = Date.now();
  const res = await fetch(NBA_PROBE_URL, { headers: NBA_HEADERS });
  const bytes = (await res.arrayBuffer()).byteLength;
  return Response.json({ status: res.status, bytes, ms: Date.now() - started });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const [, route, id] = url.pathname.split('/');

    if (url.pathname === '/health') return new Response('ok');

    if (route === 'probe' && id === 'nba' && request.method === 'GET') {
      if (!authorized(request, env.LIVE_HUB_SECRET)) return new Response('unauthorized', { status: 401 });
      return probeNba();
    }

    if (route === 'publish' && request.method === 'POST') {
      if (!authorized(request, env.LIVE_HUB_SECRET)) return new Response('unauthorized', { status: 401 });
      const key = id ? gameKey(id) : null;
      if (!key) return new Response('bad game id', { status: 400 });
      const body = await request.text();
      if (body.length > MAX_BODY_BYTES) return new Response('too large', { status: 413 });
      return env.GAME_ROOM.getByName(key).fetch(new Request('https://room/publish', { method: 'POST', body }));
    }

    if (route === 'ws' && request.method === 'GET') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      if (!isAllowedOrigin(request.headers.get('Origin'), env.ALLOWED_ORIGINS)) {
        return new Response('forbidden origin', { status: 403 });
      }
      const key = id ? gameKey(id) : null;
      if (!key) return new Response('bad game id', { status: 400 });
      return env.GAME_ROOM.getByName(key).fetch(request);
    }

    return new Response('not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

If a test fails on a runtime API detail, check the Cloudflare docs and fix the implementation, not the test's intent. Examples: `getByName`, `sql.exec(...).one()`, or sending on the server socket before the 101 is returned. Record any API correction in the report.

- [ ] **Step 5: Verify and commit**

```bash
cd workers/live-hub && npm test && npm run typecheck && cd ../..
npm test && npx tsc --noEmit -p . && npm run lint && npm run build
git add workers/live-hub tsconfig.json eslint.config.mjs
git commit -m "feat(live): Cloudflare live hub (Worker + GameRoom Durable Object)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Hub custom domain, CI and deploy workflow

**Files:**
- Modify: `workers/live-hub/wrangler.jsonc`, `.github/workflows/ci.yml`
- Create: `.github/workflows/deploy-live-hub.yml`, `workers/live-hub/README.md`

- [ ] **Step 1: Custom domain**

Add to `workers/live-hub/wrangler.jsonc`, after `"compatibility_date"`:

```jsonc
  "routes": [{ "pattern": "live.lukeghanna.com", "custom_domain": true }],
```

`lukeghanna.com`'s DNS is on Cloudflare, so `wrangler deploy` creates the `live` record. Run `cd workers/live-hub && npx wrangler deploy --dry-run --outdir .wrangler/dry`. Expected: it bundles without errors. It doesn't need Cloudflare credentials.

- [ ] **Step 2: Test the hub in CI**

In `.github/workflows/ci.yml`, add a second job:

```yaml
  live-hub:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    defaults:
      run:
        working-directory: workers/live-hub
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-node@v5
        with:
          node-version: '24'
          cache: 'npm'
          cache-dependency-path: workers/live-hub/package-lock.json

      - run: npm ci

      - name: Typecheck
        run: npm run typecheck

      - name: Tests (workerd)
        run: npm test
```

- [ ] **Step 3: Deploy workflow**

Create `.github/workflows/deploy-live-hub.yml`:

```yaml
name: Deploy live hub

# Deploys workers/live-hub (the Live v2 push hub, live.lukeghanna.com) when it
# changes on main. Needs repo secrets CLOUDFLARE_API_TOKEN (Workers Scripts:
# Edit + Zone DNS: Edit on lukeghanna.com) and CLOUDFLARE_ACCOUNT_ID.
on:
  push:
    branches: [main]
    paths: ['workers/live-hub/**']
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: live-hub-deploy
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    defaults:
      run:
        working-directory: workers/live-hub
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-node@v5
        with:
          node-version: '24'
          cache: 'npm'
          cache-dependency-path: workers/live-hub/package-lock.json

      - run: npm ci

      - run: npm test

      - name: Deploy
        run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

- [ ] **Step 4: Operator README**

Create `workers/live-hub/README.md`. It covers:
- What the hub is, with one paragraph and a link to the spec §6.1.
- The endpoints (from Task 4's Interfaces).
- The runbook below.

Runbook:
- First deploy: `npx wrangler login`, then `npx wrangler deploy`.
- Set the secret: `openssl rand -hex 32 | npx wrangler secret put LIVE_HUB_SECRET`.
- Health: `curl https://live.lukeghanna.com/health`.
- The NBA reachability probe: `curl -H "Authorization: Bearer $LIVE_HUB_SECRET" https://live.lukeghanna.com/probe/nba`.
- A publish smoke test with a fake keyframe to game `1`:

  ```bash
  curl -X POST -H "Authorization: Bearer $LIVE_HUB_SECRET" -d '{"kind":"keyframe","seq":1,"doc":{"seq":1,"fetched_at":"2026-10-01T00:00:00Z"}}' https://live.lukeghanna.com/publish/1
  ```

- A browser-console socket check on https://clippers.lukeghanna.com:

  ```js
  const ws = new WebSocket('wss://live.lukeghanna.com/ws/1'); ws.onmessage = (e) => console.log(e.data)
  ```

- Where logs are: `npx wrangler tail`.

- [ ] **Step 5: Verify and commit**

Run the root verification (test, tsc, lint, build) and `cd workers/live-hub && npm test`.

```bash
git add workers/live-hub/wrangler.jsonc workers/live-hub/README.md .github/workflows/ci.yml .github/workflows/deploy-live-hub.yml
git commit -m "ci(live): test and deploy the live hub; custom domain live.lukeghanna.com

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: ESPN backup parser

**Files:**
- Create: `src/lib/live/espn-backup.ts`, `src/lib/live/espn-backup.test.ts`

**Interfaces:**
- Produces:
  - `ESPN_SCOREBOARD_URL`
  - `interface EspnScore { home: number; away: number; period: number; clock: string; status: 'scheduled' | 'in_progress' | 'final'; status_text: string }`
  - `espnScoreboardUrl(gameDate: string): string`
  - `parseEspnScoreboard(json: unknown, homeTricode: string, awayTricode: string): EspnScore | null`
  - `overlayEspn(p: LivePayload, s: EspnScore): LivePayload`

- [ ] **Step 1: Confirm ESPN's field names against a real response**

This endpoint is public and CORS-enabled, and it isn't blocked from Luke's network.

```bash
curl -s "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20260415" | python3 -c "import sys,json;e=[x for x in json.load(sys.stdin)['events'] if 'LAC' in x['shortName']][0];c=e['competitions'][0];print(json.dumps({'competitors':[{k:v for k,v in t.items() if k in ('homeAway','score')}|{'abbr':t['team']['abbreviation']} for t in c['competitors']],'status':{k:c['status'][k] for k in ('period','displayClock')}|{'type':{k:c['status']['type'][k] for k in ('state','shortDetail')}}},indent=1))"
```

Expected: `competitors[].homeAway` is `home`/`away`, and `score` is a string. The status fields are `period`, `displayClock`, and `type.state` (`pre`|`in`|`post`) with `type.shortDetail`. If any name differs, use the real names in the parser and the fixture below, and note the difference in the report.

- [ ] **Step 2: Write the failing tests**

Create `src/lib/live/espn-backup.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { espnScoreboardUrl, overlayEspn, parseEspnScoreboard } from './espn-backup';
import type { LivePayload } from '../ui/types';

const event = (home: string, away: string, hs: string, as: string, state: string, period = 3, clock = '4:32', detail = '4:32 - 3rd') => ({
  competitions: [{
    competitors: [
      { homeAway: 'home', score: hs, team: { abbreviation: home } },
      { homeAway: 'away', score: as, team: { abbreviation: away } },
    ],
    status: { period, displayClock: clock, type: { state, shortDetail: detail } },
  }],
});

describe('parseEspnScoreboard', () => {
  it('finds the game by NBA tricodes, mapping ESPN abbreviations', () => {
    const json = { events: [event('NY', 'BOS', '50', '48', 'in'), event('LAC', 'GS', '88', '85', 'in')] };
    expect(parseEspnScoreboard(json, 'LAC', 'GSW')).toEqual({
      home: 88, away: 85, period: 3, clock: '4:32', status: 'in_progress', status_text: '4:32 - 3rd',
    });
  });

  it('maps pre/post states and returns null when the game is missing or the payload is junk', () => {
    expect(parseEspnScoreboard({ events: [event('LAC', 'SAC', '110', '101', 'post', 4, '0.0', 'Final')] }, 'LAC', 'SAC')?.status).toBe('final');
    expect(parseEspnScoreboard({ events: [event('LAC', 'SAC', '0', '0', 'pre', 0, '0.0', '7:30 PM')] }, 'LAC', 'SAC')?.status).toBe('scheduled');
    expect(parseEspnScoreboard({ events: [] }, 'LAC', 'SAC')).toBeNull();
    expect(parseEspnScoreboard(null, 'LAC', 'SAC')).toBeNull();
  });
});

describe('espnScoreboardUrl', () => {
  it('asks for the game date explicitly (late games outlive ESPN’s default day)', () => {
    expect(espnScoreboardUrl('2026-10-21')).toBe('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261021');
  });
});

describe('overlayEspn', () => {
  it('overlays score and clock, and labels the payload as the backup feed', () => {
    const p = {
      meta: { generated_at: '', source: 'mixed', stale: true, stale_reason: 'poll daemon offline', ttl_seconds: 5 },
      state: 'DATA_DELAYED',
      game: {
        game_id: '9', nba_game_id: '22600093', season_id: 2026, game_date: '2026-10-21', start_time_utc: null,
        status: 'in_progress', period: 2, clock: '1:00', status_text: 'Q2', periods: [],
        home: { team_id: '13', abbreviation: 'LAC', name: 'Clippers', score: 50, is_home: true },
        away: { team_id: '24', abbreviation: 'SAC', name: 'Kings', score: 48, is_home: false },
      },
      key_metrics: [], box_score: null, insights: [], other_games: [], odds: null,
    } as LivePayload;
    const out = overlayEspn(p, { home: 88, away: 85, period: 3, clock: '4:32', status: 'in_progress', status_text: '4:32 - 3rd' });
    expect(out.state).toBe('DATA_DELAYED');
    expect(out.meta.stale_reason).toBe('backup feed (ESPN)');
    expect(out.game).toMatchObject({ period: 3, clock: '4:32', status_text: '4:32 - 3rd', home: { score: 88 }, away: { score: 85 } });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/lib/live/espn-backup.test.ts`
Expected: FAIL — cannot find module `./espn-backup`.

- [ ] **Step 4: Implement**

Create `src/lib/live/espn-backup.ts`:

```ts
// src/lib/live/espn-backup.ts
// Last-resort score for /live when our runner is stale (spec §6.2 tier 3):
// the browser reads ESPN's public, CORS-enabled scoreboard directly. Score,
// clock and period only — everything runner-derived stays as last seen.

import type { LivePayload } from '../ui/types';

export const ESPN_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
export const BACKUP_STALE_REASON = 'backup feed (ESPN)';

// ESPN abbreviations that differ from NBA tricodes.
const ESPN_TO_NBA: Record<string, string> = { GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS', PHO: 'PHX' };

export interface EspnScore {
  home: number;
  away: number;
  period: number;
  clock: string;
  status: 'scheduled' | 'in_progress' | 'final';
  status_text: string;
}

interface EspnCompetitor { homeAway?: string; score?: string; team?: { abbreviation?: string } }
interface EspnStatus { period?: number; displayClock?: string; type?: { state?: string; shortDetail?: string } }
interface EspnEvent { competitions?: Array<{ competitors?: EspnCompetitor[]; status?: EspnStatus }>; status?: EspnStatus }

const tricode = (abbr: string | undefined) => (abbr ? ESPN_TO_NBA[abbr] ?? abbr : '');

export function espnScoreboardUrl(gameDate: string): string {
  return `${ESPN_SCOREBOARD_URL}?dates=${gameDate.replaceAll('-', '')}`;
}

export function parseEspnScoreboard(json: unknown, homeTricode: string, awayTricode: string): EspnScore | null {
  const events = (json as { events?: EspnEvent[] } | null)?.events ?? [];
  for (const e of events) {
    const comp = e.competitions?.[0];
    const home = comp?.competitors?.find((c) => c.homeAway === 'home');
    const away = comp?.competitors?.find((c) => c.homeAway === 'away');
    if (!home || !away) continue;
    if (tricode(home.team?.abbreviation) !== homeTricode || tricode(away.team?.abbreviation) !== awayTricode) continue;
    const st = comp?.status ?? e.status ?? {};
    const state = st.type?.state;
    return {
      home: Number(home.score) || 0,
      away: Number(away.score) || 0,
      period: st.period ?? 0,
      clock: st.displayClock ?? '',
      status: state === 'post' ? 'final' : state === 'in' ? 'in_progress' : 'scheduled',
      status_text: st.type?.shortDetail ?? '',
    };
  }
  return null;
}

export function overlayEspn(p: LivePayload, s: EspnScore): LivePayload {
  if (!p.game) return p;
  return {
    ...p,
    state: 'DATA_DELAYED',
    meta: { ...p.meta, stale: true, stale_reason: BACKUP_STALE_REASON },
    game: {
      ...p.game,
      status: s.status,
      status_text: s.status_text,
      period: s.period,
      clock: s.clock,
      home: { ...p.game.home, score: s.home },
      away: { ...p.game.away, score: s.away },
    },
  };
}
```

- [ ] **Step 5: Verify and commit**

Run the Global Constraints verification.

```bash
git add src/lib/live/espn-backup.ts src/lib/live/espn-backup.test.ts
git commit -m "feat(live): ESPN scoreboard backup parser

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Stream client, source indicator, latency overlay

**Files:**
- Create: `src/lib/live/stream.ts`, `src/lib/live/stream.test.ts`, `hooks/useVisibleWithGrace.ts`, `hooks/useLiveStream.ts`, `components/live/FeedSource.tsx`, `components/live/LatencyOverlay.tsx`
- Modify: `components/live/LiveView.tsx`, `app/live/page.tsx`

**Interfaces:**
- Consumes: `applyMessage`, `LiveMessage` (Task 2); `overlayLiveDoc` (Task 1); `parseEspnScoreboard`, `espnScoreboardUrl`, `overlayEspn`, `BACKUP_STALE_REASON` (Task 6); `useLiveData({ follow })`, `useNow(ms): Date | null` (existing).
- Produces:
  - `type FeedSource = 'push' | 'poll' | 'backup' | 'idle'`
  - Constants: `RECONNECT_STEPS_MS`, `FLAP_WINDOW_MS`, `FLAP_LIMIT`, `FLAP_PAUSE_MS`, `PUSH_FRESH_MS`, `HIDDEN_CLOSE_MS`, `PING_EVERY_MS`, `BACKUP_POLL_MS`
  - `reconnectDelay(attempt)`, `isFlapping(drops, now)`, `hubSocketUrl(hub, nbaGameId)`, `streamGameId(base?)`, `pickSource(i)`, `needsBackup(base, pushFresh)`
  - `interface LatencySample`
  - `useLiveStream(): { data; error; source; latency }`

- [ ] **Step 1: Write the failing tests for the pure helpers**

Create `src/lib/live/stream.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hubSocketUrl, isFlapping, needsBackup, pickSource, reconnectDelay, streamGameId } from './stream';
import type { LivePayload } from '../ui/types';

const payload = (over: Partial<LivePayload>): LivePayload =>
  ({ meta: {}, state: 'LIVE', game: null, key_metrics: [], box_score: null, insights: [], other_games: [], odds: null, ...over } as LivePayload);
const game = (status: string) => ({ game_id: '9', nba_game_id: '22600093', status } as NonNullable<LivePayload['game']>);

describe('stream helpers', () => {
  it('backs off 1 → 2 → 4 → 8 → 16 → 30 s and stays at 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(reconnectDelay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it('flags 3 drops within 60 s as flapping', () => {
    expect(isFlapping([0, 10_000, 20_000], 30_000)).toBe(true);
    expect(isFlapping([0, 10_000, 20_000], 70_000)).toBe(false);
    expect(isFlapping([50_000, 55_000], 60_000)).toBe(false);
  });

  it('builds the socket URL with the canonical numeric game id', () => {
    expect(hubSocketUrl('wss://live.lukeghanna.com/', '0022600093')).toBe('wss://live.lukeghanna.com/ws/22600093');
  });

  it('streams the live game, or the upcoming one before tip', () => {
    expect(streamGameId(payload({ game: game('in_progress') }))).toBe('22600093');
    expect(streamGameId(payload({ state: 'NO_ACTIVE_GAME', upcoming: { nba_game_id: '0022600093' } }))).toBe('0022600093');
    expect(streamGameId(payload({ state: 'NO_ACTIVE_GAME' }))).toBeNull();
    expect(streamGameId(undefined)).toBeNull();
  });

  it('picks the source: backup, then fresh push, then poll; idle with no game', () => {
    const live = payload({ game: game('in_progress') });
    expect(pickSource({ base: live, lastPushAt: 100_000, now: 110_000, backup: true })).toBe('backup');
    expect(pickSource({ base: live, lastPushAt: 100_000, now: 110_000, backup: false })).toBe('push');
    expect(pickSource({ base: live, lastPushAt: 100_000, now: 140_000, backup: false })).toBe('poll');
    expect(pickSource({ base: payload({ state: 'NO_ACTIVE_GAME' }), lastPushAt: null, now: 0, backup: false })).toBe('idle');
  });

  it('wants the ESPN backup only when the feed is delayed, push is not fresh, and the game is live', () => {
    const delayed = payload({ state: 'DATA_DELAYED', game: game('in_progress') });
    expect(needsBackup(delayed, false)).toBe(true);
    expect(needsBackup(delayed, true)).toBe(false);
    expect(needsBackup(payload({ state: 'LIVE', game: game('in_progress') }), false)).toBe(false);
    expect(needsBackup(payload({ state: 'DATA_DELAYED', game: game('final') }), false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/live/stream.test.ts`
Expected: FAIL — cannot find module `./stream`.

- [ ] **Step 3: Implement the helpers**

Create `src/lib/live/stream.ts`:

```ts
// src/lib/live/stream.ts
// Pure pieces of the /live connection manager (spec §6.2): reconnect policy,
// which tier is serving the page, and when to fall back to ESPN.

import type { LivePayload } from '../ui/types';

export type FeedSource = 'push' | 'poll' | 'backup' | 'idle';

export const RECONNECT_STEPS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;
export const FLAP_WINDOW_MS = 60_000;
export const FLAP_LIMIT = 3;
export const FLAP_PAUSE_MS = 60_000;
/** The runner saves at least every 15 s, so 30 s without a message means push is stale. */
export const PUSH_FRESH_MS = 30_000;
export const HIDDEN_CLOSE_MS = 30_000;
export const PING_EVERY_MS = 25_000;
export const BACKUP_POLL_MS = 5_000;

export function reconnectDelay(attempt: number): number {
  return RECONNECT_STEPS_MS[Math.min(Math.max(attempt, 0), RECONNECT_STEPS_MS.length - 1)];
}

export function isFlapping(drops: number[], now: number): boolean {
  return drops.filter((t) => now - t < FLAP_WINDOW_MS).length >= FLAP_LIMIT;
}

export function hubSocketUrl(hub: string, nbaGameId: string): string {
  return `${hub.replace(/\/+$/, '')}/ws/${Number(nbaGameId)}`;
}

export function streamGameId(base?: LivePayload): string | null {
  return base?.game?.nba_game_id ?? base?.upcoming?.nba_game_id ?? null;
}

export function pickSource(i: { base?: LivePayload; lastPushAt: number | null; now: number; backup: boolean }): FeedSource {
  if (i.backup) return 'backup';
  if (i.lastPushAt !== null && i.now - i.lastPushAt < PUSH_FRESH_MS) return 'push';
  if (!i.base || i.base.state === 'NO_ACTIVE_GAME') return 'idle';
  return 'poll';
}

export function needsBackup(base: LivePayload | undefined, pushFresh: boolean): boolean {
  return base?.state === 'DATA_DELAYED' && !pushFresh && base.game?.status === 'in_progress';
}
```

- [ ] **Step 4: The hooks**

Create `hooks/useVisibleWithGrace.ts`:

```ts
'use client'

import * as React from 'react'

/** False once the tab has been hidden for `graceMs`; true again as soon as it's visible. */
export function useVisibleWithGrace(graceMs: number): boolean {
  const [visible, setVisible] = React.useState(true)
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onChange = () => {
      clearTimeout(timer)
      if (document.visibilityState === 'visible') setVisible(true)
      else timer = setTimeout(() => setVisible(false), graceMs)
    }
    document.addEventListener('visibilitychange', onChange)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onChange)
    }
  }, [graceMs])
  return visible
}
```

Create `hooks/useLiveStream.ts`:

```ts
'use client'

import * as React from 'react'
import { useLiveData } from '@/hooks/useLiveData'
import { useNow } from '@/hooks/useNow'
import { useVisibleWithGrace } from '@/hooks/useVisibleWithGrace'
import { applyMessage, type LiveMessage } from '@/src/lib/live/protocol'
import { overlayLiveDoc } from '@/src/lib/live/payload'
import { espnScoreboardUrl, overlayEspn, parseEspnScoreboard, type EspnScore } from '@/src/lib/live/espn-backup'
import {
  BACKUP_POLL_MS,
  FLAP_PAUSE_MS,
  HIDDEN_CLOSE_MS,
  PING_EVERY_MS,
  PUSH_FRESH_MS,
  hubSocketUrl,
  isFlapping,
  needsBackup,
  pickSource,
  reconnectDelay,
  streamGameId,
  type FeedSource,
} from '@/src/lib/live/stream'
import type { LiveStateDoc } from '@/src/lib/types/live-state'
import type { LivePayload } from '@/src/lib/ui/types'

const HUB_URL = process.env.NEXT_PUBLIC_LIVE_HUB_URL ?? ''

export interface LatencySample {
  observed_at: string | null  // the real play (NBA wall clock)
  fetched_at: string          // the runner saw it
  hub_at: number | null       // the hub relayed it
  received_at: number         // this browser got it (local clock)
}

export interface LiveStream {
  data: LivePayload | undefined
  error: unknown
  source: FeedSource
  latency: LatencySample | null
}

/**
 * /live's connection manager (spec §6.2): WebSocket push from the live hub,
 * /api/live polling underneath (slowed to the 30 s chip budget while push is
 * fresh), and ESPN's public scoreboard if our runner goes stale.
 */
export function useLiveStream(): LiveStream {
  const now = useNow(5_000)?.getTime() ?? null
  const [pushed, setPushed] = React.useState<{ gameId: string; doc: LiveStateDoc; at: number } | null>(null)
  const [latency, setLatency] = React.useState<LatencySample | null>(null)
  const [espn, setEspn] = React.useState<{ gameId: string; score: EspnScore } | null>(null)

  const lastPushAt = pushed?.at ?? null
  const pushFresh = lastPushAt !== null && now !== null && now - lastPushAt < PUSH_FRESH_MS
  const { data: base, error, mutate } = useLiveData({ follow: pushFresh ? 'chip' : 'cadence' })
  const gameId = streamGameId(base)
  const visible = useVisibleWithGrace(HIDDEN_CLOSE_MS)
  const pushDoc = pushed && pushed.gameId === gameId ? pushed.doc : null

  // Tier 1: push.
  React.useEffect(() => {
    if (!HUB_URL || !gameId || !visible) return
    let ws: WebSocket | null = null
    let state: LiveStateDoc | null = null
    let attempt = 0
    let stopped = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const drops: number[] = []

    const connect = () => {
      ws = new WebSocket(hubSocketUrl(HUB_URL, gameId))
      ws.onopen = () => {
        attempt = 0
      }
      ws.onmessage = (event) => {
        if (typeof event.data !== 'string' || event.data === 'pong') return
        let msg: LiveMessage
        try {
          msg = JSON.parse(event.data) as LiveMessage
        } catch {
          return
        }
        const result = applyMessage(state, msg)
        if (result.needKeyframe) ws?.send('resync')
        if (!result.applied || !result.state) return
        state = result.state
        const receivedAt = Date.now()
        setPushed({ gameId, doc: result.state, at: receivedAt })
        setLatency({
          observed_at: result.state.observed_at,
          fetched_at: result.state.fetched_at,
          hub_at: msg.hub_at ?? null,
          received_at: receivedAt,
        })
      }
      ws.onclose = () => {
        if (stopped) return
        drops.push(Date.now())
        retry = setTimeout(connect, isFlapping(drops, Date.now()) ? FLAP_PAUSE_MS : reconnectDelay(attempt++))
      }
    }

    connect()
    const ping = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) ws.send('ping')
    }, PING_EVERY_MS)
    return () => {
      stopped = true
      clearTimeout(retry)
      clearInterval(ping)
      ws?.close()
    }
  }, [gameId, visible])

  // Pre-tip → tip: the hub knows the game started before /api/live's slow
  // pre-tip poll does; refetch so the page has the game's identity to overlay.
  const pushedStatus = pushDoc?.status
  const hasGame = Boolean(base?.game)
  React.useEffect(() => {
    if (pushedStatus && pushedStatus !== 'scheduled' && !hasGame) void mutate()
  }, [pushedStatus, hasGame, mutate])

  // Tier 3: ESPN backup while our runner is stale.
  const backupWanted = needsBackup(base, pushFresh)
  const backupGame = backupWanted ? base?.game ?? null : null
  React.useEffect(() => {
    const g = backupGame
    if (!g?.game_date || !g.home.abbreviation || !g.away.abbreviation) return
    const { game_id, game_date } = g
    const home = g.home.abbreviation
    const away = g.away.abbreviation
    let stopped = false
    const tick = async () => {
      try {
        const res = await fetch(espnScoreboardUrl(game_date), { signal: AbortSignal.timeout(4_000) })
        if (!res.ok) return
        const score = parseEspnScoreboard(await res.json(), home, away)
        if (score && !stopped) setEspn({ gameId: game_id, score })
      } catch {
        // Best effort: the delayed banner is already showing.
      }
    }
    void tick()
    const id = setInterval(tick, BACKUP_POLL_MS)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [backupGame])

  const backupScore = backupWanted && espn && espn.gameId === base?.game?.game_id ? espn.score : null
  let data = base
  if (data && pushDoc && pushFresh) data = overlayLiveDoc(data, pushDoc)
  if (data && backupScore) data = overlayEspn(data, backupScore)

  return {
    data,
    error,
    source: pickSource({ base, lastPushAt, now: now ?? 0, backup: Boolean(backupScore) }),
    latency,
  }
}
```

Two notes:
- `backupGame` is a new object on every SWR refresh while DATA_DELAYED (15 s), which restarts the ESPN interval then. That's intended and harmless. If the lint rules object to the dependency, depend on `backupGame?.game_id` and the three strings instead.
- `useNow` returns `Date | null` (null before mount).

- [ ] **Step 5: Source indicator, backup banner, latency overlay**

Create `components/live/FeedSource.tsx`:

```tsx
import { cn } from '@/lib/utils'
import type { FeedSource as Source } from '@/src/lib/live/stream'

const LABEL: Record<Exclude<Source, 'idle'>, string> = {
  push: 'Live',
  poll: 'Live · polling',
  backup: 'Backup feed · ESPN',
}

/** Which tier is feeding /live right now (spec §6.2). */
export function FeedSource({ source }: { source: Source }) {
  if (source === 'idle') return null
  return (
    <span
      role="status"
      className={cn('inline-flex items-center gap-1.5 font-mono text-[11.5px]', source === 'backup' ? 'text-warn' : 'text-mute')}
    >
      <span
        aria-hidden
        className={cn('h-1.5 w-1.5 rounded-full', source === 'push' ? 'bg-live' : source === 'backup' ? 'bg-warn' : 'bg-mute')}
      />
      {LABEL[source]}
    </span>
  )
}
```

Check that `cn` lives at `@/lib/utils`. `LiveView` imports it from somewhere; use the same path. `bg-live`, `bg-warn` and `text-warn` are existing tokens; use `bg-mute` only if it exists, otherwise pick the existing muted background token.

In `components/live/LiveView.tsx`:
1. Import `FeedSource` and its type (`import type { FeedSource as FeedSourceKind } from '@/src/lib/live/stream'`). Add an optional prop `source?: FeedSourceKind` to `LiveView({ data, error, source })`.
2. Under the Scoreboard (inside the same `<section>`, before the delayed paragraph), render `{source && <div className="mt-3 flex justify-end"><FeedSource source={source} /></div>}`.
3. Import `BACKUP_STALE_REASON` from `@/src/lib/live/espn-backup`. When `data.meta.stale_reason === BACKUP_STALE_REASON`, the delayed paragraph reads `Our live feed is delayed. Score and clock are from ESPN's backup feed.` instead of the "last update … ago" text.

The `/dev/live` fixture page passes no `source`, so nothing changes there.

Create `components/live/LatencyOverlay.tsx`:

```tsx
'use client'

import * as React from 'react'
import type { LatencySample } from '@/hooks/useLiveStream'

const subscribe = () => () => {}
const enabled = () => new URLSearchParams(window.location.search).get('debug') === 'latency'

const secs = (ms: number | null) => (ms === null || !Number.isFinite(ms) ? '—' : `${(ms / 1000).toFixed(1)} s`)

/** `/live?debug=latency`: where the time goes between the real play and this screen. */
export function LatencyOverlay({ sample }: { sample: LatencySample | null }) {
  const on = React.useSyncExternalStore(subscribe, enabled, () => false)
  if (!on || !sample) return null
  const observed = sample.observed_at ? Date.parse(sample.observed_at) : null
  const fetched = Date.parse(sample.fetched_at)
  const rows: Array<[string, number | null]> = [
    ['Play → runner', observed === null ? null : fetched - observed],
    ['Runner → hub', sample.hub_at === null ? null : sample.hub_at - fetched],
    ['Hub → you*', sample.hub_at === null ? null : sample.received_at - sample.hub_at],
  ]
  return (
    <div className="fixed bottom-3 right-3 z-50 rounded-xl border border-line bg-bg/90 px-3 py-2 font-mono text-[11.5px] text-mute backdrop-blur">
      {rows.map(([label, ms]) => (
        <div key={label} className="flex justify-between gap-4">
          <span>{label}</span>
          <span className="text-text">{secs(ms)}</span>
        </div>
      ))}
      <div className="mt-1 text-[10.5px]">* includes clock skew between the hub and this device</div>
    </div>
  )
}
```

If a class token here (`bg-bg`, `text-text`, `border-line`) doesn't exist, swap in the equivalent that `Panel` uses.

Replace `app/live/page.tsx`:

```tsx
'use client'

import { useLiveStream } from '@/hooks/useLiveStream'
import { LiveView } from '@/components/live/LiveView'
import { LatencyOverlay } from '@/components/live/LatencyOverlay'

export default function LivePage() {
  const { data, error, source, latency } = useLiveStream()
  return (
    <>
      <LiveView data={data} error={error} source={source} />
      <LatencyOverlay sample={latency} />
    </>
  )
}
```

- [ ] **Step 6: Verify**

- Run `npx vitest run src/lib/live/stream.test.ts` (PASS), then the Global Constraints verification, including `npm run build`.
- Then `npm run dev` and open `http://localhost:3000/dev/live`. It should render as before, with no source chip.
- `http://localhost:3000/live` should render (idle in preseason) with no console errors. `NEXT_PUBLIC_LIVE_HUB_URL` is unset locally, so there's no push.

- [ ] **Step 7: Commit**

```bash
git add src/lib/live/stream.ts src/lib/live/stream.test.ts hooks/useVisibleWithGrace.ts hooks/useLiveStream.ts components/live/FeedSource.tsx components/live/LatencyOverlay.tsx components/live/LiveView.tsx app/live/page.tsx
git commit -m "feat(live): /live streams from the push hub with poll and ESPN fallbacks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Rollout (operational — needs Luke at each step)

- [ ] **Step 1: First hub deploy** (Luke is logged in to Cloudflare in the browser)

```bash
cd "/Users/luke/Claude Projects/CCC-live-v2/workers/live-hub"
npx wrangler login
npx wrangler deploy
openssl rand -hex 32   # copy the value
npx wrangler secret put LIVE_HUB_SECRET
curl https://live.lukeghanna.com/health
```

Expected: `ok`.

- [ ] **Step 2: NBA reachability from Cloudflare** (spec §10 phase 0, second half)

```bash
curl -s -H "Authorization: Bearer <secret>" https://live.lukeghanna.com/probe/nba
```

Record `{status, bytes, ms}` in the spec as §10.1. A `200` means a future plan could move polling into the Durable Object and off GitHub Actions. A `403` means GitHub Actions stays the poller.

- [ ] **Step 3: Socket smoke test**

Run the README's publish `curl` and the browser-console socket check from https://clippers.lukeghanna.com. Expected: the console logs the keyframe, with `hub_at`.

- [ ] **Step 4: Wire the secrets**

- **GitHub:**
  - Repo variable `LIVE_HUB_URL=https://live.lukeghanna.com`.
  - Secrets: `LIVE_HUB_SECRET` (same value), `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit; Zone DNS: Edit on lukeghanna.com) and `CLOUDFLARE_ACCOUNT_ID`.
- **Vercel:**
  - `NEXT_PUBLIC_LIVE_HUB_URL=wss://live.lukeghanna.com` — **Production only** (not Preview or Development). The hub's `ALLOWED_ORIGINS` admits only `https://clippers.lukeghanna.com` (plus `http://localhost:3000` for local testing via `.env.local`), so preview deployments leave it unset and poll `/api/live`.
  - `LIVE_HUB_URL` and `LIVE_HUB_SECRET` (Production + Preview), so manual cron-route ticks publish too. `LIVE_HUB_SECRET` is the same value as the Worker's and the GitHub secret (see `workers/live-hub/README.md`).

- [ ] **Step 5: Merge and verify**

1. Merge with a PR to `main`. Auto-deploy covers both the app and the hub workflow.
2. During any live NBA game, run the dry run from a GitHub runner or Luke's machine with the hub env set:

   ```bash
   npx tsx scripts/dev/live-dry-run.ts --publish --minutes=10
   ```

   Then open a socket to that game's id from the browser console and watch keyframes and deltas arrive.
3. After the first Clippers game (Oct 21), check three things:
   - Cloudflare: requests and DO usage are far below the free limits.
   - Vercel: `/api/live` edge requests drop compared with Plan 1 while push is fresh.
   - `/live?debug=latency` numbers.

---

## Plan series

1. **Feed probe + adaptive runner** — merged and deployed.
2. **Push hub + stream client** — this plan.
3. **Features:**
   - Game flow chart + `stern-v1` win probability, reusing insights' `deriveGameFlow` for the margin series so live and stored flow agree (coordinated with the insights session).
   - Rotation clipboard.
   - Spoiler sync, using the hub's 150 s replay and `observed_at`.
