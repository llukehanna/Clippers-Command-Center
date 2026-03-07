---
phase: 08-odds-integration
plan: "01"
subsystem: database
tags: [odds, types, postgres, vitest, tdd]

# Dependency graph
requires:
  - phase: 07-live-data-pipeline
    provides: src/lib/types/live.ts pattern (zero runtime imports), scripts/lib/db.ts sql tag
provides:
  - OddsAdapter interface for provider swappability (ODDS-04)
  - OddsSnapshot type for API and UI layers (ODDS-02)
  - OddsEvent type for adapter return shape
  - getLatestOdds(gameId) query helper with 24h staleness enforcement (ODDS-03)
  - Full unit test coverage for getLatestOdds
affects:
  - 08-02 (adapter/script that uses OddsAdapter and inserts OddsSnapshot)
  - Phase 9 API routes (import getLatestOdds from src/lib/odds.ts)
  - Phase 12, 14 (UI display of odds data)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Zero runtime imports in src/lib/types/ (pure type declarations, safe for both scripts/ and Next.js)
    - TDD cycle with vi.mock for sql template tag (no live DB needed for unit tests)
    - NUMERIC columns cast to float8 in SELECT for JS number compatibility
    - captured_at::text for ISO string return shape without post-processing
    - game_id as ::bigint cast (established pattern from Phase 04-02)

key-files:
  created:
    - src/lib/types/odds.ts
    - src/lib/odds.ts
    - src/lib/odds.test.ts
  modified: []

key-decisions:
  - "OddsAdapter interface uses structural typing — no explicit implements needed, any class with fetchNBAOdds() and providerKey satisfies the interface"
  - "NUMERIC columns (spread_home, spread_away, total_points) cast to float8 in SELECT — avoids postgres.js string coercion"
  - "captured_at returned as text (ISO string) — downstream API phases compute meta.stale without re-querying"
  - "TDD RED tests committed before odds.ts exists — demonstrates contract-first design"

patterns-established:
  - "src/lib/types/odds.ts mirrors live.ts zero-runtime-imports pattern"
  - "vi.mock for scripts/lib/db.js sql tag: mockSql.mockResolvedValueOnce([]) for empty, mockResolvedValueOnce([row]) for data"

requirements-completed: [ODDS-02, ODDS-03, ODDS-04]

# Metrics
duration: 1min
completed: 2026-03-07
---

# Phase 8 Plan 01: Type Contracts and getLatestOdds Query Helper Summary

**OddsAdapter interface, OddsSnapshot/OddsEvent types with zero runtime imports, and getLatestOdds query helper with TDD coverage and 24h staleness enforcement**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-07T00:17:17Z
- **Completed:** 2026-03-07T00:18:37Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Defined OddsAdapter, OddsSnapshot, and OddsEvent types in src/lib/types/odds.ts with zero runtime imports
- Implemented getLatestOdds(gameId) query helper with SQL-level 24h staleness filter and float8 casts
- 8 passing unit tests via TDD cycle with vi.mock isolating from live DB

## Task Commits

Each task was committed atomically:

1. **Task 1: Define type contracts** - `9a82967` (feat)
2. **Task 2: TDD RED — failing tests** - `89a89b6` (test)
3. **Task 2: TDD GREEN — getLatestOdds implementation** - `9792e6f` (feat)

## Files Created/Modified
- `src/lib/types/odds.ts` - OddsAdapter interface, OddsSnapshot and OddsEvent types (zero runtime imports)
- `src/lib/odds.ts` - getLatestOdds query helper using sql template tag from scripts/lib/db.ts
- `src/lib/odds.test.ts` - 8 unit tests covering null/fresh/partial/field cases

## Decisions Made
- OddsAdapter uses structural typing — any class with `fetchNBAOdds()` and `providerKey` satisfies the interface without explicit `implements`
- NUMERIC DB columns cast to `float8` in SELECT to get JS numbers (not strings from postgres.js)
- `captured_at::text` returned as ISO string so Phase 9 can compute `meta.stale` without an extra query
- TDD RED committed first to document contract before implementation

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Types ready for Plan 02 (TheOddsApiAdapter + sync-odds.ts script)
- getLatestOdds ready for Phase 9 API route consumption
- vitest.config.ts already includes src/lib/**/*.test.ts so tests run in full suite

---
*Phase: 08-odds-integration*
*Completed: 2026-03-07*
