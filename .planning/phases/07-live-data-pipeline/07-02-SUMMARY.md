---
phase: 07-live-data-pipeline
plan: 02
subsystem: testing
tags: [vitest, tdd, nba-live, backoff, clippers-detection]

# Dependency graph
requires:
  - phase: 07-live-data-pipeline/07-01
    provides: src/lib/types/live.ts (ScoreboardGame type), scripts/lib/nba-live-client.ts (parseNBAClock, clockToSecondsRemaining)
provides:
  - scripts/lib/nba-live-client.test.ts — 9 unit tests for clock parsing functions (GREEN)
  - scripts/lib/poll-live-logic.ts — pure helper functions: calculateBackoff, isClippersGame, findClippersGame, gameStatusLabel
  - scripts/lib/poll-live-logic.test.ts — 16 unit tests for all pure helpers (GREEN)
affects:
  - 07-04-poll-live (imports calculateBackoff, isClippersGame, findClippersGame, LAC_TEAM_ID from poll-live-logic.ts)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD Wave 0: write failing tests, commit RED, implement, commit GREEN — two-commit pattern per feature"
    - "Pure functions isolated in lib/poll-live-logic.ts — no DB, no fetch, fully unit-testable"
    - "Vitest config broadened from insights/ subdirs to scripts/lib/**/*.test.ts pattern"

key-files:
  created:
    - scripts/lib/nba-live-client.test.ts
    - scripts/lib/poll-live-logic.ts
    - scripts/lib/poll-live-logic.test.ts
  modified:
    - vitest.config.ts

key-decisions:
  - "calculateBackoff uses Math.min(baseMs * Math.pow(2, failureCount), 60_000) — failureCount=0 naturally returns baseMs (Math.pow(2,0)=1)"
  - "findClippersGame returns first match via Array.find — correct since only one LAC game per day in normal operation"
  - "LAC_TEAM_ID exported from poll-live-logic.ts so poll-live.ts (Plan 04) can import it alongside the helper functions"
  - "vitest.config.ts broadened from insights/ subdirs to scripts/lib/**/*.test.ts to support new test locations"

patterns-established:
  - "TDD RED commit before implementation exists, then GREEN commit after — clear two-phase commit history"
  - "Helper factory function in test file (makeGame) for constructing minimal ScoreboardGame objects — avoids repetitive boilerplate"

requirements-completed: [LIVE-01, LIVE-12]

# Metrics
duration: 3min
completed: 2026-03-06
---

# Phase 7 Plan 02: TDD Wave 0 — clock and poll-live-logic unit tests Summary

**Vitest unit tests for parseNBAClock/clockToSecondsRemaining (9 tests) and pure poll-live helpers calculateBackoff/isClippersGame/findClippersGame/gameStatusLabel (16 tests), all GREEN**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-06T23:16:14Z
- **Completed:** 2026-03-06T23:18:42Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- 9 unit tests for NBA clock parsing functions pass GREEN (Task 1)
- 16 unit tests for poll-live-logic pure helpers pass GREEN (Task 2)
- `scripts/lib/poll-live-logic.ts` created with `calculateBackoff` (exponential backoff capped at 60s), `isClippersGame`, `findClippersGame`, and `gameStatusLabel`
- Full vitest suite: 53 tests across 4 files, all passing with no regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Write nba-live-client.test.ts (RED tests)** - `339832a` (test) — also updated vitest.config.ts
2. **Task 2 RED: Write poll-live-logic.test.ts** - `2f4afb6` (test)
3. **Task 2 GREEN: Implement poll-live-logic.ts** - `7f047e1` (feat)

**Plan metadata:** (docs commit follows)

_Note: TDD tasks have two commits per feature (test RED → feat GREEN)_

## Files Created/Modified

- `scripts/lib/nba-live-client.test.ts` — 9 tests for parseNBAClock and clockToSecondsRemaining
- `scripts/lib/poll-live-logic.ts` — pure helpers: calculateBackoff, isClippersGame, findClippersGame, gameStatusLabel; exports LAC_TEAM_ID
- `scripts/lib/poll-live-logic.test.ts` — 16 tests covering all four functions and edge cases
- `vitest.config.ts` — broadened include from `insights/**` to `scripts/lib/**/*.test.ts`

## Decisions Made

- `calculateBackoff` formula: `Math.min(baseMs * Math.pow(2, failureCount), 60_000)` — failureCount=0 returns baseMs correctly because Math.pow(2,0)===1
- `LAC_TEAM_ID` exported from `poll-live-logic.ts` so Plan 04's `poll-live.ts` can import it alongside the helpers
- vitest.config.ts broadened to `scripts/lib/**/*.test.ts` — necessary for test discovery of new files outside insights/ subdirs

## Deviations from Plan

### Auto-noted observations

**1. Task 1 tests were GREEN immediately (not RED)**
- **Found during:** Task 1 verification
- **Issue:** Plan noted "tests will be RED if running Plan 02 before Plan 01" — but Plan 01 had already been executed (nba-live-client.ts and src/lib/types/live.ts existed)
- **Impact:** Tests passed GREEN immediately; commit message was updated in place; no functional impact
- **Assessment:** Favorable deviation — test foundation is already solid

---

**Total deviations:** 1 observation (no plan changes needed)
**Impact on plan:** None — all success criteria met as specified.

## Issues Encountered

None — plan executed cleanly. src/lib/types/live.ts and scripts/lib/nba-live-client.ts were already present from Plan 01.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `poll-live-logic.ts` is ready for Plan 04 to import (`calculateBackoff`, `isClippersGame`, `findClippersGame`, `LAC_TEAM_ID`)
- All Wave 0 test gaps from VALIDATION.md closed: `nba-live-client.test.ts` and `poll-live-logic.test.ts` exist and are GREEN
- LIVE-01 (game detection) and LIVE-12 (backoff/failure) have unit-verified pure-function cores

---
*Phase: 07-live-data-pipeline*
*Completed: 2026-03-06*
