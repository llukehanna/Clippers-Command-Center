---
phase: 06-insight-engine
plan: "03"
subsystem: insights
tags: [postgres, window-functions, streaks, milestones, rare-events, opponent-context, league-comparisons, proof]

# Dependency graph
requires:
  - phase: 06-02
    provides: proof-utils.ts (InsightRow, makeProofHash, guardProofResult, computeImportance), db.ts sql client

provides:
  - scripts/lib/insights/streaks.ts — generateStreakInsights() (scoring_streak + hot_shooting_streak)
  - scripts/lib/insights/milestones.ts — generateMilestoneInsights() (season_points + games_played)
  - scripts/lib/insights/rare-events.ts — generateRareEventInsights() (rare_points + rare_assists)
  - scripts/lib/insights/opponent-context.ts — generateOpponentContextInsights() (opp_def_rating + h2h_record)
  - scripts/lib/insights/league-comparisons.ts — generateLeagueComparisonInsights() (clippers_off_rank + clippers_net_rank)

affects: [06-04, 09-api-layer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SQL window function rn - rn2 streak grouping — consecutive qualifying game detection without app-side iteration"
    - "PERCENT_RANK() OVER inside subquery — avoids PostgreSQL 42P10 DISTINCT + ORDER BY cast restriction"
    - "LAC team_id fetched dynamically in every module — never hardcoded"
    - "guardProofResult gates every row add — InsightRow with empty proof_result never enters results array"
    - "Ordinal suffix helper (1st/2nd/3rd/4th) inlined in opponent-context and league-comparisons"
    - "CROSS JOIN subquery for total_teams count — avoids GROUP BY complexity in rank queries"

key-files:
  created:
    - scripts/lib/insights/streaks.ts
    - scripts/lib/insights/milestones.ts
    - scripts/lib/insights/rare-events.ts
    - scripts/lib/insights/opponent-context.ts
    - scripts/lib/insights/league-comparisons.ts
  modified: []

key-decisions:
  - "Streak detection uses rn - rn2 SQL window function grouping pattern from RESEARCH.md — keeps consecutive detection in DB rather than app-side"
  - "rare-events uses subquery wrapping for PERCENT_RANK to avoid PostgreSQL 42P10 error documented in STATE.md"
  - "opponent-context queries next non-final LAC game, falls back to most recent completed game — handles both pre-game and post-game scenarios"
  - "league-comparisons only generates when Clippers rank <= 5 — filters noise, keeps insights meaningful"
  - "milestones uses highest crossed threshold per player, not all crossed thresholds — one insight per player type"

patterns-established:
  - "Pattern: Each module opens with dynamic LAC team_id lookup — SELECT team_id::text FROM teams WHERE abbreviation = 'LAC'"
  - "Pattern: guardProofResult check immediately after proof query, before constructing InsightRow"
  - "Pattern: proof_sql stored as trimmed multi-line string with $1/$2 positional placeholders"

requirements-completed: [INSIGHT-01, INSIGHT-02, INSIGHT-03, INSIGHT-04]

# Metrics
duration: 5min
completed: 2026-03-06
---

# Phase 6 Plan 03: Batch Insight Category Modules Summary

**5 batch category modules (streaks, milestones, rare-events, opponent-context, league-comparisons) — 10 insight subtypes — TypeScript clean, 28/28 tests GREEN**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-06T22:17:30Z
- **Completed:** 2026-03-06T22:22:08Z
- **Tasks:** 2
- **Files created:** 5

## Accomplishments

- Created `scripts/lib/insights/streaks.ts` exporting `generateStreakInsights()` with 2 subtypes: `scoring_streak` (20+ pts in 3+ consecutive games using rn-rn2 window function grouping) and `hot_shooting_streak` (50%+ FG with min 8 FGA in 3+ games)
- Created `scripts/lib/insights/milestones.ts` exporting `generateMilestoneInsights()` with 2 subtypes: `season_points_milestone` (500/750/1000/1250/1500/2000 thresholds, highest crossed) and `games_played_milestone` (100-1000 career game thresholds)
- Created `scripts/lib/insights/rare-events.ts` exporting `generateRareEventInsights()` with 2 subtypes: `rare_points` and `rare_assists` — both use PERCENT_RANK() inside a subquery to avoid PostgreSQL 42P10, top 5% threshold across 2022/2023/2024 seasons
- Created `scripts/lib/insights/opponent-context.ts` exporting `generateOpponentContextInsights()` with 2 subtypes: `opp_def_rating` (rolling 10-game defensive rating + ordinal league rank) and `h2h_record` (season H2H wins/losses); queries next non-final LAC game, falls back to most recent completed game
- Created `scripts/lib/insights/league-comparisons.ts` exporting `generateLeagueComparisonInsights()` with 2 subtypes: `clippers_off_rank` and `clippers_net_rank` using rolling_team_stats CROSS JOIN for total count; only generates when rank <= 5
- All 5 modules: dynamic LAC team_id lookup, guardProofResult guard before every row add, ::text fetch / ::bigint insert pattern, proof_sql with $1/$2 positional placeholders
- Full test suite: 28/28 GREEN (no regressions to proof.test.ts or live.test.ts)

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement streaks.ts and milestones.ts** - `6e4b154` (feat)
2. **Task 2: Implement rare-events.ts, opponent-context.ts, and league-comparisons.ts** - `0ac3104` (feat)

## Files Created/Modified

- `scripts/lib/insights/streaks.ts` — generateStreakInsights: scoring_streak (rn-rn2 window grouping, scope between_games/historical based on 14-day recency) + hot_shooting_streak (fg_made/fg_attempted >= 50%, min 8 FGA gate)
- `scripts/lib/insights/milestones.ts` — generateMilestoneInsights: season_points_milestone (SUM with season filter, highest crossed threshold) + games_played_milestone (COUNT across all seasons, highest crossed threshold)
- `scripts/lib/insights/rare-events.ts` — generateRareEventInsights: rare_points + rare_assists using PERCENT_RANK subquery, per-row proof query for precise proof_result, importance uses pct_rank * 100
- `scripts/lib/insights/opponent-context.ts` — generateOpponentContextInsights: opp_def_rating with league rank subquery + ordinal suffix helper + h2h_record with seasonal filter; upstream game lookup handles upcoming/completed fallback
- `scripts/lib/insights/league-comparisons.ts` — generateLeagueComparisonInsights: clippers_off_rank + clippers_net_rank using CROSS JOIN for total_teams; only emits when rank <= 5

## Decisions Made

- **Streak detection SQL:** Used the rn - rn2 window function grouping pattern from RESEARCH.md rather than application-side detection. Keeps logic in PostgreSQL where the data lives.
- **rare-events subquery:** PERCENT_RANK must be wrapped in a subquery per the Phase 05 STATE.md decision (PostgreSQL 42P10 error). The pattern is applied correctly in both rare_points and rare_assists.
- **opponent-context game target:** Module queries the next upcoming non-final game first; if none found (off-season or between game cycles), falls back to most recent completed game. This makes the module useful year-round.
- **milestones highest-threshold-only:** Each player gets at most one season points insight (highest crossed milestone) to avoid duplicate headline noise. Same for games played.
- **league-comparisons top-5 filter:** Only generates when rank <= 5 as specified in the plan — prevents "Clippers rank 28th" insights from appearing.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — these are pure TypeScript/SQL modules with no new dependencies.

## Next Phase Readiness

- All 5 category modules are ready for Plan 04 (`generate-insights.ts` orchestrator) to import and call
- Each module follows the established InsightRow contract — orchestrator can pass rows directly to upsert function
- TypeScript clean (0 errors), 28/28 unit tests GREEN

## Self-Check: PASSED

- scripts/lib/insights/streaks.ts — FOUND
- scripts/lib/insights/milestones.ts — FOUND
- scripts/lib/insights/rare-events.ts — FOUND
- scripts/lib/insights/opponent-context.ts — FOUND
- scripts/lib/insights/league-comparisons.ts — FOUND
- Commit 6e4b154 — FOUND
- Commit 0ac3104 — FOUND

---
*Phase: 06-insight-engine*
*Completed: 2026-03-06*
