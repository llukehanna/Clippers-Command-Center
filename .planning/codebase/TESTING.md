# Testing Patterns

**Analysis Date:** 2026-03-05

**Note:** This project is pre-implementation. No test files exist yet. This document defines the intended testing approach derived from the project specifications in `Docs/REQUIREMENTS.md`, `Docs/MVP_CHECKLIST.md`, `Docs/API_SPEC.md`, `Docs/INGESTION_PLAN.md`, and `Docs/ARCHITECTURE.md`. These patterns should be established during initial implementation.

---

## Recommended Test Framework

**Runner:** Vitest (recommended for Next.js App Router projects; compatible with TypeScript and ESM)

**Alternative:** Jest with `ts-jest` (acceptable if preferred)

**Config file:** `vitest.config.ts` (to be created at project root)

**Assertion Library:** Vitest built-in (`expect`) — no additional library needed

**HTTP Testing:** `supertest` or Next.js `createRequest`/`createResponse` for API route handler unit tests; integration tests can use `fetch` against a running dev server.

**Database testing:** Use a separate test database (e.g., Neon branch or local PostgreSQL instance). Never run tests against production.

**Run Commands:**
```bash
npx vitest                  # Run all tests (watch mode)
npx vitest run              # Run all tests once (CI mode)
npx vitest run --coverage   # Run with coverage report
npx vitest run src/jobs/    # Run only job tests
```

---

## Test File Organization

**Location:** Co-located with source files, in a `__tests__` subdirectory or using `.test.ts` / `.spec.ts` suffix.

Preferred pattern:
```
src/
  app/
    api/
      live/
        route.ts
        route.test.ts         # API route unit tests
  jobs/
    sync_schedule.ts
    sync_schedule.test.ts     # Job unit tests
  lib/
    insights/
      generator.ts
      generator.test.ts       # Insight engine tests
    stats/
      advanced.ts
      advanced.test.ts        # Stats computation tests
```

**Naming:**
- Test files: `{module-name}.test.ts`
- Test suite: `describe` block named after the module or function under test
- Test cases: `it` or `test` with a plain English description of the expected behavior

