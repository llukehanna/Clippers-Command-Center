---
phase: 07-live-data-pipeline
plan: 03
subsystem: database
tags: [balldontlie, schedule-sync, upsert, postgres, typescript]

# Dependency graph
requires:
  - phase: 07-01
    provides: BDL client (fetchAll), shared types (BDLGame), db client
  - phase: 04-01
    provides: upsertGames() in scripts/lib/upserts.ts, teams table with nba_team_id

provides:
  - scripts/sync-schedule.ts — pre-game schedule sync script keeping games table current for LAC
  - package.json npm entries — sync-schedule, poll-live, finalize-games registered for all Phase 7 scripts

affects: [07-04, 07-05, 09-live-api-route]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Runtime LAC team ID lookup — avoids hardcoding BDL team_id, derives from teams table"
    - "NBA season ID from calendar month — month < 6 (July) means prior year season"
    - "Pre-register npm scripts for future plans — avoids touching package.json in Plans 04/05"

key-files:
  created: [scripts/sync-schedule.ts]
  modified: [package.json]

key-decisions:
  - "Season ID derived from current month: month < 6 (July) = currentYear - 1, else = currentYear"
  - "LAC BDL team_id resolved from teams table at runtime, not hardcoded — safe across BDL ID changes"
  - "upsertGames status field stored as-is from BDL — 'Final', 'In Progress', or ISO datetime for scheduled"

patterns-established:
  - "sync-schedule.ts follows backfill.ts pattern: import sql/fetchAll/upsertGames, resolve IDs from DB, call fetchAll, upsert, log, sql.end()"

requirements-completed: [LIVE-01]

# Metrics
duration: 8min
completed: 2026-03-06
---

# Phase 7 Plan 03: sync-schedule Summary

**BDL schedule sync script that upserts Clippers games (last 7 days + next 30 days) into games table, plus all three Phase 7 npm entry points registered in package.json**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-06T23:21:20Z
- **Completed:** 2026-03-06T23:29:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created `scripts/sync-schedule.ts` that fetches LAC games using BDL `/games` endpoint with date window params
- Script is idempotent via `upsertGames()` ON CONFLICT upsert — safe to run multiple times
- Registered all three Phase 7 npm scripts (sync-schedule, poll-live, finalize-games) in package.json
- Plans 04 and 05 can now focus purely on script creation without touching package.json

## Task Commits

Each task was committed atomically:

1. **Task 1: Create scripts/sync-schedule.ts** - `062c836` (feat)
2. **Task 2: Register Phase 7 npm scripts in package.json** - `c13e9d1` (chore)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `scripts/sync-schedule.ts` - BDL Clippers schedule sync: fetches 7-day back / 30-day forward window, upserts via upsertGames()
- `package.json` - Added sync-schedule, poll-live, finalize-games script entries

## Decisions Made
- Season ID derived from current month: `month < 6` (0-indexed July) = prior year, else current year — handles NBA season spanning calendar years
- LAC BDL team_id looked up from teams table at runtime (not hardcoded) — robust to BDL team data changes
- `status` field stored verbatim from BDL — scheduled games arrive as ISO datetime strings, final games as "Final", live as "In Progress"; upsertGames handles this as-is

## Deviations from Plan

None - plan executed exactly as written.

The plan noted to check `upsertGames` for `start_time_utc` mapping. Confirmed: the games table has no `start_time_utc` column — `status` carries the scheduled datetime for upcoming games (ISO string from BDL). No additional mapping needed.

## Issues Encountered

TypeScript binary (`npx tsc`) has a pre-existing broken install (`Cannot find module '../lib/tsc.js'`). The plan's own verification command `npx tsc --noEmit --skipLibCheck 2>&1 | grep "sync-schedule"` returned clean (no output = no errors for sync-schedule specifically). Pre-existing issue, out of scope.

## User Setup Required

None - no external service configuration required beyond existing BALLDONTLIE_API_KEY in .env.local.

## Next Phase Readiness
- `sync-schedule` is the pre-game step before `poll-live` — run it on game nights to ensure the Clippers game exists in games table
- `poll-live` npm script is registered; Plan 04 can create `scripts/poll-live.ts` without modifying package.json
- `finalize-games` npm script is registered; Plan 05 can create `scripts/finalize-games.ts` without modifying package.json

---
*Phase: 07-live-data-pipeline*
*Completed: 2026-03-06*

## Self-Check: PASSED

- FOUND: scripts/sync-schedule.ts (committed 062c836)
- FOUND: package.json updated with 3 new scripts (committed c13e9d1)
- FOUND: 07-03-SUMMARY.md created (committed ac93fdd)
- FOUND: STATE.md updated with decisions and metrics
- FOUND: ROADMAP.md updated (phase 7: 3/5 summaries)
