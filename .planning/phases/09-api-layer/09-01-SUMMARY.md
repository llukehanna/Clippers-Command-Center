---
phase: 09-api-layer
plan: "01"
subsystem: api
tags: [postgres, next.js, vitest, tdd, typescript]

# Dependency graph
requires:
  - phase: 08-odds-integration
    provides: "OddsSnapshot type and getLatestOdds() helper (src/lib/odds.ts)"
  - phase: 07-live-data-pipeline
    provides: "LiveGameState type and live_snapshots table"
  - phase: 06-insight-engine
    provides: "generated_insights table and insight generators"
provides:
  - "src/lib/db.ts — Next.js-safe postgres singleton with globalThis hot-reload cache and LAC_NBA_TEAM_ID"
  - "src/lib/api-utils.ts — buildMeta() and buildError() response builders matching API_SPEC.md envelope"
  - "6 RED test scaffold files covering all API endpoint groups (API-01 through API-07)"
affects:
  - "09-02 through 09-06 — all Wave 2 plans import db.ts and api-utils.ts"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Next.js-safe singleton: globalThis cache + throw (not process.exit) for missing DATABASE_URL"
    - "TDD Wave 1 gate: RED test scaffolds define contract, Wave 2 plans turn them GREEN"
    - "MetaEnvelope pattern: buildMeta() produces consistent 5-field meta for every API response"

key-files:
  created:
    - src/lib/db.ts
    - src/lib/api-utils.ts
    - src/lib/api-live.test.ts
    - src/lib/api-home.test.ts
    - src/lib/api-players.test.ts
    - src/lib/api-schedule.test.ts
    - src/lib/api-history.test.ts
    - src/lib/api-insights.test.ts
  modified:
    - src/lib/odds.ts
    - src/lib/odds.test.ts

key-decisions:
  - "db.ts throws Error on missing DATABASE_URL (not process.exit) — Next.js surfaces error in overlay rather than hard-crashing"
  - "globalThis._sql cache survives Next.js hot reload in dev — avoids connection pool exhaustion during development"
  - "odds.ts import changed from scripts/lib/db.js to ./db.js — eliminates process.exit path from odds helper"
  - "odds.test.ts vi.mock path updated to ./db.js — required to match the updated import path"

patterns-established:
  - "All src/lib/*.ts API infrastructure imports from ./db.js (not scripts/lib/db.js)"
  - "buildMeta(source, ttl_seconds, stale?, stale_reason?) is the standard meta factory for all route handlers"
  - "buildError(code, message, details?) produces consistent error envelopes across all routes"

requirements-completed: [API-01, API-02, API-03, API-04, API-05, API-06, API-07]

# Metrics
duration: 3min
completed: 2026-03-07
---

# Phase 9 Plan 01: API Layer Foundation Summary

**Next.js-safe postgres singleton (db.ts), meta envelope builders (api-utils.ts), and TDD RED test scaffolds for all 6 API endpoint groups covering 62 behavioral specs**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-07T01:00:50Z
- **Completed:** 2026-03-07T01:03:12Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- Created Next.js-safe `src/lib/db.ts` with globalThis hot-reload protection, throw on missing `DATABASE_URL`, and `LAC_NBA_TEAM_ID` constant
- Created `src/lib/api-utils.ts` with `buildMeta()` and `buildError()` matching the API_SPEC.md meta envelope shape exactly
- Fixed `src/lib/odds.ts` import from `../../scripts/lib/db.js` to `./db.js`, eliminating the `process.exit` code path from the API layer
- Created 6 RED test scaffold files (api-live, api-home, api-players, api-schedule, api-history, api-insights) with 62 total behavioral specs as `.todo()` tests plus 8 immediately-passing smoke tests for `buildMeta`/`buildError`
- All tests pass: 71 passing, 62 todo, 0 failing

## Task Commits

Each task was committed atomically:

1. **Task 1: Create db.ts, api-utils.ts, fix odds.ts import** - `b1a9ada` (feat)
2. **Task 2: Write RED test scaffolds for all 6 endpoint groups** - `89dc6b2` (test)

## Files Created/Modified

- `src/lib/db.ts` — Next.js-safe postgres singleton with globalThis cache and LAC_NBA_TEAM_ID
- `src/lib/api-utils.ts` — buildMeta() and buildError() response envelope builders
- `src/lib/odds.ts` — fixed import path from scripts/lib/db.js to ./db.js
- `src/lib/odds.test.ts` — updated vi.mock path to match new import
- `src/lib/api-live.test.ts` — RED specs for /api/live (API-01, API-07)
- `src/lib/api-home.test.ts` — RED specs for /api/home (API-02, API-07)
- `src/lib/api-players.test.ts` — RED specs for /api/players[/{id}] (API-03, API-07)
- `src/lib/api-schedule.test.ts` — RED specs for /api/schedule (API-04, API-07)
- `src/lib/api-history.test.ts` — RED specs for /api/history/* (API-05, API-07)
- `src/lib/api-insights.test.ts` — RED specs for /api/insights (API-06, API-07)

## Decisions Made

- `db.ts` uses `throw new Error(...)` instead of `process.exit(1)` — Next.js can surface the error in its error overlay; `process.exit` would bypass the overlay and crash the server opaquely
- `globalThis._sql` cache pattern adopted from Phase 4 patterns — identical to the established approach for other singletons in the codebase
- `odds.test.ts` vi.mock path updated as part of Task 2 (Rule 1 auto-fix — the mock needed to match the actual import path for the test to work)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated odds.test.ts vi.mock path after odds.ts import fix**
- **Found during:** Task 2 (test scaffold creation — npm test run exposed the failure)
- **Issue:** `odds.test.ts` was mocking `../../scripts/lib/db.js` but `odds.ts` now imports from `./db.js`. The test failed with "DATABASE_URL is not set" because the mock no longer intercepted the import.
- **Fix:** Updated `vi.mock('../../scripts/lib/db.js', ...)` to `vi.mock('./db.js', ...)` and updated the corresponding import of `sql` to match.
- **Files modified:** `src/lib/odds.test.ts`
- **Verification:** `npm test` — all 71 tests pass, 62 todo, 0 failing
- **Committed in:** `89dc6b2` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug)
**Impact on plan:** Fix was necessary for `npm test` to pass as required by Task 2 done criteria. No scope creep.

## Issues Encountered

None beyond the auto-fixed vi.mock path.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Wave 1 gate satisfied: `db.ts` and `api-utils.ts` exist, `odds.ts` import is fixed
- All 6 RED test scaffolds are in place with behavioral specs for Plans 02–06 to implement against
- `npm test` is green — Wave 2 plans can execute in parallel without breaking the test suite
- Plans 02–06 import `sql` from `../../lib/db.js` and `buildMeta/buildError` from `../../lib/api-utils.js`

---
*Phase: 09-api-layer*
*Completed: 2026-03-07*
