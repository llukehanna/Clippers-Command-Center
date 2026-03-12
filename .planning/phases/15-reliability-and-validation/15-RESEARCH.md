# Phase 15: Reliability and Validation - Research

**Researched:** 2026-03-11
**Domain:** Vitest integration testing, API route testing, polling daemon reliability, UI fallback behavior
**Confidence:** HIGH

## Summary

Phase 15 is a pure validation phase — no new features. It fills in the `.todo` scaffolding in `src/lib/api-live.test.ts`, adds polling daemon tests, validates timing SLAs via wall-clock assertions, and confirms the DATA_DELAYED UI banner is correctly positioned and wired.

The codebase is already well-structured for this work. `buildMeta()`, `buildError()`, `calculateBackoff()`, `isClippersGame()`, and `findClippersGame()` are all pure functions with zero external dependencies — they test trivially. The `/api/live` route handler is the primary integration target and requires DB mocking via `vi.mock()`.

A key structural finding: **two copies of the `/api/live` route exist** — `app/api/live/route.ts` (active, uses `@/src/lib/*` alias) and `src/app/api/live/route.ts` (stale copy, uses relative imports). Tests must target `app/api/live/route.ts`. The `src/app/api/live/route.ts` file should be deleted or ignored.

**Primary recommendation:** Write tests that mock the `sql` tagged template tag from `src/lib/db.ts` using `vi.mock()`, call the `GET` handler directly, and assert on the JSON response shape plus wall-clock timing. No network or Neon access required.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Vitest unit + integration tests** — no browser testing (Playwright/Cypress out of scope)
- Vitest is already configured; `src/lib/api-live.test.ts` has `.todo` scaffolding — fill these in
- DB mocked via `vi.mock()` stubbing the `sql` template tag — tests run offline, fast, deterministic. No Neon dependency in CI.
- Polling daemon behavior tested via mocking `fetchScoreboard()` / `fetchBoxscore()` at the HTTP client level
- **`/api/live`** — primary target: NO_ACTIVE_GAME, DATA_DELAYED, LIVE states + staleness detection + timing SLA
- **Polling daemon** (`scripts/poll-live.ts` / `poll-live-logic.ts`) — backoff math, failure counter increments, success resets counter
- `/api/home` and `/api/history/*` — NOT in scope for this phase (low reliability risk; 300/400ms SLA validated via spot-check if needed)
- **Timing assertions in Vitest integration tests** — wrap route handler calls in `Date.now()` before/after, assert elapsed < threshold
- **What "response time" means**: route handler wall time (start of handler → Response built). Excludes network and Next.js routing overhead.
- Thresholds: `/api/live` < 200ms, `/api/home` < 300ms, `/api/history/*` < 400ms
- **"Upstream outage" = polling daemon can't reach NBA CDN** — mock `fetchScoreboard()` to throw network errors
- A snapshot is flagged stale when it is **3+ minutes old** — trust `is_stale` flag first; fall back to age check if absent
- Return `state: 'DATA_DELAYED'`, `meta.stale: true`, `meta.stale_reason: 'poll daemon offline'` — last known snapshot data still included
- **Last data + stale banner** — keep the last known scoreboard/box score visible during DATA_DELAYED
- **Banner placement:** Small muted banner below the scoreboard hero, above the box score
- **Banner text:** "Live data delayed — last updated X minutes ago." (relative time from `meta.generated_at` vs `captured_at`)
- Do NOT show skeleton/loading state or error page — the last real data is more valuable than a blank screen

