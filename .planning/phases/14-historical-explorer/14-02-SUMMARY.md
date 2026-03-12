---
phase: 14-historical-explorer
plan: "02"
subsystem: ui
tags: [react, next.js, typescript, box-score, insights, history]

# Dependency graph
requires:
  - phase: 14-historical-explorer-01
    provides: History list page and API route /api/history/games/[game_id]
  - phase: 10-core-ui-framework
    provides: BoxScoreTable, InsightTileArea components
provides:
  - GameHeader component (scoreboard-style header with W/L badge)
  - HistoryGameDetail component (two-column layout: box score + insights)
  - /history/[game_id] RSC page with data fetching and notFound()
affects:
  - phase: 14-03 (history list page links to this detail page)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - RSC page fetches from API route server-side, calls notFound() on !res.ok
    - proof.summary mapped to category before passing to InsightTileArea
    - Two-column 12-grid layout (8 col box score + 4 col insights sidebar)

key-files:
  created:
    - components/history/GameHeader.tsx
    - components/history/HistoryGameDetail.tsx
    - app/history/[game_id]/page.tsx
  modified: []

key-decisions:
  - "GameHeader derives W/L from isHome flag passed by page shell — component stays pure and testable"
  - "HistoryGameDetail conditionally renders BoxScoreTable; empty state when box_score.available=false"
  - "InsightTileArea rendered only when insights.length > 0 — no empty state by design (component returns null)"
  - "proof.summary mapped to category in page shell before passing to HistoryGameDetail — keeps component interface clean"

patterns-established:
  - "History detail page: RSC server fetch + notFound() + mapped insight shape pattern"
  - "Awaiting Next.js 15 async params: const { game_id } = await params"

requirements-completed:
  - HIST-03
  - HIST-04

# Metrics
duration: 2min
completed: 2026-03-11
---

# Phase 14 Plan 02: Game Detail Page Summary

**GameHeader + HistoryGameDetail + RSC detail page at /history/[game_id] with conditional box score, insight sidebar, and W/L badge**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-11T18:30:31Z
- **Completed:** 2026-03-11T18:32:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- GameHeader renders scoreboard-style header with away/home abbreviations, scores, W/L badge, breadcrumb, and formatted date
- HistoryGameDetail renders two-column layout (always): BoxScoreTable (away + home) when available, muted empty state when not
- RSC page at /history/[game_id] fetches server-side, maps proof.summary to category for InsightTileArea, calls notFound() on bad game_id
- All 17 vitest test files pass with zero regressions (142 tests)

## Task Commits

Each task was committed atomically:

1. **Task 1: GameHeader component** - `5392b81` (feat)
2. **Task 2: HistoryGameDetail component + /history/[game_id]/page.tsx** - `b804b05` (feat)

## Files Created/Modified

- `components/history/GameHeader.tsx` - Scoreboard-style header with W/L badge and breadcrumb
- `components/history/HistoryGameDetail.tsx` - Two-column layout with BoxScoreTable and InsightTileArea
- `app/history/[game_id]/page.tsx` - RSC page: server fetch, insight mapping, notFound()

## Decisions Made

- GameHeader receives `isHome` from page shell — lets the component stay pure while the page handles LAC identity logic
- InsightTileArea not rendered when insights array is empty — InsightTileArea already returns null internally, no empty state needed
- proof.summary → category mapping done in page shell (not HistoryGameDetail) — keeps component interface clean and data mapping concerns at the boundary

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- /history/[game_id] page is fully functional; links from the history list page (Phase 14 Plan 01) will work once that page is updated
- Both HIST-03 and HIST-04 requirements are closed

---
*Phase: 14-historical-explorer*
*Completed: 2026-03-11*

## Self-Check: PASSED

- FOUND: components/history/GameHeader.tsx
- FOUND: components/history/HistoryGameDetail.tsx
- FOUND: app/history/[game_id]/page.tsx
- FOUND commit: 5392b81 (Task 1)
- FOUND commit: b804b05 (Task 2)
