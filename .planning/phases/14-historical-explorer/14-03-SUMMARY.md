---
phase: 14-historical-explorer
plan: "03"
subsystem: ui
tags: [nextjs, react, tailwind, nba, history, schedule]

# Dependency graph
requires:
  - phase: 14-01
    provides: Season browser RSC page and /api/history/games endpoint
  - phase: 14-02
    provides: Game detail page with box score and insights
provides:
  - ScheduleTable always shows Spread/ML/O/U odds columns (shows — when unavailable)
  - /api/history/games never infers W/L from 0-stored scheduled scores
  - GameListTable shows muted SCH badge + dimmed rows for scheduled/upcoming games
  - History page shows data gap notice when season has fewer than 30 games
affects: [future schedule pages, any consumer of /api/history/games]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - isFinal status guard pattern for score/result computation at API layer
    - isScheduled derived state in table components for visual differentiation
    - Data gap notice pattern: surface missing data honestly to users

key-files:
  created: []
  modified:
    - app/api/history/games/route.ts
    - components/history/GameListTable.tsx
    - app/history/page.tsx
    - components/home/ScheduleTable.tsx

key-decisions:
  - "isFinal check uses status.includes('Final') || status.startsWith('F/') — covers NBA CDN status string formats ('Final', 'Final/OT', 'F/OT') without a brittle enum"
  - "isScheduled derived from result===null && !final_score — double guard prevents any edge case where only one field is missing from causing misclassification"
  - "SCH badge uses hairline border (border-white/[0.08]) and muted text — consistent with design system hairline aesthetic, not a filled chip"
  - "Data gap notice threshold set at <30 games — NBA regular season is 82, so anything under 30 is clearly a data-limited view"
  - "Scheduled row opacity set to 0.6 — dim but still legible, standard pattern for upcoming vs completed states"

patterns-established:
  - "Status guard pattern: always check game finality before computing scores/results, never trust score values alone"
  - "SCH badge: small uppercase badge with hairline border for scheduled/pending states — reusable pattern for future tables"

requirements-completed: [SCHED-03, SCHED-04]

# Metrics
duration: 20min
completed: 2026-03-11
---

# Phase 14 Plan 03: Historical Explorer Verification and Bug Fixes Summary

**Status guard for W/L at API layer + SCH badge with dimmed rows in game list, completing all 6 Phase 14 requirements after visual verification**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-03-11
- **Tasks:** 3 (Task 1 from prior session + 2 bug fixes from user verification)
- **Files modified:** 4

## Accomplishments

- Fixed scheduled games showing as W/L losses: API now gates result and final_score behind `isFinal` status check, preventing DB-stored 0-scores from generating false results
- Added distinct visual treatment for scheduled games: muted SCH badge with hairline border in Result column, plus opacity-60 row dimming to visually separate future from historical games
- Added honest data gap notice on `/history` page when season has fewer than 30 games (surface the data limitation rather than let users wonder)
- ScheduleTable odds columns always rendered with — when unavailable (SCHED-04, completed in Task 1)

## Task Commits

1. **Task 1: Fix ScheduleTable odds columns** - `a61bf96` (fix) — prior session
2. **Bug Fix 1: W/L result guard** - `17e3fbd` (fix)
3. **Bug Fix 2: SCH badge + data gap notice** - `ee3644a` (fix)

## Files Created/Modified

- `/Users/luke/CCC/app/api/history/games/route.ts` - Added isFinal status check; W/L and final_score only set for finalized games
- `/Users/luke/CCC/components/history/GameListTable.tsx` - isScheduled detection, opacity-60 dim on row, SCH badge in Result cell
- `/Users/luke/CCC/app/history/page.tsx` - Data gap notice when allGames.length < 30
- `/Users/luke/CCC/components/home/ScheduleTable.tsx` - Odds columns always present (prior session)

## Decisions Made

- `isFinal` uses `status.includes('Final') || status.startsWith('F/')` — covers all NBA CDN finalized status strings without a brittle enum
- `isScheduled` is derived from `result === null && !final_score` — double guard avoids misclassifying edge cases
- Data gap threshold is `< 30` (not `< 82`) — allows for partial historical imports without triggering the notice prematurely

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Scheduled games displayed as 0-0 losses (W/L from stored zero-scores)**
- **Found during:** Task 2 — visual verification by user
- **Issue:** API computed `result = lacScore > oppScore ? 'W' : 'L'` whenever scores were non-null. Scheduled games have scores stored as 0 in DB, yielding false "L" classification and `final_score: {team:0, opp:0}`
- **Fix:** Added `isFinal` guard (status contains "Final" or starts with "F/") around both `result` and `final_score` computation
- **Files modified:** `app/api/history/games/route.ts`
- **Verification:** TypeScript clean, all 142 tests pass
- **Committed in:** `17e3fbd`

**2. [Rule 1 - Bug] Scheduled games had no visual distinction from historical games**
- **Found during:** Task 2 — visual verification by user
- **Issue:** Scheduled games showed em-dash in Result column identical to "no data" state; no row-level differentiation from completed games
- **Fix:** Derive `isScheduled` from `result === null && !final_score`; apply `opacity-60` to row; render muted SCH badge with hairline border in Result cell; add data gap notice on page
- **Files modified:** `components/history/GameListTable.tsx`, `app/history/page.tsx`
- **Verification:** TypeScript clean, all tests pass
- **Committed in:** `ee3644a`

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs found during human verification)
**Impact on plan:** Both fixes necessary for correctness and UX clarity. No scope creep.

## Issues Encountered

- DB stores scheduled game scores as `0` (not NULL), which is a data modeling quirk. Fixed at the API mapping layer rather than modifying the DB schema. Pattern documented for future reference.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 6 Phase 14 requirements are now complete: HIST-01, HIST-02, HIST-03, HIST-04, SCHED-03, SCHED-04
- Phase 14 is fully closed
- Remaining data gap (21 of ~82 season games) is a Phase 4 concern (historical data ingestion), not a Phase 14 concern

---
*Phase: 14-historical-explorer*
*Completed: 2026-03-11*