### Claude's Discretion
- Exact banner styling (muted yellow vs amber vs `text-muted-foreground` — keep it understated)
- Whether timing assertion tests use `expect(elapsed).toBeLessThan(threshold)` or a custom matcher
- Test file organization (co-locate with routes vs separate `__tests__/` folder)
- Whether `api-home.test.ts` and `api-history.test.ts` are created as stubs or skipped entirely

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PERF-01 | /api/live response time < 200ms | Wall-clock assertion in Vitest wrapping the GET handler; mocked DB ensures pure processing time is measured |
| PERF-02 | /api/home response time < 300ms | Same pattern; context.md narrows this to spot-check only — no dedicated test file required |
| PERF-03 | /api/history/* response time < 400ms | Same pattern; spot-check only per context.md |
| RELY-01 | System continues serving cached data during upstream API outages | Mock `fetchScoreboard()` to throw; verify daemon backs off and /api/live returns DATA_DELAYED with last snapshot |
| RELY-02 | Exponential backoff on live polling failures | `calculateBackoff()` pure unit tests + pollLoop integration: failureCount increments, success resets to 0 |
| RELY-03 | UI remains functional and meaningful during all upstream outage scenarios | DATA_DELAYED state: StaleBanner visible, scoreboard + box score still rendered from last snapshot data |
</phase_requirements>

---

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^4.0.18 | Unit + integration test runner | Already configured; `vi.mock()` built in; fast ESM-native |
| TypeScript | ^5.9.3 | Type safety | Project-wide; tests get full type checking |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vi.mock() | built into vitest | Stub module dependencies (sql tag, HTTP clients) | All integration tests targeting route handlers |
| vi.fn() / vi.spyOn() | built into vitest | Verify call counts, arguments | Polling daemon call assertions |
| expect().toBeLessThan() | built into vitest | Wall-clock timing SLA assertions | PERF-01/02/03 tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| vi.mock() for DB | Real Neon DB | Context.md explicitly rejected — adds latency, network dep, non-determinism |
| Playwright | — | Context.md out of scope — too heavy for this phase |

**Installation:** None needed. Vitest already in devDependencies.

---

## Architecture Patterns

### Active Route Location (CRITICAL)
The project has two copies of `/api/live/route.ts`:

```
app/api/live/route.ts          ← ACTIVE (Next.js root app dir, uses @/ alias)
src/app/api/live/route.ts      ← STALE COPY (relative imports, was used during dev)
```

`next.config.ts` has no `appDir` or `dir` override — Next.js 16 defaults to scanning `app/` at the project root. The `app/` directory is authoritative. Integration tests should import from `app/api/live/route.ts`.

The stale `src/app/api/live/route.ts` differs only in import paths (relative vs alias). It should be deleted as part of this phase to prevent confusion.

### Vitest Configuration
```typescript
// vitest.config.ts (current)
export default defineConfig({
  test: {
    include: [
      'scripts/lib/**/*.test.ts',
      'src/lib/**/*.test.ts',
    ],
  },
});
```

**Gap:** The include pattern covers `src/lib/**` and `scripts/lib/**` — it does NOT cover `app/api/**/*.test.ts`. If integration tests are placed alongside the route handlers (e.g., `app/api/live/route.test.ts`), the vitest config must be updated to include `app/**/*.test.ts`. Alternatively, keep tests in `src/lib/` (matching the established `src/lib/api-live.test.ts` pattern).

**Recommendation:** Keep integration tests for `/api/live` in `src/lib/api-live.test.ts` (already exists, already in include glob) rather than co-locating with the route. This avoids touching the vitest config.

### Pattern 1: Mocking the `sql` tag for Route Handler Tests

The route handler imports `sql` from `src/lib/db.ts`. To mock it:

```typescript
// src/lib/api-live.test.ts
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock BEFORE any other imports that reference the module
vi.mock('@/src/lib/db', () => ({
  sql: makeSqlMock([/* rows */]),
  LAC_NBA_TEAM_ID: 1610612746,
}));

// Then import the route handler
import { GET } from '../../app/api/live/route';
```

The `sql` tagged template literal is tricky to mock because it's called as `sql<Type[]>\`...\``. The mock needs to return a thenable (Promise-like) that resolves to the desired row array.

```typescript
// Helper to produce a sql mock that returns rows in sequence
function makeSqlMock(sequences: unknown[][]) {
  let callIndex = 0;
  const mock = vi.fn().mockImplementation(() => {
    const rows = sequences[callIndex] ?? [];
    callIndex++;
    return Promise.resolve(rows);
  });
  // sql is also used as sql.json() in poll-live.ts — add json stub
  mock.json = vi.fn((v: unknown) => v);
  return mock;
}
```

