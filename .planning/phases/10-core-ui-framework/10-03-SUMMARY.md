---
phase: 10-core-ui-framework
plan: "03"
subsystem: ui
tags: [react, nextjs, recharts, shadcn, tailwind, typescript, components]

# Dependency graph
requires:
  - phase: 10-01
    provides: shadcn primitives (Card, Table, Skeleton), Tailwind design tokens, globals.css

provides:
  - StatCard: prop-driven stat display tile (label/value/delta/context) using shadcn Card
  - BoxScoreTable: 'use client' sortable table with sticky header using raw HTML table + overflow-y-auto
  - LineChartWrapper: 'use client' Recharts LineChart with ResponsiveContainer and custom dark tooltip
  - BarChartWrapper: 'use client' Recharts BarChart with ResponsiveContainer and stacked bar support
  - StatCardSkeleton: shimmer placeholder matching StatCard layout
  - BoxScoreSkeleton: table-shaped shimmer with header and 5 player rows
  - ChartSkeleton: variable-height shimmer with optional title row

affects:
  - 11-live-game-page
  - 12-home-page
  - 13-player-page
  - 14-history-page

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "'use client' on all Recharts and interactive-React components; server-safe for static display components"
    - "Custom scroll container (overflow-y-auto parent) for sticky thead — avoids shadcn Table wrapper's overflow-auto conflict"
    - "ChartSeries type exported from LineChartWrapper and re-imported by BarChartWrapper — self-contained files"
    - "formatStat handles null, large numbers (k suffix), and decimals for <10 values"

key-files:
  created:
    - components/stat-card/StatCard.tsx
    - components/skeletons/StatCardSkeleton.tsx
    - components/skeletons/BoxScoreSkeleton.tsx
    - components/skeletons/ChartSkeleton.tsx
    - components/box-score/BoxScoreTable.tsx
    - components/charts/LineChartWrapper.tsx
    - components/charts/BarChartWrapper.tsx
  modified: []

key-decisions:
  - "BoxScoreTable uses raw HTML table elements inside custom overflow-y-auto div — avoids shadcn Table wrapper's overflow-auto breaking sticky thead"
  - "formatStat and CustomTooltip duplicated in each chart file — intentional self-contained design, no shared module needed for MVP"
  - "ChartSeries type exported from LineChartWrapper, imported by BarChartWrapper — minimal coupling"

patterns-established:
  - "StatCard: server-compatible display tile — no useState, importable from RSC"
  - "BoxScoreTable: sortKey + sortDir state with useMemo for sorted rows — null-last sorting"
  - "Recharts wrappers: always 'use client' + ResponsiveContainer + custom dark tooltip"

requirements-completed: []

# Metrics
duration: 2min
completed: 2026-03-07
---

# Phase 10 Plan 03: Data Display Components Summary

**StatCard, BoxScoreTable, LineChartWrapper, BarChartWrapper and 3 skeleton loaders — 7 reusable data display components covering all dashboard page needs**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-07T01:58:01Z
- **Completed:** 2026-03-07T02:00:24Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments
- StatCard: server-compatible stat tile with label/value/delta (positive/negative color) and context string
- BoxScoreTable: sticky-header sortable table with null-last sorting, numeric right-alignment, and hover highlight
- LineChartWrapper and BarChartWrapper: Recharts wrappers with ResponsiveContainer, custom dark tooltips, formatStat
- Three skeleton loaders (StatCardSkeleton, BoxScoreSkeleton, ChartSkeleton) matching component shapes

## Task Commits

Each task was committed atomically:

1. **Task 1: StatCard and all skeleton loaders** - `5899bb4` (feat)
2. **Task 2: BoxScoreTable with sticky header and sortable columns** - `cd5b69a` (feat)
3. **Task 3: LineChartWrapper and BarChartWrapper** - `5aa1c42` (feat)

**Plan metadata:** (final commit hash — see below)

## Files Created/Modified
- `components/stat-card/StatCard.tsx` - Server-safe stat card; label/value/delta with color, context string
- `components/skeletons/StatCardSkeleton.tsx` - Shimmer matching StatCard (label row, value row, context row)
- `components/skeletons/BoxScoreSkeleton.tsx` - Table-shaped shimmer: 1 header row + 5 data rows
- `components/skeletons/ChartSkeleton.tsx` - Variable-height shimmer with optional title Skeleton
- `components/box-score/BoxScoreTable.tsx` - 'use client' sortable table, sticky thead, tabular-nums, null→"—"
- `components/charts/LineChartWrapper.tsx` - 'use client' Recharts line chart, exports ChartSeries type
- `components/charts/BarChartWrapper.tsx` - 'use client' Recharts bar chart, stacked mode, imports ChartSeries

## Decisions Made
- BoxScoreTable uses a raw `<table>` inside a custom `overflow-y-auto` div rather than shadcn's `<Table>` component; the shadcn wrapper adds its own `overflow-auto` which breaks `sticky top-0` on thead
- formatStat and CustomTooltip are intentionally duplicated in each chart file to keep files self-contained — no shared module until pages require it
- ChartSeries type lives in LineChartWrapper and is re-imported by BarChartWrapper to avoid circular imports

## Deviations from Plan

None - plan executed exactly as written. Build cache stale error on first attempt cleared by removing .next/cache; not a code issue.

## Issues Encountered
- `npm run build` failed on first attempt with stale TypeScript cache reporting a pre-existing type error in `hooks/useLiveData.ts`. Cleared `.next/cache` and rebuild succeeded. The type error was a cached artifact, not a code regression.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 7 data display components complete and build-verified
- StatCard, BoxScoreTable, LineChartWrapper, BarChartWrapper ready for composition in pages 11-14
- Skeleton loaders ready for use in Suspense boundaries and loading.tsx files
- No blockers for next phase

---
*Phase: 10-core-ui-framework*
*Completed: 2026-03-07*
