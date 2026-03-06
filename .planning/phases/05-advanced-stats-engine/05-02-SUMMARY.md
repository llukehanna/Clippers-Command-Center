---
phase: 05-advanced-stats-engine
plan: 02
subsystem: database
tags: [basketball-stats, advanced-stats, rolling-windows, postgres, typescript, orchestrator]

# Dependency graph
requires:
  - phase: 05-advanced-stats-engine
    provides: scripts/lib/advanced-stats.ts formula library and seeded box score data in game_team_box_scores and game_player_box_scores

provides:
  - scripts/compute-stats.ts — Full orchestrator: reads seeded box scores, computes advanced stats, writes all four derived tables idempotently
  - scripts/lib/rolling-windows.ts — Rolling window library: computeTeamRollingWindows and computePlayerRollingWindows
  - scripts/verification-phase5.sql — SQL spot-check queries for manual validation
  - npm run compute-stats entry point in package.json

affects:
  - Phase 06+ (dashboard/API): advanced_team_game_stats and advanced_player_game_stats now populated and queryable
  - Any phase reading rolling_team_stats or rolling_player_stats for trend analysis

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Wrap SELECT DISTINCT + ORDER BY in a subquery to satisfy PostgreSQL DISTINCT constraint (ORDER BY columns must appear in select list)
    - Rolling window sliding: for index i, slice = rows[i+1-window..i+1], as_of_game_date = rows[i].game_date
    - DISTINCT queries for pair/triple deduplication wrapped in subqueries for safe ORDER BY

key-files:
  created:
    - scripts/compute-stats.ts
    - scripts/lib/rolling-windows.ts
    - scripts/verification-phase5.sql
  modified:
    - package.json

key-decisions:
  - "Rolling windows produce 0 rows when fewer games exist than the window size (2 seeded games < 5-game minimum) — correct behavior, not a bug"
  - "Player rolling windows query joins advanced_player_game_stats + games + game_player_box_scores to get raw pts/reb/ast/min alongside advanced ts_pct/efg_pct"
  - "computeGameStats handles steps 1 and 2 together per game to reuse fetched team boxes for player context"

patterns-established:
  - "Orchestrator fetches eligible games first (EXISTS in game_team_box_scores), then processes in dependency order: team advanced -> player advanced -> team rolling -> player rolling"
  - "All four derived tables use ON CONFLICT DO UPDATE — full idempotency on repeated runs"
  - "Rolling window library uses singleton sql import from db.js rather than accepting sql as a parameter, matching upserts.ts pattern"

requirements-completed: [DATA-02, DATA-03]

# Metrics
duration: 20min
completed: 2026-03-06
---

# Phase 5 Plan 02: Compute-Stats Orchestrator Summary

**Dean Oliver advanced stats (eFG%, pace, off/def/net rating, TS%, TOV%, reb%) computed and stored for all seeded Clippers games via `npm run compute-stats` — 4 team rows and 42 player rows populated, fully idempotent**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-03-06T17:40:00Z
- **Completed:** 2026-03-06T18:00:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Created compute-stats.ts orchestrator that processes all 4 derived tables in correct dependency order (team advanced -> player advanced -> team rolling -> player rolling)
- Created rolling-windows.ts library with sliding window computation over advanced stats rows, upserted into rolling_team_stats and rolling_player_stats
- Verified idempotency: two successive runs produce identical row counts (4 advanced team, 42 advanced player, 0 rolling — 0 rolling is correct with only 2 seeded games vs 5-game minimum window)
- eFG% values validated: LAC vs MIA game shows 0.5882, LAC vs PHX shows 0.6250 — consistent with Basketball-Reference data

## Task Commits

Each task was committed atomically:

1. **Task 1: Rolling windows library** - `4b25bf4` (feat)
2. **Task 2: Compute-stats orchestrator, verification SQL, and package.json registration** - `b95233e` (feat)

## Files Created/Modified

- `scripts/compute-stats.ts` - Main orchestrator: queries games with box scores, computes team/player advanced stats per game, calls rolling window functions, prints summary counts
- `scripts/lib/rolling-windows.ts` - computeTeamRollingWindows and computePlayerRollingWindows: fetch advanced stats rows, slide 5/10 game windows, upsert averages to rolling tables
- `scripts/verification-phase5.sql` - 6 spot-check queries for row counts, Clippers advanced stats, window size verification, and top-player rolling stats
- `package.json` - Added `compute-stats` script entry following backfill pattern

## Decisions Made

- Rolling windows correctly yield 0 rows when seeded game count (2) is below the minimum window size (5) — this is the expected behavior per plan spec, not a defect
- Wrapped all `SELECT DISTINCT ... ORDER BY` queries in subqueries to handle PostgreSQL's requirement that ORDER BY expressions appear in the DISTINCT select list when using column expressions with casts (e.g., `game_id::text`)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed DISTINCT + ORDER BY SQL error on all three game/team/player fetch queries**
- **Found during:** Task 2 (Compute-stats orchestrator)
- **Issue:** PostgreSQL rejects `SELECT DISTINCT col::text ORDER BY col` because the ORDER BY expression (`col`) doesn't match the select list expression (`col::text`). Error code 42P10.
- **Fix:** Wrapped all three affected queries (`gamesWithBoxScores`, `teamPairs`, `playerTriples`) in a subquery layer: `SELECT ... FROM (SELECT DISTINCT col::text AS col ...) sub ORDER BY col`
- **Files modified:** scripts/compute-stats.ts
- **Verification:** Script runs to completion with zero errors after fix
- **Committed in:** b95233e (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 SQL bug)
**Impact on plan:** Fix was necessary for correct operation. No scope creep.

## Issues Encountered

- PostgreSQL 42P10 error on DISTINCT + ORDER BY with cast expressions — required subquery wrapping. Standard PostgreSQL constraint, not a postgres.js issue.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- advanced_team_game_stats: 4 rows with real efg_pct, ts_pct, pace, off_rating, def_rating, net_rating values
- advanced_player_game_stats: 42 rows with real usage_rate, efg_pct, ts_pct, ast_rate, reb_rate, tov_rate values
- rolling_team_stats and rolling_player_stats: 0 rows (correct — 2 seeded games < 5-game window minimum); will populate as more box score data arrives via Phase 7 live JSON pipeline
- DATA-02 and DATA-03 requirements satisfied: advanced stats computed and stored; rolling windows computed (with expected 0 rows given limited seed data)
- `npm run compute-stats` exits 0, prints correct summary, fully idempotent

## Self-Check: PASSED

- scripts/compute-stats.ts: FOUND
- scripts/lib/rolling-windows.ts: FOUND
- scripts/verification-phase5.sql: FOUND
- 05-02-SUMMARY.md: FOUND
- Commit 4b25bf4 (rolling-windows library): FOUND
- Commit b95233e (compute-stats orchestrator): FOUND

---
*Phase: 05-advanced-stats-engine*
*Completed: 2026-03-06*
