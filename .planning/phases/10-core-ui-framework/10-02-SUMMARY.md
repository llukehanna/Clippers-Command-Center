---
phase: 10-core-ui-framework
plan: "02"
subsystem: ui
tags: [next.js, react, swr, tailwind, navigation, components]

# Dependency graph
requires:
  - phase: 10-01
    provides: Design tokens (CSS variables), root layout scaffold, page stubs
  - phase: 07-live-data-pipeline
    provides: MetaEnvelope type in src/lib/api-utils.ts, /api/live endpoint shape
provides:
  - TopNav sticky navigation shell (Server Component)
  - NavLinks client component with active-link detection via usePathname()
  - LiveDot client component with 30s SWR poll showing pulsing amber dot
  - StaleBanner client component — props-driven, renders on stale=true
  - useLiveData hook — typed SWR call at 12s refresh interval
  - Root layout wired to render TopNav unconditionally
affects:
  - 11-live-page
  - 12-home-page
  - 13-players-page
  - 14-schedule-page
  - 15-history-page

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Server Component shell (TopNav) imports Client Components (NavLinks) — client boundary propagates correctly
    - SWR hook per component (LiveDot 30s, useLiveData 12s) — appropriate polling intervals per use case
    - Props-driven conditional render (StaleBanner) — parent passes stale flag, component stays pure

key-files:
  created:
    - components/nav/TopNav.tsx
    - components/nav/NavLinks.tsx
    - components/nav/LiveDot.tsx
    - components/stale-banner/StaleBanner.tsx
    - hooks/useLiveData.ts
  modified:
    - app/layout.tsx

key-decisions:
  - "LiveDashboardPayload defined locally in useLiveData.ts — type was not exported from Phase 7 types file; typed meta as MetaEnvelope from src/lib/api-utils"
  - "TopNav is Server Component — NavLinks and LiveDot are 'use client'; client boundary propagates through import chain correctly"
  - "LiveDot polls /api/live at 30s interval separate from useLiveData (12s) — dot only needs course-grained live/not-live signal"

patterns-established:
  - "Server Component shell wrapping 'use client' sub-components — avoids making entire nav client-rendered"
  - "SWR polling split by consumer need — LiveDot 30s, page hooks 12s"

requirements-completed: []

# Metrics
duration: 15min
completed: 2026-03-06
---

# Phase 10 Plan 02: Navigation Shell Summary

**Sticky top nav with CCC wordmark, 5 active-link-aware links, pulsing amber LiveDot (SWR 30s), props-driven StaleBanner, and typed useLiveData hook (SWR 12s) — all wired into root layout**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-06T17:50:00Z
- **Completed:** 2026-03-06T18:05:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- TopNav Server Component shell with sticky fixed header, CCC wordmark, and NavLinks
- NavLinks client component using usePathname() for active underline (border-primary / Clippers red)
- LiveDot client component polling /api/live every 30s, renders pulsing amber dot only when source=live and stale=false
- useLiveData hook with 12s refresh interval typed to LiveDashboardPayload (MetaEnvelope-based)
- StaleBanner shows elapsed time when generatedAt is provided, hidden when stale=false
- layout.tsx updated: TopNav import uncommented and rendered before main

## Task Commits

Each task was committed atomically:

1. **Task 1: Build TopNav, NavLinks, and LiveDot components** - `c2aaf7e` (feat)
2. **Task 2: Build StaleBanner, useLiveData hook, and wire TopNav into root layout** - `6a97d44` (feat)
3. **Auto-fix: LiveDashboardPayload type** - `c01fd00` (fix)

**Plan metadata:** TBD (docs: complete plan)

## Files Created/Modified
- `components/nav/TopNav.tsx` - Server Component, sticky header with CCC wordmark and NavLinks
- `components/nav/NavLinks.tsx` - 'use client', usePathname() active state, 5 nav links with LiveDot
- `components/nav/LiveDot.tsx` - 'use client', SWR 30s poll, pulsing amber dot when isLive
- `components/stale-banner/StaleBanner.tsx` - 'use client', props-driven, shows "Data delayed" banner
- `hooks/useLiveData.ts` - 'use client', SWR 12s refresh, typed to LiveDashboardPayload
- `app/layout.tsx` - Uncommented TopNav import and render before main

## Decisions Made
- `LiveDashboardPayload` was not present in Phase 7 types file (`src/lib/types/live.ts`) — defined locally in `useLiveData.ts` with `meta: MetaEnvelope` typed from `src/lib/api-utils`
- TopNav kept as Server Component; NavLinks and LiveDot are 'use client' — client boundary propagates through import chain
- LiveDot polls at 30s (coarse grained live/not-live signal), useLiveData polls at 12s (page-level detail refresh)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed missing LiveDashboardPayload type**
- **Found during:** Task 2 (useLiveData hook implementation)
- **Issue:** TypeScript error — `Module '@/src/lib/types/live' has no exported member 'LiveDashboardPayload'`. The type was referenced in the plan but never created in Phase 7.
- **Fix:** Defined `LiveDashboardPayload` locally in `hooks/useLiveData.ts` with `meta: MetaEnvelope` imported from `@/src/lib/api-utils` (the actual type available from Phase 9 API utils).
- **Files modified:** `hooks/useLiveData.ts`
- **Verification:** `npx tsc --noEmit` passes clean; all 94 tests pass
- **Committed in:** `c01fd00` (auto-fix commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - type error / bug)
**Impact on plan:** Necessary fix for TypeScript correctness. No scope change. LiveDashboardPayload now correctly typed with MetaEnvelope for `meta.stale`, `meta.source`, `meta.generated_at` access.

## Issues Encountered
- `LiveDashboardPayload` referenced in plan does not exist in Phase 7 outputs — fixed automatically by defining locally using MetaEnvelope from Phase 9 api-utils.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Navigation shell is fully wired — all 5 pages will render with sticky TopNav after Phase 11–14 builds page content
- LiveDot will pulse automatically when /api/live returns `meta.source='live'` and `meta.stale=false`
- StaleBanner available for live page (Phase 11) to import and use with `stale={data?.meta?.stale}`
- useLiveData hook ready for live page to import and consume typed SWR data

---
*Phase: 10-core-ui-framework*
*Completed: 2026-03-06*