**Important:** The route handler calls `sql` multiple times in sequence (snapshot query, then game details, then LAC team row). The mock must return different values per call — use `mockImplementationOnce()` chaining or a call-counter approach.

### Pattern 2: Wall-Clock Timing Assertion

```typescript
it('/api/live responds in under 200ms', async () => {
  const start = Date.now();
  const response = await GET();
  const elapsed = Date.now() - start;

  expect(response.status).toBe(200);
  expect(elapsed).toBeLessThan(200);
});
```

Note: With mocked DB (no I/O), these tests will complete in < 5ms. The assertion still validates that no accidental synchronous blocking or CPU-heavy computation was introduced.

### Pattern 3: Polling Daemon Failure Counter Tests

The `pollLoop` in `scripts/poll-live.ts` is a monolithic async loop — it cannot be easily unit-tested in isolation. The recommended approach (per context.md) is to test behavior at two levels:

1. **Pure function tests** (already exist in `scripts/lib/poll-live-logic.test.ts`): `calculateBackoff`, `isClippersGame`, `findClippersGame` — all green.

2. **Mock-at-HTTP-level integration tests**: Mock `fetchScoreboard` to throw. Verify that `calculateBackoff` is called with the incremented `failureCount`. The `pollLoop` itself is hard to test without extracting its state — the planner should consider extracting failure-counter logic into a testable unit OR accepting that backoff is validated via the pure `calculateBackoff` tests + a smoke test that confirms the counter increments.

**Practical approach for the planner:** Write a new test in `scripts/lib/poll-live-logic.test.ts` that validates `calculateBackoff` covers all specified cases (failureCount=0, 3, 10). These already exist. The "failure counter increments" and "success resets counter" behaviors in `pollLoop` require mocking `fetchScoreboard` and observing the `failureCount` variable — which is local to `pollLoop`. The cleanest path: extract a small `PollState` class or stateful object, or test indirectly by mocking `calculateBackoff` and asserting it's called with increasing counts.

### Pattern 4: DATA_DELAYED API Contract Test

```typescript
it('returns DATA_DELAYED when snapshot is_stale=true', async () => {
  // Mock sql to return a snapshot with is_stale=true in payload
  const staleSnapshot = {
    snapshot_id: 1,
    game_id: '999',
    period: 3,
    clock: '5:00',
    home_score: 88,
    away_score: 82,
    home_team_id: '13',
    away_team_id: '5',
    captured_at: new Date().toISOString(),
    payload: {
      is_stale: true,
      stale_reason: 'poll daemon offline',
      home_box: null,
      away_box: null,
      recent_scoring: [],
    },
  };
  // configure sql mock to return [staleSnapshot] on first call

  const response = await GET();
  const body = await response.json();

  expect(body.state).toBe('DATA_DELAYED');
  expect(body.meta.stale).toBe(true);
  expect(body.meta.stale_reason).toBe('poll daemon offline');
  expect(body.game).not.toBeNull(); // last snapshot data still included
});
```

**Staleness threshold clarification:** The existing route handler in `app/api/live/route.ts` flags stale when `snapshotAgeMs > 60_000` (60s), not 3 minutes. The CONTEXT.md says 3+ minutes = clearly an outage. These are not in conflict — 60s is the poll daemon's dead-man timeout (5 missed polls at 12s), while 3 minutes is the human-facing threshold for "clearly an outage." Tests should use the 60s threshold in mock `captured_at` values to trigger the code path.

### Pattern 5: StaleBanner UI Contract

`StaleBanner` already exists at `components/stale-banner/StaleBanner.tsx` and is already integrated into `app/live/page.tsx`. The component:
- Returns `null` when `stale=false` — correct behavior
- Renders amber-950/40 background with amber-400 text when `stale=true`
- Shows relative time ("X min ago") from `generatedAt` prop

**Current banner placement issue:** Looking at `app/live/page.tsx`, `StaleBanner` is rendered between the scoreboard and the `KeyMetricsRow`. The context.md spec says "below scoreboard hero, above box score" — the current placement is correct. However, the banner uses `meta.generated_at` for the relative time, but the spec says relative time should be from `captured_at` (when the snapshot was taken), not `generated_at` (when the response was built). These are nearly identical under normal conditions but differ during outages.

