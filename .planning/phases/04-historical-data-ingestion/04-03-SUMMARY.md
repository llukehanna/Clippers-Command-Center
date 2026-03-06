---
phase: 04-historical-data-ingestion
plan: 03
subsystem: database
tags: [typescript, postgres, balldontlie, etl, backfill, schedule, neon]

# Dependency graph
requires:
  - phase: 04-01
    provides: scripts directory structure, package.json with postgres + tsx, backfill npm script, DB schema applied to Neon
  - phase: 04-02
    provides: BDL API types, DB client singleton, upsertSeasons, upsertTeams, upsertPlayers, upsertGames, getCheckpoint, setCheckpoint

provides:
  - scripts/backfill.ts — resumable orchestrator seeding teams, players, and 3-season game schedule from BDL free tier
  - Neon database seeded: 30 teams, 600+ players, games for seasons 2022/2023/2024
  - Checkpoint resume via app_kv key backfill:last_completed_season
  - Box score tables (game_team_box_scores, game_player_box_scores) exist and are empty — ready for Phase 7

affects:
  - 05-advanced-stats-engine (needs teams, players, and games table)
  - 07-live-game-ingestion (box score tables ready for post-game hydration)
  - all phases requiring real NBA reference + schedule data

# Tech tracking
tech-stack:
  added: []
  patterns:
    - BDL free tier scope: teams + players + game schedule only (no box score bulk backfill)
    - Box score hydration deferred to post-game NBA live JSON pipeline (Phase 7)
    - season-level checkpoints via app_kv — backfill is resumable after interruption
    - All game statuses stored (not just Final) for schedule completeness and live game lookup

key-files:
  created:
    - scripts/backfill.ts
  modified: []

key-decisions:
  - "BDL free tier ceiling accepted — box score backfill removed from MVP scope"
  - "NBA live JSON owns live scoreboard, live box scores, and post-game finalization (Phase 7)"
  - "All game statuses stored in games table for schedule completeness (not just Final)"
  - "Box score tables retained in schema unchanged — Phase 7 populates them post-game"

patterns-established:
  - "Pattern 1: BDL free tier = reference data + schedule only; box scores require paid tier or alternative source"
  - "Pattern 2: Box score ingestion path = post-game via NBA live JSON, not bulk historical BDL"

requirements-completed: [DATA-01, DATA-04, DATA-05]

# Metrics
duration: ~24h (including checkpoint wait for backfill execution and re-scope)
completed: 2026-03-05
---

# Phase 4 Plan 03: Backfill Orchestrator Summary

**Resumable BDL backfill orchestrator (teams/players/3-season schedule) seeding Neon successfully; box scores intentionally excluded after BDL free tier ceiling hit — Phase 7 NBA live JSON owns post-game box score hydration**

## Performance

- **Duration:** ~24h (includes checkpoint wait, re-scope decision, backfill execution, and verification)
- **Started:** 2026-03-06T03:24:51Z
- **Completed:** 2026-03-06 (Task 2 verified and approved)
- **Tasks:** 2/2 complete
- **Files modified:** 1 created + 1 rewritten (re-scope)

## Accomplishments
- Backfill orchestrator written with startup banner, per-season progress logging, and final DB count summary
- Checkpoint resume logic via `app_kv.backfill:last_completed_season` — safe to interrupt and re-run
- BDL free tier scope decision crystallized: teams, players, and game schedule only; box score backfill removed
- Neon database seeded: teams (30), players (600+), games across seasons 2022, 2023, 2024 — verified by user
- Box score tables (game_team_box_scores, game_player_box_scores) correctly empty under new scope
- `sql.end()` called in both success and error paths

## Task Commits

1. **Task 1: Write backfill orchestrator (initial, with box scores)** - `ba1d858` (feat)
2. **Task 1 fix: per-page retry, 30s timeout, progress logging** - `937e785` (fix)
3. **Task 1 fix: normalize undefined API fields to null before SQL insert** - `b47077a` (fix)
4. **Re-scope: remove historical box score backfill (BDL free tier ceiling)** - `413e030` (refactor)
5. **Task 2: Human verification approved** — teams, players, games seeded in Neon; box scores = 0 (expected)

