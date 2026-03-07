---
phase: 09-api-layer
plan: "04"
subsystem: api
tags: [next.js, postgres, typescript, players, tdd]

# Dependency graph
requires:
  - phase: 09-01
    provides: "src/lib/db.ts (sql, LAC_NBA_TEAM_ID) and src/lib/api-utils.ts (buildMeta, buildError)"
provides:
  - "src/app/api/players/route.ts — GET /api/players roster endpoint"
  - "src/app/api/players/[player_id]/route.ts — GET /api/players/{player_id} detail endpoint"
affects:
  - "Frontend Player Trends page (Phase 10+)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-query pattern for active_only filter — separate queries instead of dynamic SQL to avoid template interpolation issues"
    - "Promise.all parallelism for player detail — trend/chart/box score queries run concurrently"
    - "ts_pct for splits computed in app layer from raw shooting stats (pts / 2*TSA) since rolling_player_stats is not used for splits"
    - "Empty arrays for missing chart data — NEVER zeroes, null only for entire objects (trend_summary/splits)"

key-files:
  created:
    - src/app/api/players/route.ts
    - src/app/api/players/[player_id]/route.ts
  modified: []

key-decisions:
  - "Two separate SQL queries for active_only (true vs false) rather than dynamic interpolation — cleaner parameterization with postgres.js template tags"
  - "rolling_player_stats uses columns points/rebounds/assists/minutes (not pts_avg/reb_avg/ast_avg/minutes_avg as plan interface spec implied) — actual DB schema is authoritative"
  - "ts_pct for splits computed in-app from raw fg/ft counts rather than queried from rolling_player_stats — splits come from game_player_box_scores, not rolling table"
  - "BoxScoreRowWithTs extends BoxScoreRow with computed ts_pct_computed field — enables splits computation without additional DB queries"

patterns-established:
  - "player detail endpoint uses Promise.all for 3 parallel queries: trend row, chart rows, box score rows"
  - "game_log entry formats FG/3PT/FT as 'made-att' strings; MIN from TEXT column as-is"

requirements-completed: [API-03, API-07]

# Metrics
duration: 3min
completed: 2026-03-07
---

# Phase 9 Plan 04: Players API Endpoints Summary

**GET /api/players roster endpoint (player_team_stints JOIN) and GET /api/players/{id} detail endpoint (trend_summary, charts as empty arrays, splits, game log)**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-07T01:05:56Z
- **Completed:** 2026-03-07T01:08:13Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created `src/app/api/players/route.ts`: GET /api/players returns LAC roster via `player_team_stints` JOIN (players table has no team_id). Default `active_only=true` filters `is_active=true`. Players sorted by `display_name ASC`. Meta source='db', ttl_seconds=3600. Cache-Control: public, max-age=3600.
- Created `src/app/api/players/[player_id]/route.ts`: GET /api/players/{id} returns full player detail. 404 with error envelope for unknown players. Parallel queries (Promise.all) for trend_summary, charts, and game log. trend_summary is null when no rolling_player_stats rows. charts.rolling_pts and charts.rolling_ts are empty arrays (never zeroes) when no rolling data. Splits computed from game_player_box_scores. Game log covers last 25 games with FG/3PT/FT formatted as "made-att".
- All tests pass: 1 passing, 11 todo (todo tests will be activated in integration phase)
- TypeScript compiles with no errors in either player route file

## Task Commits

1. **Task 1: GET /api/players roster endpoint** - `8952e65` (feat)
2. **Task 2: GET /api/players/{player_id} detail endpoint** - `8d495c1` (feat)

## Files Created/Modified

- `src/app/api/players/route.ts` — Roster endpoint with player_team_stints join, active_only filter, meta envelope
- `src/app/api/players/[player_id]/route.ts` — Detail endpoint with trend_summary, charts, splits, game_log

## Decisions Made

- Used two separate SQL queries for the `active_only` filter rather than trying to interpolate a boolean condition in one query — cleaner and avoids postgres.js template tag complexity
- DB schema column names (`points`, `rebounds`, `assists`, `minutes`) differ from the plan's interface spec (`pts_avg`, `reb_avg`, `ast_avg`, `minutes_avg`) — used actual schema column names as authoritative source
- ts_pct for splits is computed in-app from raw shooting stats (pts / (2 * (fga + 0.44 * fta))) since game_player_box_scores doesn't store ts_pct; only adds negligible compute cost
- Removed `LAC_NBA_TEAM_ID` import from the detail route since the query joins on `gpbs.team_id` directly — only roster endpoint needs the constant

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] DB schema column names differ from plan interface spec**
- **Found during:** Task 2 (reading DB_SCHEMA.sql before implementation)
- **Issue:** Plan interface spec listed `pts_avg`, `reb_avg`, `ast_avg`, `minutes_avg` for rolling_player_stats but the actual DB schema has `points`, `rebounds`, `assists`, `minutes` (no `_avg` suffix). Also `three_made`/`three_attempted` in plan vs actual `fg3_made`/`fg3_attempted` in DB schema.
- **Fix:** Used actual DB schema column names throughout the implementation
- **Files modified:** `src/app/api/players/[player_id]/route.ts`
- **Commit:** `8d495c1`

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug/mismatch between plan spec and actual DB schema)
**Impact on plan:** No scope change — same output shape delivered, correct column names used.

## Issues Encountered

None beyond the column name mismatch auto-fix.

## User Setup Required

None.

## Next Phase Readiness

- GET /api/players and GET /api/players/{id} are live
- Both routes use established patterns: sql template tags, buildMeta/buildError, parallel Promise.all
- Tests remain green; todo tests will become integration tests in later phases
