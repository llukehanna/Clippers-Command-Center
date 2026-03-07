---
phase: 09-api-layer
plan: "05"
subsystem: api
tags: [next.js, postgres, typescript, rest-api, cursor-pagination, odds]

# Dependency graph
requires:
  - phase: 09-api-layer
    plan: "01"
    provides: "src/lib/db.ts (sql, LAC_NBA_TEAM_ID), src/lib/api-utils.ts (buildMeta, buildError), src/lib/odds.ts (getLatestOdds)"
provides:
  - "GET /api/schedule — upcoming LAC games with parallel odds fetch via getLatestOdds()"
  - "GET /api/history/seasons — distinct season_ids with label mapping (e.g. 2024-25)"
  - "GET /api/history/games — cursor-paginated LAC game list per season_id"
  - "GET /api/history/games/{game_id} — game detail with box_score availability flag and insights from insights table"
affects:
  - "09-06 (insights plan) — history/games/{id} insights shape established here"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "cursor pagination: base64(JSON({game_date, game_id})) — opaque cursor for (date, id) DESC ordering"
    - "box_score availability flag: COUNT(*) from game_player_box_scores; available:false for pre-Phase-7 games"
    - "parallel odds fetch: Promise.all([getLatestOdds(id), ...]) for all upcoming games"
    - "runtime LAC team_id lookup: SELECT team_id FROM teams WHERE nba_team_id = LAC_NBA_TEAM_ID"
    - "insights always queried from `insights` table (never `generated_insights`)"

key-files:
  created:
    - src/app/api/schedule/route.ts
    - src/app/api/history/seasons/route.ts
    - src/app/api/history/games/route.ts
    - src/app/api/history/games/[game_id]/route.ts
  modified: []

key-decisions:
  - "odds:null when no snapshot — never fabricate; meta.source='mixed' only when at least one game has odds"
  - "result filter applied post-SQL for simplicity — avoids complex conditional SQL for W/L derivation"
  - "game detail insights queried from `insights` table (not `generated_insights`) per RESEARCH.md pitfall 3"

requirements-completed: [API-04, API-05, API-07]

# Metrics
duration: 4min
completed: 2026-03-07
---

# Phase 9 Plan 05: Schedule and History Endpoints Summary

**Schedule + seasons + history endpoints: 4 route handlers covering GET /api/schedule, GET /api/history/seasons, GET /api/history/games, and GET /api/history/games/{game_id} with cursor pagination, odds integration, box score availability flag, and insights from the insights table**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-07T01:05:50Z
- **Completed:** 2026-03-07T01:09:28Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Created `src/app/api/schedule/route.ts`: resolves LAC internal team_id at runtime, queries upcoming games (game_date >= today, status != 'final'), fetches odds in parallel via `getLatestOdds()`, returns `next_game` + `games[]` with Cache-Control 1800s. meta.source='mixed' when any odds present, 'db' when none.
- Created `src/app/api/history/seasons/route.ts`: queries DISTINCT season_id from games table (no hardcoding), maps to `{season_id, label}` pairs where label format is "YYYY-YY" (2024 → "2024-25"). Cache-Control 86400s.
- Created `src/app/api/history/games/route.ts`: cursor-based pagination (base64 JSON {game_date, game_id}), requires season_id (400 without), default limit=82 capped at 200, home_away and result filter params, each game item has opponent_abbr/home_away/result(W|L)/final_score.
- Created `src/app/api/history/games/[game_id]/route.ts`: 404 on unknown game_id, checks game_player_box_scores row count → available:true/false, full player box score with 11-column header when available, empty teams with {} totals when not. Insights queried from `insights` table WHERE game_id=id AND is_active=true ORDER BY importance DESC.

## Task Commits

Each task was committed atomically:

1. **Task 1: schedule route + seasons route** — `903700e` (feat)
2. **Task 2: history/games list + history/games/{game_id} detail** — `1628ce4` (feat)

## Files Created/Modified

- `src/app/api/schedule/route.ts` — GET /api/schedule handler with parallel odds fetch
- `src/app/api/history/seasons/route.ts` — GET /api/history/seasons handler
- `src/app/api/history/games/route.ts` — GET /api/history/games handler with cursor pagination
- `src/app/api/history/games/[game_id]/route.ts` — GET /api/history/games/{game_id} detail handler

## Decisions Made

- **odds:null when no snapshot** — `getLatestOdds()` returns null for games with no odds snapshot within 24h; we never fabricate values. meta.source toggles to 'mixed' only when at least one game has live odds.
- **result filter post-SQL** — the W/L result is derived from score columns after fetch (not computable purely in SQL without complex CASE expressions). Applied as a `.filter()` after mapping, which is correct for the small result set (max 82 games).
- **insights from `insights` table** — RESEARCH.md pitfall 3 explicitly warns that CONTEXT.md used the wrong name `generated_insights`; actual DB table is `insights`. Implemented correctly.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

Pre-existing TypeScript errors in `src/app/api/home/route.ts` (from plan 09-03) were discovered during tsc run. These are out of scope for this plan and were not modified. The new files in this plan have zero TypeScript errors.

## User Setup Required

None — no external service configuration required for these routes. The routes require DATABASE_URL (already in .env.local) and optionally ODDS_API_KEY for odds data.

## Next Phase Readiness

- Schedule endpoint ready for Plan 10 (Schedule page UI)
- History endpoints (seasons, games list, game detail) ready for Plan 12 (Historical Explorer UI)
- Box score availability flag allows UI to render "Box score not available" gracefully
- Cursor pagination implemented — frontend can page through season game history

---
*Phase: 09-api-layer*
*Completed: 2026-03-07*

## Self-Check: PASSED

Files confirmed present:
- FOUND: src/app/api/schedule/route.ts
- FOUND: src/app/api/history/seasons/route.ts
- FOUND: src/app/api/history/games/route.ts
- FOUND: src/app/api/history/games/[game_id]/route.ts

Commits confirmed:
- FOUND: 903700e (Task 1)
- FOUND: 1628ce4 (Task 2)