---

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("syncSchedule", () => {
  beforeEach(() => {
    // reset mocks, seed test state
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("upserts upcoming Clippers games from provider response", async () => {
    // arrange
    // act
    // assert
  });

  it("preserves existing games when provider is unavailable", async () => {
    // ...
  });
});
```

**Patterns:**
- Use `beforeEach` to reset mocks and establish test state
- Use `afterEach` with `vi.restoreAllMocks()` to clean up
- Group related tests within `describe` blocks; nest `describe` for sub-behaviors
- Prefer `it("does X when Y")` naming — behavior-focused, not implementation-focused

---

## Priority Test Areas

Based on the MVP definition of done (`Docs/MVP_CHECKLIST.md`) and data integrity requirements, these areas require thorough testing:

### 1. Insight Proof Validation (Highest Priority)
Every insight must have a valid proof payload. This is a core product rule.

```typescript
describe("insightGenerator", () => {
  it("does not emit an insight when proof_result is missing", async () => {
    const candidate = buildCandidateInsight({ proofResult: null });
    const results = await generateInsights([candidate]);
    expect(results).toHaveLength(0);
  });

  it("does not emit an insight when proof_sql execution fails", async () => {
    vi.spyOn(db, "query").mockRejectedValueOnce(new Error("query failed"));
    const results = await generateInsights([validCandidate]);
    expect(results).toHaveLength(0);
  });

  it("emits an insight with complete proof fields when valid", async () => {
    const results = await generateInsights([validCandidate]);
    expect(results[0]).toMatchObject({
      proof_sql: expect.any(String),
      proof_result: expect.any(Object),
    });
  });
});
```

### 2. Advanced Stats Computations
Stats formulas must be deterministic and correct. Test each computation function in isolation.

```typescript
describe("computeAdvancedStats", () => {
  it("computes possessions correctly for a regulation game", () => {
    const box = buildTeamBoxScore({ fgAttempted: 80, orb: 10, turnovers: 12, ftAttempted: 20 });
    const { possessions } = computePossessions(box);
    expect(possessions).toBeCloseTo(expected, 1);
  });

  it("computes eFG% correctly", () => {
    const efg = computeEfgPct({ fgMade: 33, fg3Made: 9, fgAttempted: 70 });
    expect(efg).toBeCloseTo(0.536, 3);
  });
});
```

### 3. Ingestion Job Idempotency
Jobs run multiple times should produce the same result.

```typescript
describe("syncSchedule idempotency", () => {
  it("produces identical DB state when run twice with the same provider payload", async () => {
    await syncSchedule(mockPayload);
    const stateAfterFirst = await db.query("SELECT * FROM games ORDER BY game_id");

    await syncSchedule(mockPayload);
    const stateAfterSecond = await db.query("SELECT * FROM games ORDER BY game_id");

    expect(stateAfterSecond.rows).toEqual(stateAfterFirst.rows);
  });
});
```

### 4. Failure Handling / Stale Data
The system must preserve last known good state on upstream failure.

```typescript
describe("pollLiveClippersGame failure handling", () => {
  it("does not overwrite game state with null when provider call fails", async () => {
    await seedGame({ gameId: 1, homeScore: 88, awayScore: 84 });
    vi.spyOn(nbaLiveClient, "fetch").mockRejectedValueOnce(new Error("timeout"));

    await pollLiveClippersGame(1);

    const game = await db.query("SELECT * FROM games WHERE game_id = 1");
    expect(game.rows[0].home_score).toBe(88);
    expect(game.rows[0].away_score).toBe(84);
  });
});
```

### 5. API Response Shape
Verify response envelopes are consistent across endpoints.

```typescript
describe("GET /api/live", () => {
  it("returns meta envelope with required fields", async () => {
    const response = await callRoute(liveRoute, { method: "GET" });
    const body = await response.json();

    expect(body.meta).toMatchObject({
      generated_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      source: expect.any(String),
      stale: expect.any(Boolean),
      stale_reason: expect.anything(),
      ttl_seconds: expect.anything(),
    });
  });

  it("returns state=NO_ACTIVE_GAME with null game when no Clippers game is live", async () => {
    // seed DB with no active game
    const response = await callRoute(liveRoute, { method: "GET" });
    const body = await response.json();

    expect(body.state).toBe("NO_ACTIVE_GAME");
    expect(body.game).toBeNull();
    expect(body.insights).toEqual([]);
  });

  it("returns odds: null when no odds data is available", async () => {
    const body = (await callRoute(liveRoute, { method: "GET" })).json();
    expect(body.odds).toBeNull();
  });
});
```

---

## Mocking

**Framework:** Vitest (`vi.mock`, `vi.spyOn`, `vi.fn`)

**Patterns:**

Mock external HTTP clients (NBA Live, BALLDONTLIE, odds provider):
```typescript
vi.mock("@/lib/clients/nba-live", () => ({
  fetchLiveGame: vi.fn().mockResolvedValue(mockLivePayload),
}));
```

Mock database for unit tests of job logic:
```typescript
vi.mock("@/lib/db", () => ({
  db: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  },
}));
```

Spy on a method to verify it was called without replacing the full module:
```typescript
const querySpy = vi.spyOn(db, "query");
await syncSchedule();
expect(querySpy).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO games"), expect.any(Array));
```

**What to mock:**
- External HTTP clients (NBA Live API, BALLDONTLIE, odds provider)
- Database connections in unit tests of job/service logic
- `Date.now()` / `new Date()` when testing staleness logic or timestamps
- `app_kv` checkpoint reads in job tests

**What NOT to mock:**
- Stats computation functions — test these with real inputs and expected outputs
- Insight proof validation logic — this must be tested with real proof structures
- Database in integration tests — use a real test database instance

---

## Fixtures and Factories

Create factory functions for test data to avoid repetition and keep tests readable.

**Pattern:**
```typescript
// src/__tests__/factories/game.ts
export function buildGame(overrides: Partial<Game> = {}): Game {
  return {
    game_id: 1,
    nba_game_id: 100001,
    season_id: 2025,
    game_date: "2026-03-05",
    start_time_utc: "2026-03-06T03:00:00Z",
    status: "in_progress",
    home_team_id: 14,  // LAC
    away_team_id: 7,   // DEN
    home_score: 88,
    away_score: 84,
    period: 3,
    clock: "05:32",
    is_playoffs: false,
    ...overrides,
  };
}

export function buildInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    insight_id: "b6a7b8f8-3a1c-4c4d-9c9e-123456789abc",
    scope: "live",
    category: "streak",
    headline: "Clippers have won 7 of their last 9 at home",
    detail: "Last 9 home games: 7–2",
    importance: 78,
    is_active: true,
    proof_sql: "SELECT COUNT(*) FROM games WHERE ...",
    proof_params: { team_id: 14, limit: 9 },
    proof_result: { wins: 7, losses: 2 },
    ...overrides,
  };
}
```

**Location:** `src/__tests__/factories/` — one file per primary entity.

**Fixtures (static JSON):** Store static provider response payloads for replay testing in `src/__tests__/fixtures/`. Example: `nba-live-response.json`, `balldontlie-games.json`.

---

## Coverage

**Requirements:** No hard enforcement defined in specs, but the following areas should achieve high coverage:

| Area | Priority |
|---|---|
| Stats computation functions (`advanced.ts`, `rolling.ts`) | High — formulas must be correct |
| Insight proof validation | High — core product guarantee |
| Job idempotency paths | High — data integrity |
| API response shape validation | Medium |
| Failure/stale handling paths | Medium |
| UI components | Low for MVP |

**View Coverage:**
```bash
npx vitest run --coverage
# opens coverage/index.html
```

---

## Test Types

**Unit Tests:**
- Scope: individual functions and modules in isolation
- Applies to: stats computation, insight proof logic, data transformation utilities, individual job steps
- Dependencies: mocked
- Speed: fast (< 1s per file)

**Integration Tests:**
- Scope: full job execution against a real test database
- Applies to: `syncSchedule`, `finalizeCompletedGames`, `computeAdvancedStats`, `generateInsightsBatch`
- Dependencies: real PostgreSQL test DB (no external HTTP — provider calls are mocked)
- Required setup: apply `Docs/DB_SCHEMA.sql` to test DB before suite runs

**API Route Tests:**
- Scope: Next.js route handlers end-to-end, against test DB
- Applies to: all endpoints in `Docs/API_SPEC.md`
- Validates: response shape, meta envelope, null handling, error codes

**E2E Tests:**
- Not required for MVP
- Consider Playwright once the UI stabilizes post-MVP

---

## Common Patterns

**Async Testing:**
```typescript
it("inserts a live_snapshot row on successful poll", async () => {
  vi.spyOn(nbaLiveClient, "fetchLiveGame").mockResolvedValue(mockLivePayload);
  await pollLiveClippersGame(gameId);
  const rows = await db.query("SELECT * FROM live_snapshots WHERE game_id = $1", [gameId]);
  expect(rows.rowCount).toBe(1);
  expect(rows.rows[0].payload).toMatchObject(mockLivePayload);
});
```

**Error / Failure Testing:**
```typescript
it("returns DATA_DELAYED state when live provider is unavailable", async () => {
  vi.spyOn(nbaLiveClient, "fetchLiveGame").mockRejectedValue(new Error("network error"));
  const response = await callRoute(liveRoute, { method: "GET" });
  const body = await response.json();
  expect(body.state).toBe("DATA_DELAYED");
  expect(response.status).toBe(200); // NOT a 500 — graceful degradation
});
```

**Idempotency Testing:**
```typescript
it("does not duplicate rows when run twice with identical input", async () => {
  await job.run(input);
  await job.run(input);
  const count = await db.query("SELECT COUNT(*) FROM games WHERE nba_game_id = $1", [input.nbaGameId]);
  expect(Number(count.rows[0].count)).toBe(1);
});
```

**Null / Missing Data Testing:**
```typescript
it("returns odds: null when no odds snapshot exists for the game", async () => {
  await seedGame({ gameId: 999 }); // no odds seeded
  const body = await fetchApi("/api/live");
  expect(body.odds).toBeNull();
});

it("does not emit insight when proof_result is null", async () => {
  const candidate = buildInsight({ proof_result: null });
  const emitted = await validateAndEmitInsights([candidate]);
  expect(emitted).toHaveLength(0);
});
```

---

## Test Database Setup

Apply schema before running integration/API tests:

```bash
psql $TEST_DATABASE_URL -f Docs/DB_SCHEMA.sql
```

Use a global test setup file to reset tables between integration test runs:

```typescript
// vitest.setup.ts
import { db } from "@/lib/db";

beforeEach(async () => {
  // truncate all tables in dependency order
  await db.query(`TRUNCATE TABLE insights, rolling_player_stats, rolling_team_stats,
    advanced_player_game_stats, advanced_team_game_stats, live_snapshots, odds_snapshots,
    game_player_box_scores, game_team_box_scores, games, player_team_stints,
    players, teams, seasons, app_kv CASCADE`);
});
```

---

*Testing analysis: 2026-03-05*
