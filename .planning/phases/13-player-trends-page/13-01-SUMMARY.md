---
phase: 13-player-trends-page
plan: 01
subsystem: api
tags: [player-trends, rolling-averages, typescript, vitest, tdd, next.js]

# Dependency graph
requires:
  - phase: 09-api-layer
    provides: /api/players and /api/players/[player_id] base routes
  - phase: 05-advanced-stats-engine
    provides: rolling_player_stats table with window_games, points, rebounds, assists, ts_pct columns
provides:
  - Pure derivation utility library (deriveAverages, l5ColorClass, mergeChartSeries, computeSeasonAverages)
  - Extended /api/players with include_traded=true mode returning current-season LAC players with is_traded boolean
  - Extended /api/players/[player_id] with 8-key charts object split by l5/l10, season_averages, and ts_pct_computed on game_log rows
affects:
  - 13-player-trends-page plans 02 and 03 (Wave 2 roster and detail UI pages depend on these contracts)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - TDD RED/GREEN with vitest for pure utility functions
    - Season start date derivation: month < 6 → prior year Oct 1, else current year Oct 1
    - chartRows split by window_games filter before mapping (l5/l10 split pattern)
    - avg() helper function nested inside route handler for local reuse

key-files:
  created:
    - src/lib/player-utils.ts
    - src/lib/player-utils.test.ts
  modified:
    - app/api/players/route.ts
    - app/api/players/[player_id]/route.ts

key-decisions:
  - "charts object shape is a breaking change — replaces rolling_pts/rolling_ts with 8 split keys (rolling_{pts,ts,reb,ast}_{l5,l10})"
  - "include_traded branch filters by pts.start_date >= seasonStart to limit to current season only"
  - "deriveAverages empty input returns object with null fields (not null itself) — consistent shape for consumers"
  - "computeSeasonAverages returns null on empty input — different from deriveAverages, more appropriate for standalone season context"
  - "season_averages in player detail derived from boxScoreRowsWithTs (last 25 games limit from SQL) — labeled accordingly for UI"

patterns-established:
  - "Split chartRows by window_games before mapping for l5/l10 chart series"
  - "Season start date: month < 6 = prior year Oct 1, else current year Oct 1"

requirements-completed: [PLAYER-01, PLAYER-02, PLAYER-03, PLAYER-04]

# Metrics
duration: 3min
completed: 2026-03-07
---

# Phase 13 Plan 01: Player Trends Data Contracts Summary

**Extended player API routes with split l5/l10 chart series, season averages, traded player mode, and a TDD-verified pure utility library for client-side derivation**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-07T20:41:18Z
- **Completed:** 2026-03-07T20:43:47Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Created `src/lib/player-utils.ts` with 4 exported functions covering all player-trend derivation logic, backed by 11 vitest tests (all green)
- Extended `/api/players` with `include_traded=true` branch returning current-season LAC players with `is_traded` boolean field
- Replaced flat charts object in `/api/players/[player_id]` with 8-key split structure covering PTS/REB/AST/TS% at both L5 and L10 windows, plus added `season_averages` and `ts_pct_computed` to game_log rows

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: failing tests for player-utils** - `dd6f935` (test)
2. **Task 1 GREEN: implement player-utils.ts** - `2258b87` (feat)
3. **Task 2: extend /api/players with include_traded** - `8b7dd3a` (feat)
4. **Task 3: extend /api/players/[player_id] with reb/ast charts, season_averages** - `51e0962` (feat)

**Plan metadata:** (pending — docs commit)

_Note: TDD task produced two commits (test RED → feat GREEN)_

## Files Created/Modified
- `/Users/luke/CCC/src/lib/player-utils.ts` - Pure derivation utilities: deriveAverages, l5ColorClass, mergeChartSeries, computeSeasonAverages
- `/Users/luke/CCC/src/lib/player-utils.test.ts` - 11 vitest unit tests covering all four utilities
- `/Users/luke/CCC/app/api/players/route.ts` - Added include_traded=true query branch with season-scoped SQL
- `/Users/luke/CCC/app/api/players/[player_id]/route.ts` - Split charts to 8 l5/l10 keys, added season_averages, added ts_pct_computed to game_log

## Decisions Made
- `charts` object shape is a breaking change — replaces flat `rolling_pts`/`rolling_ts` with 8 split keys (`rolling_{pts,ts,reb,ast}_{l5,l10}`). Plans 02 and 03 use the new shape.
- `include_traded` branch adds `pts.start_date >= seasonStart` to filter to current season, preventing older LAC stints from surfacing.
- `deriveAverages` returns an object with null fields on empty input (not a null itself) so consumers always get the same shape.
- `season_averages` in the player detail route is scoped to the last 25 box score rows (SQL LIMIT 25) — noted for UI labeling.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All data contracts from this plan (Wave 1) are established and TypeScript-verified
- Plans 02 (roster page) and 03 (player detail page) can now run in parallel (Wave 2)
- `mergeChartSeries` in player-utils is ready for the chart metric selector in Plan 03
- `l5ColorClass` is ready for the rolling averages comparison table color coding in Plan 03

## Self-Check: PASSED

All files verified:
- FOUND: src/lib/player-utils.ts
- FOUND: src/lib/player-utils.test.ts
- FOUND: app/api/players/route.ts
- FOUND: app/api/players/[player_id]/route.ts

All commits verified:
- dd6f935 test(13-01): add failing tests for player derivation utilities
- 2258b87 feat(13-01): implement player derivation utilities
- 8b7dd3a feat(13-01): extend /api/players with include_traded query mode
- 51e0962 feat(13-01): extend /api/players/[player_id] with rolling_reb, rolling_ast, season_averages

---
*Phase: 13-player-trends-page*
*Completed: 2026-03-07*