**Action required for the planner:** Verify whether the banner should show `captured_at` or `generated_at`. Currently uses `generated_at`. The context spec says "last updated X minutes ago" which implies `captured_at` of the snapshot. This is a bug to fix in the banner or in how the API surfaces `captured_at`.

### Anti-Patterns to Avoid

- **Testing the stale copy** (`src/app/api/live/route.ts`): Import from `app/api/live/route.ts` only.
- **Calling real DB from tests**: All `sql` calls must be mocked. The CI environment has no Neon access.
- **Testing Next.js routing layer**: Call `GET()` directly, don't use `fetch('/api/live')`.
- **Asserting exact timing values**: Only assert `< threshold`, never `=== someMs`.
- **Using `Date.now()` in mocks**: Let real time pass for timing tests — don't mock the clock.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Module mocking | Custom require hooks | `vi.mock()` | Vitest's module mock system handles ESM, hoisting, and cleanup automatically |
| Test fixtures | Separate fixture files | Inline factory functions (like existing `makeGame()`) | Phase is small enough; factories are already the pattern |
| Timing measurement | Custom profilers | `Date.now()` before/after | Sufficient precision for 200ms SLAs |

---

## Common Pitfalls

### Pitfall 1: vi.mock() Hoisting
**What goes wrong:** `vi.mock()` calls are hoisted to the top of the test file by Vitest's transform. If you reference a variable defined in the test file inside `vi.mock()`, you get `ReferenceError: Cannot access before initialization`.
**Why it happens:** ESM hoisting semantics — the mock factory runs before module-level `const` declarations.
**How to avoid:** Only reference literals, `vi.fn()`, or imports from other mocked modules inside the `vi.mock()` factory. Define row fixtures inside the factory or use `vi.mocked()` + `mockReturnValue` in `beforeEach`.
**Warning signs:** `ReferenceError` at test startup, not inside a test body.

### Pitfall 2: sql Tagged Template Return Shape
**What goes wrong:** The `sql` tag returns a `Promise<Row[]>` directly (the `postgres` library). The mock returns a `Promise<unknown[][]>` (array of arrays).
**Why it happens:** Developers mock `sql` as a function returning a 2D array, but the route handler destructures `const [snap] = await sql<SnapRow[]>\`...\`` expecting a flat Row array.
**How to avoid:** Mock `sql` to return `Promise.resolve([rowObject])` — a single-dimensional array of row objects. `[snap]` destructuring then works as expected.

### Pitfall 3: Multiple sql Calls in One Handler
**What goes wrong:** The `/api/live` route handler calls `sql` three times in the LIVE path (snapshot query, game details, LAC team row). A mock returning a fixed value for all calls will break on the second or third call.
**Why it happens:** Developers set `vi.fn().mockResolvedValue(rows)` once, not realizing the handler calls sql multiple times with different expected shapes.
**How to avoid:** Use `mockResolvedValueOnce` chained three times, or a call-counter mock implementation.

### Pitfall 4: Stale Module State Between Tests
**What goes wrong:** If `vi.mock()` is not reset between tests, mock call counts accumulate and `mockResolvedValueOnce` chains are exhausted.
**Why it happens:** Vitest reuses module instances within a test file unless `vi.resetModules()` is called.
**How to avoid:** Use `beforeEach(() => vi.clearAllMocks())` at the describe block level.

### Pitfall 5: Testing the Wrong Route File
**What goes wrong:** Tests import from `src/app/api/live/route.ts` instead of `app/api/live/route.ts`. The stale copy has different SQL queries (no JOIN with `games` table, queries `live_snapshots` directly with `home_team_id`/`away_team_id` filters) so mock shapes differ.
**Why it happens:** Both files exist; `src/app/api/live/route.ts` has a header comment saying "src/app/api/live/route.ts" which is the same as the comment in the active file.
**How to avoid:** Import explicitly from `../../app/api/live/route` (relative from `src/lib/`), not `../app/api/live/route`.