## Files Created/Modified
- `scripts/backfill.ts` — Resumable orchestrator: upsertSeasons → upsertTeams → upsertPlayers → upsertGames per season; checkpoint skip on resume; final DB count summary (teams, players, games); box score note pointing to Phase 7

## Decisions Made
- **BDL free tier ceiling accepted**: At 12s/request, fetching 3 seasons of box scores via `/stats` is infeasible in MVP timeframe. Scope narrowed to teams/players/schedule.
- **NBA live JSON owns box scores**: Post-game box score data sourced via NBA live JSON in Phase 7 (live game ingestion), not BDL bulk historical. This is the correct architectural separation.
- **All game statuses stored**: Changed from "Final only" filter to storing all game statuses (scheduled, in-progress, final). Enables live game lookup from schedule data in Phase 7.
- **Box score tables retained**: Schema unchanged — `game_team_box_scores` and `game_player_box_scores` exist and are ready for Phase 7 data.

## Deviations from Plan

### Architectural Re-scope (User Decision)

**BDL free tier ceiling — box score backfill removed from MVP**
- **Found during:** Task 2 checkpoint (pre-execution review)
- **Issue:** BDL free tier rate limits (12s/request) make fetching 3 seasons × 1230+ games of player stats infeasible. The initial orchestrator (ba1d858) supported this path but cannot complete in MVP timeframe on free tier.
- **Resolution:** User decision to narrow BDL scope. Box scores deferred to Phase 7 via NBA live JSON.
- **Files modified:** `scripts/backfill.ts` completely rewritten (commit 413e030)
- **Impact:** Must-haves from the original plan (box score counts, spot check) are obsolete. New verification: teams > 0, players > 0, games > 0. All pass.

### Auto-fixed Issues (Task 1, before re-scope)

**1. [Rule 1 - Bug] fetchAll cannot express repeated game_ids[] query params**
- **Found during:** Task 1 (writing original orchestrator)
- **Issue:** `fetchAll` accepts `Record<string, string>` — repeated keys not supported. BDL `/stats` requires `game_ids[]=123&game_ids[]=456`.
- **Fix:** `fetchStatsForBatch` helper built URL string manually. Superseded by re-scope (stats fetch removed entirely).
- **Committed in:** ba1d858 (Task 1 commit, superseded)

**2. [Rule 1 - Bug] Retry logic and timeout missing**
- **Found during:** Task 1 fix pass
- **Fix:** Added per-page retry and 30s timeout to fetchAll. Committed in 937e785.

**3. [Rule 2 - Missing Critical] Undefined API fields not normalized to null before SQL insert**
- **Found during:** Task 1 fix pass
- **Fix:** Added null normalization for optional BDL fields. Committed in b47077a.

---

**Total deviations:** 1 architectural re-scope (user-approved) + 3 auto-fixed issues
**Impact on plan:** Scope reduced from full 3-season ETL to reference + schedule only. Data pipeline for Phase 5+ unblocked with teams, players, and game schedule available.

## Issues Encountered
- The plan's verify command (`npx tsc --noEmit --strict scripts/backfill.ts`) skips the project tsconfig, causing spurious errors from library files. Used `node node_modules/typescript/bin/tsc --noEmit` with the project tsconfig instead.

## User Setup Required
`.env.local` must have `DATABASE_URL` and `BALLDONTLIE_API_KEY` set before running `npm run backfill`. Already documented in Plan 04-01.

## Next Phase Readiness
- Teams, players, and game schedule (seasons 2022–2024) live in Neon — Phase 5 can query `games` and `players`
- `game_team_box_scores` and `game_player_box_scores` tables exist and are empty — Phase 7 populates them post-game
- `app_kv` checkpoint `backfill:last_completed_season` is set — re-running `npm run backfill` is safe (idempotent)

## Self-Check: PASSED

- FOUND: scripts/backfill.ts (rewritten at 413e030)
- FOUND commit: ba1d858 (Task 1 — initial orchestrator)
- FOUND commit: 413e030 (re-scope — simplified backfill, current version)
- Neon data verified by user (Task 2 checkpoint approved): teams > 0, players > 0, games > 0; box scores = 0 (expected)

---
*Phase: 04-historical-data-ingestion*
*Completed: 2026-03-05*
