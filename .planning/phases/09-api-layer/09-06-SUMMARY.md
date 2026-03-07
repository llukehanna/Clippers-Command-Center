---
phase: 09-api-layer
plan: "06"
subsystem: api
tags: [next.js, postgres, vitest, tdd, typescript, insights]

# Dependency graph
requires:
  - phase: 09-api-layer
    plan: "01"
    provides: "src/lib/db.ts (sql singleton), src/lib/api-utils.ts (buildMeta/buildError), RED test scaffold in api-insights.test.ts"
  - phase: 06-insight-engine
    provides: "insights table with is_active, scope, importance, proof_result columns"
provides:
  - "src/app/api/insights/route.ts — GET /api/insights handler returning active insights by scope"
affects:
  - "dashboard UI consuming /api/insights rotating tile pool"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fragment-aware sql mock: distinguishes sub-fragment calls (short strings array) from main query calls (long strings array) for accurate tagged-template-literal mocking in vitest"
    - "Conditional sql fragment pattern: ${condition ? sql`AND col = ${val}` : sql``} for optional WHERE clauses"

key-files:
  created:
    - src/app/api/insights/route.ts
  modified:
    - src/lib/api-insights.test.ts

key-decisions:
  - "Fragment-aware mock strategy: sql template sub-calls (strings.length < 4) return fragment objects; main query calls (strings.length >= 4) return Promise<rows> — enables accurate TDD mocking without DB"
  - "proof.summary maps to row.category, proof.result maps to row.proof_result (JSONB already parsed by postgres driver)"
  - "TTL set to 30s with Cache-Control: public, max-age=30 — insights can be added at any time by generate-insights script"
  - "scope validation uses VALID_SCOPES const array: live | between_games | historical — 400 on missing or invalid scope"

patterns-established:
  - "Scope validation pattern: check !scope first (missing), then !validScopes.includes(scope) (invalid), return 400 with buildError in both cases"
  - "Insights route always queries is_active=true — fabricated/inactive insights never surface"

requirements-completed: [API-06, API-07]

# Metrics
duration: 5min
completed: 2026-03-07
---

# Phase 9 Plan 06: GET /api/insights Summary

**Scope-filtered insights endpoint with is_active=true guard, importance DESC sort, proof mapping (summary=category, result=proof_result), and 30s TTL — powers the rotating insight tile system**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-07T01:05:52Z
- **Completed:** 2026-03-07T01:11:00Z
- **Tasks:** 1 (TDD: RED + GREEN commits)
- **Files modified:** 2

## Accomplishments

- Created `src/app/api/insights/route.ts` implementing GET /api/insights with scope validation, optional game_id/player_id filtering, importance DESC sort, and proof mapping
- Converted the Wave 1 RED scaffold in `api-insights.test.ts` from `.todo()` placeholders to 12 real behavioral tests using a fragment-aware sql mock
- All 13 tests pass (1 smoke + 12 behavioral); full suite: 94 passing, 43 todo, 0 failing

## Task Commits

Each task was committed atomically (TDD: RED then GREEN):

1. **RED: Failing tests for GET /api/insights** - `1341223` (test)
2. **GREEN: Implement GET /api/insights route handler** - `d739074` (feat)

## Files Created/Modified

- `src/app/api/insights/route.ts` — GET handler: scope validation, optional game_id/player_id filters, is_active=true guard, importance DESC sort, proof mapping, 30s TTL
- `src/lib/api-insights.test.ts` — Converted from todo() scaffolds to 12 real behavioral tests with fragment-aware vi.mock for the sql tagged template literal

## Decisions Made

- **Fragment-aware mock**: postgres.js `sql` tagged template literal calls sub-fragment expressions (e.g., `sql\`AND game_id = ${val}\``) as separate invocations before the outer template. Mocked by checking `strings.length < 4` for fragments vs `>= 4` for main query — returns plain fragment objects vs `Promise<rows>` accordingly.
- **proof field mapping**: `proof.summary = row.category` (the category enum value), `proof.result = row.proof_result` (JSONB parsed by postgres driver, passed through as-is)
- **TTL = 30s**: Short TTL chosen because insights can be generated at any time by the `generate-insights` script — clients should not cache stale insight pools for long

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fragment-aware mock to handle postgres tagged template literal sub-calls**
- **Found during:** Task 1 GREEN phase (tests were returning 500 instead of 200)
- **Issue:** The mock `mockSql.mockResolvedValueOnce(rows)` was consumed by the first sub-fragment call (`sql\`\``) before the main query could use it — the main query received `undefined` instead of the rows array, causing `.map()` to throw
- **Fix:** Changed mock to inspect `strings.length` — sub-fragment calls (< 4 strings) return synchronous fragment objects; main query calls (>= 4 strings) return `Promise.resolve(mockRows)` from the module-level `mockRows` variable, which is set per-test
- **Files modified:** `src/lib/api-insights.test.ts`
- **Verification:** All 13 tests pass; full suite green
- **Committed in:** `d739074` (GREEN implementation commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in test mock strategy)
**Impact on plan:** Required to make the TDD test infrastructure work correctly. The route implementation itself matches the plan exactly.

## Issues Encountered

The postgres tagged template literal sub-fragment evaluation order required a more sophisticated mock than a simple `mockResolvedValueOnce`. The fragment-aware approach is the correct general pattern for mocking postgres.js in vitest.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- GET /api/insights is production-ready: scope validation, is_active filtering, optional param filters, proof mapping, 30s TTL/cache headers
- All Wave 2 API plans (09-02 through 09-06) are now complete
- Full npm test suite passes with 94 tests green

---
*Phase: 09-api-layer*
*Completed: 2026-03-07*
