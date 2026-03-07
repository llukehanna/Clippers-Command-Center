---
phase: 12-between-games-dashboard
plan: "01"
subsystem: ui
tags: [nextjs, react, typescript, tailwind, vitest, tdd]

requires:
  - phase: 11-live-game-dashboard
    provides: InsightTileArea component pattern, BoxScoreTable, StatCard, design token conventions
  - phase: 09-api-layer
    provides: /api/home endpoint with team_snapshot, upcoming_schedule, player_trends, insights
  - phase: 10.1-design-system-refinement-for-premium-apple-like-analytics-ui
    provides: bg-surface-alt, border-white/[0.06], text-muted-foreground, text-positive design tokens

provides:
  - RSC page shell at app/home/page.tsx with parallel API fetches and teamInsights variable for Plan 02
  - TeamSnapshot component (5 stat cards: Record, Last 10, Net Rtg, Off Rtg, Def Rtg)
  - NextGameHero component (next game card with conditional odds block)
  - ScheduleTable component (BoxScoreTable wrapper with conditional odds columns)
  - home-utils lib (formatGameDate, formatGameTime, hasAnyOdds) with full test coverage
  - /api/home extended with last10_games array in team_snapshot response

affects:
  - 12-02-PLAN (builds on teamInsights variable and page shell from this plan)

tech-stack:
  added: []
  patterns:
    - RSC async page with Promise.all for parallel API fetches
    - TDD workflow (RED commit → GREEN implementation → task commit)
    - Conditional odds rendering — render block only when non-null, never empty/placeholder
    - T12:00:00 suffix on date-only strings to prevent timezone day shifts

key-files:
  created:
    - src/lib/home-utils.ts
    - src/lib/home-utils.test.ts
    - components/home/TeamSnapshot.tsx
    - components/home/NextGameHero.tsx
    - components/home/ScheduleTable.tsx
  modified:
    - app/home/page.tsx
    - src/app/api/home/route.ts

key-decisions:
  - "Import path for src/lib from components is @/src/lib/home-utils (not @/lib/home-utils) — tsconfig @/* maps to project root, src/ is a subdirectory"
  - "last10Rows query extended with JOIN to teams for abbreviations and game_date — avoids new SQL query while satisfying last10_games requirement"
  - "Last10GameRow extends GameRecordRow with game_date, home_abbr, away_abbr — minimal type extension for reused query"
  - "ScheduleTable is 'use client' because BoxScoreTable requires client boundary; TeamSnapshot and NextGameHero are Server Components"
  - "Conference_seed omitted from TeamSnapshot per locked decision (always null from API)"

patterns-established:
  - "Home components use plain divs with design token classes, not shadcn Card"
  - "Conditional odds: render only when game.odds !== null; null values within non-null odds object render as '—'"
  - "ScheduleTable returns null for empty/zero games array"

requirements-completed: [HOME-01, HOME-02, HOME-03, HOME-06, SCHED-01, SCHED-02]

duration: 3min
completed: "2026-03-07"
---

# Phase 12 Plan 01: Between-Games Dashboard Shell Summary

**RSC home page at /home with TeamSnapshot, NextGameHero, and ScheduleTable components consuming real API data, plus home-utils lib with full TDD coverage and /api/home extended with last10_games array**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-07T09:42:59Z
- **Completed:** 2026-03-07T09:45:52Z
- **Tasks:** 3 (plus TDD RED commit)
- **Files modified:** 7

## Accomplishments

- Extended /api/home response with `last10_games` array by joining team abbreviations and game_date into existing last10Rows query
- Built home-utils library (formatGameDate, formatGameTime, hasAnyOdds) with 8 unit tests all passing
- Created three home components: TeamSnapshot (5-card grid), NextGameHero (prominent hero card), ScheduleTable (BoxScoreTable wrapper)
- Assembled async RSC app/home/page.tsx with parallel fetches; teamInsights variable available for Plan 02

## Task Commits

Each task was committed atomically:

1. **RED: failing tests for home-utils** - `4939b15` (test)
2. **Task 1: home-utils lib + /api/home extension** - `e42acd5` (feat)
3. **Task 2: TeamSnapshot, NextGameHero, ScheduleTable** - `ec2dc8b` (feat)
4. **Task 3: app/home/page.tsx RSC shell** - `bf1e62b` (feat)

_Note: Task 1 used TDD — RED test commit before implementation commit._

## Files Created/Modified

- `src/lib/home-utils.ts` - formatGameDate, formatGameTime, hasAnyOdds utilities
- `src/lib/home-utils.test.ts` - 8 unit tests for all three utilities
- `components/home/TeamSnapshot.tsx` - Server Component, 5 StatCard grid (Record, Last 10, Net Rtg, Off Rtg, Def Rtg)
- `components/home/NextGameHero.tsx` - Server Component, next game hero card with conditional odds block
- `components/home/ScheduleTable.tsx` - Client Component, BoxScoreTable wrapper with conditional odds columns via hasAnyOdds
- `app/home/page.tsx` - Async RSC shell replacing stub; parallel fetches for /api/home and /api/insights
- `src/app/api/home/route.ts` - Extended last10Rows query with team joins; added last10_games to team_snapshot response

## Decisions Made

- Import path for `src/lib/home-utils` from components is `@/src/lib/home-utils` — tsconfig `@/*` maps to project root, and `home-utils.ts` lives in `src/lib/`, not `lib/`.
- Extended existing `last10Rows` query with `JOIN teams` for abbreviations and `game_date` rather than adding a new SQL query, per plan instructions.
- Defined `Last10GameRow` interface extending `GameRecordRow` to keep TypeScript types accurate without duplicating fields.
- Conference seed stat card intentionally omitted (always null from API — locked decision from plan).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed import path for home-utils in components**
- **Found during:** Task 2 (component creation) — TypeScript error TS2307
- **Issue:** Plan specified `@/lib/home-utils` but `home-utils.ts` is in `src/lib/` so the correct alias is `@/src/lib/home-utils`
- **Fix:** Updated imports in NextGameHero.tsx and ScheduleTable.tsx to use `@/src/lib/home-utils`
- **Files modified:** components/home/NextGameHero.tsx, components/home/ScheduleTable.tsx
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** ec2dc8b (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug: wrong import path in plan spec)
**Impact on plan:** Minor path correction. No scope creep. Plan otherwise executed exactly as written.

## Issues Encountered

None beyond the import path correction documented above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `teamInsights` variable is fetched and in scope in `app/home/page.tsx`, ready for Plan 02 to add `InsightTileArea` import and JSX
- `data.team_snapshot.last10_games` is typed and available for Plan 02's PointDiffChart
- All three component files are created and functioning — Plan 02 only needs to add new imports and JSX below the existing sections

## Self-Check: PASSED

All required files found on disk:
- src/lib/home-utils.ts: FOUND
- src/lib/home-utils.test.ts: FOUND
- components/home/TeamSnapshot.tsx: FOUND
- components/home/NextGameHero.tsx: FOUND
- components/home/ScheduleTable.tsx: FOUND
- app/home/page.tsx: FOUND

All task commits verified in git log:
- 4939b15 (RED tests): FOUND
- e42acd5 (Task 1): FOUND
- ec2dc8b (Task 2): FOUND
- bf1e62b (Task 3): FOUND

---
*Phase: 12-between-games-dashboard*
*Completed: 2026-03-07*
