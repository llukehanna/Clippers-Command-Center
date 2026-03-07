---
phase: 11-live-game-dashboard
plan: 03
subsystem: ui
tags: [react, swr, tailwindcss, typescript, hooks, animation]

# Dependency graph
requires:
  - phase: 11-02
    provides: LiveScoreboard, KeyMetricsRow, BoxScoreModule components
  - phase: 11-01
    provides: getNextIndex, computeFtEdge, formatClock utility functions
  - phase: 10-core-ui-framework
    provides: useLiveData hook, StaleBanner, BoxScoreSkeleton, StatCardSkeleton
provides:
  - Full Live Game Dashboard assembled at app/live/page.tsx
  - useInsightRotation hook with SWR-independent 8s timer using useRef pattern
  - InsightTileArea with fixed-height h-[144px] container and opacity fade rotation
  - OtherGamesPanel — hidden entirely when games array empty
  - NoGameIdleState — premium idle state fetching /api/home for next game
affects: [phase-12, phase-13, phase-14]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - useRef for latest items without triggering timer restart (avoids SWR timer reset)
    - Fixed-height insight container prevents layout shift during rotation
    - SWR refreshInterval:0 for one-time fetch in NoGameIdleState

key-files:
  created:
    - hooks/useInsightRotation.ts
    - components/live/InsightTileArea.tsx
    - components/live/OtherGamesPanel.tsx
    - components/live/NoGameIdleState.tsx
  modified:
    - app/live/page.tsx

key-decisions:
  - "useInsightRotation omits items from useEffect deps — timer runs at fixed 8s, SWR refresh does not reset cycle"
  - "OtherGamesPanel returns null when games empty — no placeholder, no 'no games' message per locked decision"
  - "NoGameIdleState uses useSWR with refreshInterval:0 — one-time fetch for next game, no polling"
  - "InsightTileArea dot indicators only rendered when insights.length > 1"

patterns-established:
  - "useRef pattern for adopting new SWR data mid-cycle without resetting interval timer"
  - "Fixed h-[144px] absolute/inset-0 container pattern for zero layout shift animation"

requirements-completed: [LIVE-10, LIVE-11, LIVE-02, LIVE-03, LIVE-04, LIVE-05]

# Metrics
duration: 10min
completed: 2026-03-06
---

# Phase 11 Plan 03: Live Game Dashboard Summary

**Four component/hook files assembled into full Live Game Dashboard — useInsightRotation with SWR-independent 8s rotation, InsightTileArea with fixed-height opacity fade, OtherGamesPanel hidden when empty, NoGameIdleState with premium calm idle and next-game info**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-06T19:47:14Z
- **Completed:** 2026-03-06T19:48:35Z
- **Tasks:** 2 of 3 auto tasks (Task 3 is human-verify checkpoint)
- **Files modified:** 5

## Accomplishments
- useInsightRotation hook uses useRef pattern to decouple SWR refresh from rotation timer — interval runs at fixed 8s regardless of data updates
- InsightTileArea renders with fixed h-[144px] container, absolute positioning, opacity transition — zero layout shift during insight cycling
- OtherGamesPanel returns null when games is empty (no "no games" placeholder per design decision)
- NoGameIdleState is calm/editorial — heading + optional next game from /api/home + supporting line; not an error state
- app/live/page.tsx replaces Phase 10 stub with full dashboard handling all three states (LIVE, DATA_DELAYED, NO_ACTIVE_GAME)

## Task Commits

Each task was committed atomically:

1. **Task 1: useInsightRotation hook + InsightTileArea + OtherGamesPanel + NoGameIdleState** - `59eb2a5` (feat)
2. **Task 2: Assemble app/live/page.tsx — full Live Game Dashboard** - `65201d6` (feat)
3. **Task 3: Human visual verification** — PENDING (checkpoint:human-verify)

## Files Created/Modified
- `hooks/useInsightRotation.ts` - Generic rotation hook, 8s interval, useRef items pattern, getNextIndex import
- `components/live/InsightTileArea.tsx` - Fixed h-[144px] insight container with opacity fade and dot indicators
- `components/live/OtherGamesPanel.tsx` - Side rail for other NBA games; returns null when empty
- `components/live/NoGameIdleState.tsx` - Premium idle state for NO_ACTIVE_GAME with /api/home next-game fetch
- `app/live/page.tsx` - Full Live Game Dashboard — skeleton, error fallback, 3 game states, responsive grid layout

## Decisions Made
- `useInsightRotation` intentionally omits `items` from the interval `useEffect` dependency array — rotation timer is independent of SWR refresh cycle, uses `pendingItems.current` ref to read latest items when cycling
- OtherGamesPanel returns null when games empty: no empty state, no "Around the League" header with nothing below it
- NoGameIdleState uses `refreshInterval: 0` + `revalidateOnFocus: false` on its /api/home SWR call — next game data is static enough to fetch once
- Dot indicators in InsightTileArea only shown when `insights.length > 1` — single insight = no indicator clutter

## Deviations from Plan

None — plan executed exactly as written. All four files implemented per spec. TypeScript compiles clean. All 116 tests pass.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Full Live Game Dashboard assembled and TypeScript-clean
- Ready for human visual verification at /live (Task 3 checkpoint)
- After approval: Phase 12 can build on the complete dashboard foundation

---
*Phase: 11-live-game-dashboard*
*Completed: 2026-03-06*
