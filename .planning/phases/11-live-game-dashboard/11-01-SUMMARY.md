---
phase: 11-live-game-dashboard
plan: 01
subsystem: testing
tags: [vitest, typescript, pure-functions, tdd, utilities]

# Dependency graph
requires:
  - phase: 10-core-ui-framework
    provides: Vitest setup and src/lib/ test infrastructure already in place
provides:
  - formatClock pure function — ISO 8601 duration to MM:SS display string
  - computeFtEdge pure function — LAC vs opponent FT made delta computation
  - getNextIndex pure function — circular index wrapping for insight rotation
affects:
  - 11-live-game-dashboard (plans 02 and 03 import these utilities)

# Tech tracking
tech-stack:
  added: []
  patterns: [TDD RED-GREEN cycle, pure utility functions with no React/DOM/DB dependency]

key-files:
  created:
    - src/lib/format.ts
    - src/lib/live-utils.ts
    - src/lib/format.test.ts
    - src/lib/live-utils.test.ts
    - src/lib/use-insight-rotation.test.ts
  modified: []

key-decisions:
  - "formatClock regex /PT(?:(\\d+)M)?(?:([\\d.]+)S)?/ with passthrough fallback for non-ISO formats and empty strings"
  - "computeFtEdge splits 'made-attempted' on '-' and uses NaN-to-0 coercion for empty/malformed inputs"
  - "getNextIndex returns 0 when length <= 1 to handle single-item and empty array edge cases safely"
  - "use-insight-rotation.test.ts tests only the pure helper (not the hook) to avoid jsdom dependency per LIVE-10 requirement"

patterns-established:
  - "Pure utility extraction: rotation logic extracted from hook to lib for testability without jsdom"
  - "TDD RED commit precedes GREEN commit — test file and implementation file committed separately"

requirements-completed: [LIVE-02, LIVE-05, LIVE-10]

# Metrics
duration: 5min
completed: 2026-03-06
---

# Phase 11 Plan 01: Utility Functions Summary

**ISO 8601 clock parser (formatClock), FT margin calculator (computeFtEdge), and circular index helper (getNextIndex) — 22 pure-function tests all green, zero React/DOM/DB imports**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-06T19:41:26Z
- **Completed:** 2026-03-06T19:42:30Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- RED test suite committed first (3 files, 22 tests) — confirmed "Cannot find module" before implementation
- Implemented formatClock with ISO 8601 regex and passthrough fallback for MM:SS and malformed inputs
- Implemented computeFtEdge with NaN-to-0 coercion for empty/missing FT strings
- Implemented getNextIndex with edge case handling for empty and single-item arrays
- Full Vitest suite (14 files, 116 tests) remains green — no regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Write RED tests for formatClock, computeFtEdge, and getNextIndex** - `60dc972` (test)
2. **Task 2: Implement formatClock, computeFtEdge, and getNextIndex (GREEN)** - `7c7698a` (feat)

## Files Created/Modified

- `src/lib/format.ts` - formatClock export: ISO 8601 → "M:SS", passthrough for non-ISO
- `src/lib/live-utils.ts` - computeFtEdge and getNextIndex exports — pure, no side effects
- `src/lib/format.test.ts` - 7 Vitest cases covering ISO parsing, passthrough, edge cases
- `src/lib/live-utils.test.ts` - 5 FT edge + 5 index-wrap cases
- `src/lib/use-insight-rotation.test.ts` - 5 pure rotation tests (no jsdom)

## Decisions Made

- `formatClock` uses passthrough fallback (returns input unchanged) for non-ISO strings and empty input — never throws
- `computeFtEdge` coerces `parseInt` NaN to 0 via `isNaN` guard rather than try/catch — simpler and correct for the "made-attempted" format
- `getNextIndex` guards `length <= 1` explicitly (not just `length === 0`) to handle both empty and single-item arrays safely
- `use-insight-rotation.test.ts` named after the hook but tests only the extracted pure helper — satisfies LIVE-10 "no jsdom" requirement while linking test intent to consumer

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `src/lib/format.ts` exports `formatClock` — ready for Plan 02 import in LiveScoreboard.tsx
- `src/lib/live-utils.ts` exports `computeFtEdge` — ready for Plan 02 import in KeyMetricsRow.tsx
- `src/lib/live-utils.ts` exports `getNextIndex` — ready for Plan 03 import in hooks/useInsightRotation.ts
- Full test suite green — Plans 02 and 03 inherit a clean baseline

---
*Phase: 11-live-game-dashboard*
*Completed: 2026-03-06*
