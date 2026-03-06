---
phase: 05-advanced-stats-engine
plan: 01
subsystem: database
tags: [basketball-stats, advanced-stats, seed-data, pure-functions, postgres, typescript]

# Dependency graph
requires:
  - phase: 04-historical-data-ingestion
    provides: games, teams, players tables populated with BDL backfill data

provides:
  - scripts/seed-test-games.ts — hardcoded box score fixture for 2 real Clippers games seeded into game_team_box_scores and game_player_box_scores
  - scripts/lib/advanced-stats.ts — pure formula functions for all Dean Oliver / Basketball-Reference advanced stat calculations

affects:
  - 05-02 (compute-stats.ts imports advanced-stats.ts formulas and reads from seeded box score tables)
  - 05-advanced-stats-engine (validation fixture for all Phase 5 plans)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Dynamic ID resolution from nba_game_id/nba_team_id/nba_player_id via text-cast SELECT before INSERT
    - ON CONFLICT DO UPDATE on (game_id, team_id) and (game_id, player_id) unique constraints for idempotent box score seeding
    - Pure formula module with zero-denominator guards — no DB imports, all functions take plain numbers

key-files:
  created:
    - scripts/seed-test-games.ts
    - scripts/lib/advanced-stats.ts
  modified: []

key-decisions:
  - "Selected LAC vs MIA (2024-01-01, 121-104) and LAC vs PHX (2024-01-08, 138-111) as seed games — both regulation wins with clean box scores, nba_game_ids confirmed in games table"
  - "DNP and inactive players seeded with 0:00 minutes and zeros — included to ensure all key players have rows rather than resolving only starters"
  - "Formula library has zero DB dependency — pure functions enable isolated unit verification and future test coverage without DB setup"

patterns-established:
  - "Seed scripts use resolveGameId/resolveTeamId/resolvePlayerId helpers to translate nba_ IDs to internal bigint IDs before INSERT"
  - "All box score upserts: ON CONFLICT (game_id, team_id) DO UPDATE and ON CONFLICT (game_id, player_id) DO UPDATE with full column update list"
  - "Advanced stat formulas guard every division with if (denom === 0) return 0 — no NaN propagation"

requirements-completed: [DATA-02]

# Metrics
duration: 25min
completed: 2026-03-06
---

# Phase 5 Plan 01: Advanced Stats Foundation Summary

**Box score seed fixture (4 team rows, 42 player rows) and pure Dean Oliver formula library for Advanced Stats Engine validation**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-03-06T08:00:00Z
- **Completed:** 2026-03-06T08:25:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Seeded 2 real regulation Clippers games into game_team_box_scores (4 rows) and game_player_box_scores (42 rows) with real Basketball-Reference statistics
- Created pure formula library with 11 exported functions implementing Dean Oliver / Basketball-Reference advanced stat formulas, all with zero-denominator guards
- Verified idempotency: re-running seed produces identical row counts, ON CONFLICT DO UPDATE works correctly on both unique constraints
- Verified formula correctness: computeEfgPct(40, 12, 85) = 0.5412 (expected ~0.541), parseMinutes("34:21") = 34.35

## Task Commits

Each task was committed atomically:

1. **Task 1: Seed script — hardcoded box scores for 2 real Clippers games** - `b433ba0` (feat)
2. **Task 2: Formula library — pure advanced stat functions** - `5ac2eb4` (feat)

## Files Created/Modified

- `scripts/seed-test-games.ts` - Idempotent seed utility inserting real Clippers box scores (LAC-MIA 2024-01-01, LAC-PHX 2024-01-08) into game_team_box_scores and game_player_box_scores
- `scripts/lib/advanced-stats.ts` - Pure formula module: computeTeamPossessions, computePace, computeOffRating, computeEfgPct, computeTsPct, computeTovPct, computeRebPct, computeUsageRate, computeAstRate, computeRebRate, parseMinutes

## Decisions Made

- Selected LAC vs MIA (2024-01-01, 121-104) and LAC vs PHX (2024-01-08, 138-111) as seed games — both regulation wins at LAC home court, nba_game_ids confirmed present in games table via DB query
- DNP players seeded with "00:00" minutes and zero stats — ensures all key players have rows for idempotency without requiring knowledge of who actually played
- Formula library deliberately has zero DB imports — pure functions on plain numbers enable isolated verification without DB setup and match plan intent

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- tsx `--eval` with top-level await is not supported in CJS mode but works for ESM eval — used `--input-type=module` approach was avoided; the `--eval` flag with tsx works correctly for single-expression imports as specified in the plan verification command.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- game_team_box_scores has 4 rows (2 games × 2 teams) with real values
- game_player_box_scores has 42 rows with real minutes ("MM:SS") and stat columns
- scripts/lib/advanced-stats.ts exports all formula functions, ready for import in compute-stats.ts (Plan 02)
- Plan 02 (compute-stats.ts) can now run against seeded data to produce advanced_team_game_stats and advanced_player_game_stats rows

---
*Phase: 05-advanced-stats-engine*
*Completed: 2026-03-06*
