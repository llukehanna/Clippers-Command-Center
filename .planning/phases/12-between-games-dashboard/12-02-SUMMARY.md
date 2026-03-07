---
phase: 12-between-games-dashboard
plan: "02"
subsystem: ui
tags: [nextjs, react, typescript, tailwind, recharts, vitest]

requires:
  - phase: 12-between-games-dashboard/12-01
    provides: app/home/page.tsx shell with TeamSnapshot, NextGameHero, ScheduleTable, teamInsights variable, and last10_games typed in /api/home response
  - phase: 11-live-game-dashboard
    provides: InsightTileArea component with auto-hide-when-empty behavior and className height override
  - phase: 10.1-design-system-refinement-for-premium-apple-like-analytics-ui
    provides: design tokens (bg-surface, bg-surface-alt, text-positive, text-negative, var(--chart-2), var(--chart-4), border-white/[0.06])

provides:
  - PlayerTrendsTable component (6-column table: Player link, PPG, RPG, APG, TS%=always-dash, L5 Δ=always-dash)
  - PointDiffChart component (Recharts BarChart with Cell per-bar coloring: emerald wins, red losses)
  - Complete Between-Games Dashboard at /home with all five sections assembled
  - Awaiting human visual verification (checkpoint:human-verify — Task 3)

affects:
  - Future phases building on /home page or home component patterns

tech-stack:
  added: []
  patterns:
    - Custom Recharts tooltip interface (PointDiffTooltipProps) instead of TooltipProps generic — avoids Recharts type gap, consistent with BarChartWrapper pattern
    - Direct recharts Cell import for per-bar coloring (approved deviation from BarChartWrapper wrapper)
    - Conditional section rendering via teamInsights.length > 0 guard before InsightTileArea

key-files:
  created:
    - components/home/PlayerTrendsTable.tsx
    - components/home/PointDiffChart.tsx
  modified:
    - app/home/page.tsx

key-decisions:
  - "PointDiffChart uses direct recharts imports with Cell (not BarChartWrapper) — BarChartWrapper lacks per-bar Cell coloring support; approved deviation per plan spec"
  - "PointDiffTooltipProps custom interface instead of TooltipProps<number,string> — Recharts type does not expose payload as destructured prop; matches BarChartWrapper pattern already established"
  - "InsightTileArea wrapped in teamInsights.length > 0 check at page level — belt-and-suspenders alongside component's own null return"

patterns-established:
  - "Custom Recharts tooltip: define interface with active?: boolean, payload?: Array<{value: T, payload: DataType}> — avoids TooltipProps generic type gap"
  - "Player trends columns TS% and L5 Δ: always render '—' with text-muted-foreground — honest null display per never-fabricate rule"

requirements-completed: [HOME-04, HOME-05]

duration: 1min
completed: "2026-03-07"
---

# Phase 12 Plan 02: Between-Games Dashboard Lower Sections Summary

**PlayerTrendsTable and PointDiffChart components built and wired into /home page; all five dashboard sections assembled — awaiting human visual verification at checkpoint Task 3**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-07T09:48:15Z
- **Completed:** 2026-03-07T09:49:35Z
- **Tasks:** 2 of 3 complete (Task 3 is checkpoint:human-verify)
- **Files modified:** 3

## Accomplishments

- Built PlayerTrendsTable with 6-column layout matching BoxScoreTable CSS aesthetics; player names link to /players/{id}; TS% and L5 Δ columns always render "—" (honest null display)
- Built PointDiffChart with custom Recharts BarChart using Cell per-bar coloring (emerald for wins via var(--chart-2), red for losses via var(--chart-4)); custom tooltip with opponent label and signed margin
- Assembled complete /home page: TeamSnapshot → NextGameHero+ScheduleTable → PlayerTrendsTable → InsightTileArea → PointDiffChart; npx tsc --noEmit zero errors, 124/124 vitest tests green

## Task Commits

Each task was committed atomically:

1. **Task 1: PlayerTrendsTable and PointDiffChart components** - `8ca176d` (feat)
2. **Task 2: Complete app/home/page.tsx — add all remaining sections** - `37eafd7` (feat)
3. **Task 3: Visual verification** — PENDING (checkpoint:human-verify)

## Files Created/Modified

- `components/home/PlayerTrendsTable.tsx` - 'use client', 6-column table with linked player names; TS% and L5 Δ always "—"
- `components/home/PointDiffChart.tsx` - 'use client', Recharts BarChart with Cell per-bar coloring; custom tooltip
- `app/home/page.tsx` - Full page with all five sections; imports PlayerTrendsTable, InsightTileArea, PointDiffChart added

## Decisions Made

- Used custom `PointDiffTooltipProps` interface instead of `TooltipProps<number, string>` from Recharts — the generic version doesn't properly expose `payload` for destructuring in this Recharts version; matches the existing BarChartWrapper pattern.
- Used direct recharts imports (BarChart, Bar, Cell) rather than BarChartWrapper — per plan spec and user approval: BarChartWrapper doesn't support per-bar Cell coloring.
- InsightTileArea guarded with `teamInsights.length > 0` at page level in addition to component's own null return — belt-and-suspenders for clean DOM.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Recharts TooltipProps type incompatibility**
- **Found during:** Task 2 (TypeScript check after page assembly) — error TS2339
- **Issue:** `TooltipProps<number, string>` from Recharts does not expose `payload` as a destructured prop in the version installed; plan spec used this type directly
- **Fix:** Replaced with custom `PointDiffTooltipProps` interface matching `{ active?: boolean; payload?: Array<{value: number; payload: ChartEntry}> }` — identical pattern to BarChartWrapper.tsx
- **Files modified:** components/home/PointDiffChart.tsx
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** 37eafd7 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug: Recharts type incompatibility)
**Impact on plan:** Minor type correction. No scope creep. Component behavior identical to plan spec.

## Issues Encountered

None beyond the TooltipProps type fix documented above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All five sections assembled at /home; full TypeScript and test verification clean
- Human visual verification (Task 3 checkpoint) pending — user must open http://localhost:3000/home and approve
- After approval, plan is complete and HOME-04, HOME-05 requirements are satisfied
- Plan 03 (if any) can proceed once checkpoint approved

## Self-Check: PASSED

Files found on disk:
- components/home/PlayerTrendsTable.tsx: FOUND
- components/home/PointDiffChart.tsx: FOUND
- app/home/page.tsx: FOUND (modified)

Task commits verified:
- 8ca176d (Task 1): FOUND
- 37eafd7 (Task 2): FOUND

---
*Phase: 12-between-games-dashboard*
*Completed: 2026-03-07*