### Pitfall 6: StaleBanner Time Reference
**What goes wrong:** The StaleBanner shows time relative to `meta.generated_at` but the user expects "last updated" to mean when the last real data was captured — `captured_at` from the snapshot.
**Why it happens:** `generated_at` is set in `buildMeta()` at response construction time; during DATA_DELAYED, this is near-identical to `now()`, not to when the snapshot was taken.
**How to avoid:** Either surface `snapshot.captured_at` in the API response (e.g., in the `game` object's existing shape), or pass it explicitly in the DATA_DELAYED response envelope for the banner to consume.

---

## Code Examples

### Vitest sql Mock Pattern (Verified from codebase)
```typescript
// Source: existing poll-live-logic.test.ts pattern + Vitest docs
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/src/lib/db', () => {
  const sqlMock = vi.fn();
  sqlMock.json = vi.fn((v: unknown) => v);
  return { sql: sqlMock, LAC_NBA_TEAM_ID: 1610612746 };
});

import { GET } from '../../app/api/live/route';
import { sql } from '@/src/lib/db';

const mockedSql = vi.mocked(sql);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/live', () => {
  it('returns NO_ACTIVE_GAME when live_snapshots is empty', async () => {
    mockedSql.mockResolvedValueOnce([]); // snapshot query returns empty

    const response = await GET();
    const body = await response.json();

    expect(body.state).toBe('NO_ACTIVE_GAME');
    expect(body.game).toBeNull();
    expect(body.meta).toHaveProperty('generated_at');
    expect(body.meta.stale).toBe(false);
    expect(body.meta.ttl_seconds).toBe(60);
  });
});
```

### Timing Assertion (Wall-Clock)
```typescript
// Source: context.md methodology
it('responds in under 200ms', async () => {
  mockedSql.mockResolvedValueOnce([]); // empty snapshot = fast path

  const start = Date.now();
  await GET();
  const elapsed = Date.now() - start;

  expect(elapsed).toBeLessThan(200);
});
```

### calculateBackoff — Existing Tests (Already Green)
```typescript
// Source: scripts/lib/poll-live-logic.test.ts (lines 52-72)
describe('calculateBackoff', () => {
  it('returns baseMs unchanged when failureCount is 0', () => {
    expect(calculateBackoff(0, 12_000)).toBe(12_000);
  });
  it('caps at 60 seconds on third failure', () => {
    expect(calculateBackoff(3, 12_000)).toBe(60_000);
  });
  it('remains capped at 60 seconds for high failure counts', () => {
    expect(calculateBackoff(10, 12_000)).toBe(60_000);
  });
});
```

### DATA_DELAYED Snapshot Mock Shape
```typescript
// Derived from app/api/live/route.ts SnapRow interface + SnapshotPayload interface
const staleSnapRow = {
  snapshot_id: 1,
  game_id: '9999',
  period: 3,
  clock: '5:00',
  home_score: 88,
  away_score: 82,
  home_team_id: '13',    // LAC's internal team_id
  away_team_id: '5',
  captured_at: new Date(Date.now() - 90_000).toISOString(), // 90s old → triggers 60s stale check
  payload: {
    is_stale: true,
    stale_reason: 'poll daemon offline',
    home_box: null,
    away_box: null,
    recent_scoring: [],
  },
};
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate test runner (Jest) | Vitest | Phase 9 setup | ESM-native, faster HMR, same `vi.mock()` API |
| Browser-based E2E for SLA | Vitest wall-clock timing | Phase 15 decision | Simpler, no Playwright overhead, adequate for handler-level SLA |

**Deprecated/outdated:**
- `src/app/api/live/route.ts`: Superseded by `app/api/live/route.ts`. Should be deleted to eliminate confusion.

---

## Open Questions

1. **Which route file is authoritative for tests?**
   - What we know: `app/api/live/route.ts` uses `@/src/lib/*` imports (correct alias). `src/app/api/live/route.ts` uses relative imports. Next.js serves from `app/`.
   - What's unclear: Whether `src/app/` is intentionally kept as a backup or is a leftover.
   - Recommendation: Treat `app/api/live/route.ts` as the target. Delete `src/app/api/live/route.ts` in Wave 1.

2. **StaleBanner `captured_at` vs `generated_at` discrepancy**
   - What we know: Current banner uses `meta.generated_at` for relative time. During outage, `generated_at` is "now" (not when data was last captured).
   - What's unclear: Whether this is intentional or a bug. The context.md says "last updated X minutes ago" implying `captured_at`.
   - Recommendation: Surface `snapshot.captured_at` in the DATA_DELAYED response body (e.g., as `meta.captured_at`) and update `StaleBanner` to prefer it.

3. **PERF-02/03 test scope**
   - What we know: Context.md says `/api/home` and `/api/history/*` are "NOT in scope" for dedicated tests — "spot-check if needed."
   - What's unclear: Whether PERF-02 and PERF-03 requirements can be marked complete with just a spot-check note, or need a test.
   - Recommendation: Create a single lightweight test for each (`api-home.test.ts`, `api-history.test.ts`) with one timing assertion and a mocked DB — this closes the requirement formally. Keep them minimal (5-10 lines each).

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.0.18 |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npm test -- --reporter=verbose src/lib/api-live.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PERF-01 | /api/live handler wall time < 200ms | integration | `npm test -- src/lib/api-live.test.ts` | ✅ (has .todo stubs) |
| PERF-02 | /api/home handler wall time < 300ms | integration | `npm test -- src/lib/api-home.test.ts` | ❌ Wave 0 |
| PERF-03 | /api/history/* handler wall time < 400ms | integration | `npm test -- src/lib/api-history.test.ts` | ❌ Wave 0 |
| RELY-01 | DATA_DELAYED state served when snapshot is stale | integration | `npm test -- src/lib/api-live.test.ts` | ✅ (has .todo stubs) |
| RELY-02 | calculateBackoff math + failure counter behavior | unit | `npm test -- scripts/lib/poll-live-logic.test.ts` | ✅ exists + passing |
| RELY-03 | UI renders last data + StaleBanner during DATA_DELAYED | manual-only | Manual: set `is_stale=true` in live_snapshot, open /live | N/A |

**RELY-03 is manual-only:** The React UI behavior (StaleBanner visibility + scoreboard still rendered) cannot be tested with Vitest alone. No browser automation is in scope. A checklist-based manual smoke test suffices.

### Sampling Rate
- **Per task commit:** `npm test -- src/lib/api-live.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/api-home.test.ts` — covers PERF-02 (minimal timing test, mocked DB)
- [ ] `src/lib/api-history.test.ts` — covers PERF-03 (minimal timing test, mocked DB)
- [ ] Vitest config may need `app/**/*.test.ts` added to `include` — only if tests are co-located with routes (not recommended; keep in `src/lib/`)

---

## Sources

### Primary (HIGH confidence)
- `/Users/luke/CCC/src/lib/api-live.test.ts` — existing test scaffold, `.todo` stubs, helper patterns
- `/Users/luke/CCC/scripts/lib/poll-live-logic.test.ts` — established mock factory pattern (`makeGame()`), all backoff tests
- `/Users/luke/CCC/scripts/lib/poll-live-logic.ts` — `calculateBackoff()` implementation (pure, no deps)
- `/Users/luke/CCC/app/api/live/route.ts` — active route handler, sql call sequence, staleness logic
- `/Users/luke/CCC/vitest.config.ts` — include globs, no resolve aliases configured
- `/Users/luke/CCC/components/stale-banner/StaleBanner.tsx` — existing banner component
- `/Users/luke/CCC/app/live/page.tsx` — banner integration, current placement
- `/Users/luke/CCC/.planning/phases/15-reliability-and-validation/15-CONTEXT.md` — all locked decisions

### Secondary (MEDIUM confidence)
- Vitest v4 docs (vi.mock hoisting behavior) — consistent with observed codebase patterns

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Vitest already installed and configured, patterns established in existing test files
- Architecture: HIGH — Both route files read directly; active file confirmed via import alias analysis
- Pitfalls: HIGH — sql mock shape and multiple-call sequencing derived from reading the actual route handler code
- StaleBanner bug: MEDIUM — `captured_at` vs `generated_at` discrepancy observed in code; behavior under real outage conditions not directly testable

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (stable stack, no fast-moving dependencies)
