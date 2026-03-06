---
phase: 06-insight-engine
plan: 04
subsystem: database
tags: [postgres, typescript, insights, nodejs, batch]

# Dependency graph
requires:
  - phase: 06-03
    provides: five batch insight category modules (streaks, milestones, rare-events, opponent-context, league-comparisons)
  - phase: 06-01
    provides: insights table schema with uq_insights_proof_hash partial unique index
provides:
  - "npm run generate-insights orchestrator that calls all 5 batch category modules"
  - "Idempotent upsert into insights table via ON CONFLICT (proof_hash) WHERE proof_hash IS NOT NULL"
  - "scripts/verification-phase6.sql with 7 spot-check queries"
  - "All 5 INSIGHT requirements satisfied"
affects: [07-live-game-integration, 09-insight-api]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Insight orchestrator pattern mirrors compute-stats.ts: step-by-step loop with progress stdout"
    - "ON CONFLICT on partial unique index requires explicit WHERE predicate in upsert clause"
    - "Clippers player filter via EXISTS on game_player_box_scores.team_id (players table has no team_id)"
    - "Scalar subquery rewrite to avoid GROUP BY error with CROSS JOIN aggregate"

key-files:
  created:
    - scripts/generate-insights.ts
    - scripts/verification-phase6.sql
  modified:
    - package.json
    - scripts/lib/insights/streaks.ts
    - scripts/lib/insights/milestones.ts
    - scripts/lib/insights/rare-events.ts
    - scripts/lib/insights/opponent-context.ts
    - scripts/lib/insights/league-comparisons.ts

key-decisions:
  - "ON CONFLICT partial index requires WHERE proof_hash IS NOT NULL predicate in upsert — must match index definition exactly"
  - "players table has no team_id — Clippers player filter uses EXISTS on game_player_box_scores.team_id"
  - "rolling_team_stats uses window_games (not window_size) and off_rating/def_rating/net_rating (not avg_* prefixed)"
  - "teams table has no full_name column — use (city || ' ' || name) concatenation"
  - "0-count categories acceptable for sparse seed data — script exits 0 regardless"

patterns-established:
  - "Insight orchestrator: iterate steps[], call fn(), upsert each row, log count"
  - "Idempotent upsert: ON CONFLICT (proof_hash) WHERE proof_hash IS NOT NULL DO UPDATE SET"

requirements-completed: [INSIGHT-01, INSIGHT-02, INSIGHT-03, INSIGHT-04, INSIGHT-05]

# Metrics
duration: 4min
completed: 2026-03-06
---

# Phase 6 Plan 04: Insight Engine Orchestrator Summary

**npm run generate-insights orchestrator wiring all 5 batch insight modules into the insights table with proof_hash deduplication and idempotent upserts**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-06T22:24:27Z
- **Completed:** 2026-03-06T22:29:00Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Working `npm run generate-insights` command that calls all 5 category modules in sequence
- Idempotent upsert via ON CONFLICT (proof_hash) WHERE proof_hash IS NOT NULL — verified with second run producing identical counts
- 5 insights stored on first run (3 rare events, 2 league comparisons; 0-count categories acceptable for sparse seed data)
- 28 tests GREEN (proof.test.ts + live.test.ts via Vitest)
- scripts/verification-phase6.sql with 7 spot-check queries for manual phase verification

## Task Commits

Each task was committed atomically:

1. **Task 1: Create generate-insights.ts orchestrator with upsert loop and npm script** - `6be3348` (feat)
2. **Task 2: Write verification SQL and run full test suite** - `a48d03f` (feat)

## Files Created/Modified

- `scripts/generate-insights.ts` - Orchestrator calling all 5 batch modules, upsert loop, summary output
- `scripts/verification-phase6.sql` - 7 spot-check SQL queries for manual phase verification
- `package.json` - Added "generate-insights" npm script
- `scripts/lib/insights/streaks.ts` - Fixed p.team_id -> pb.team_id; DISTINCT+ORDER BY subquery wrap
- `scripts/lib/insights/milestones.ts` - Fixed ORDER BY year -> season_id; p.team_id -> pb.team_id; DISTINCT fix
- `scripts/lib/insights/rare-events.ts` - Fixed pl.team_id filter to use EXISTS on game_player_box_scores
- `scripts/lib/insights/opponent-context.ts` - Fixed full_name -> (city||name); window_size -> window_games; avg_def_rating -> def_rating
- `scripts/lib/insights/league-comparisons.ts` - Fixed window_size/avg_* columns; GROUP BY error via scalar subquery rewrite

## Decisions Made

- ON CONFLICT partial index upsert must include `WHERE proof_hash IS NOT NULL` predicate to match the partial index definition — without it PostgreSQL raises 42P10 (no unique constraint matching specification)
- Clippers player filter moved from `players.team_id` (column doesn't exist) to `EXISTS (SELECT 1 FROM game_player_box_scores WHERE team_id = ...)` — semantically correct since a player's team is determined by their box scores
- 0-count insight categories are acceptable for sparse seed data (only 2 seeded games) — plan spec explicitly allows this

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed p.team_id column reference in streaks.ts and milestones.ts**
- **Found during:** Task 1 (running generate-insights)
- **Issue:** `players` table has no `team_id` column — error code 42703
- **Fix:** Changed filter to `pb.team_id` in streaks.ts; similar fix in milestones.ts
- **Files modified:** scripts/lib/insights/streaks.ts, scripts/lib/insights/milestones.ts
- **Verification:** Generate-insights ran past streak/milestone steps without error
- **Committed in:** 6be3348

**2. [Rule 1 - Bug] Fixed DISTINCT + ORDER BY cast restriction in streaks.ts and milestones.ts**
- **Found during:** Task 1
- **Issue:** PostgreSQL error 42P10 — SELECT DISTINCT with ORDER BY on cast expressions
- **Fix:** Wrapped inner DISTINCT query in a subquery, ordered outer query by the aliased column
- **Files modified:** scripts/lib/insights/streaks.ts, scripts/lib/insights/milestones.ts
- **Verification:** Queries execute without error
- **Committed in:** 6be3348

**3. [Rule 1 - Bug] Fixed rare-events.ts team filter using p.team_id**
- **Found during:** Task 1
- **Issue:** Same 42703 error — `players` table has no `team_id`
- **Fix:** Replaced `AND pl.team_id = ${lacTeamId}::bigint` with `AND EXISTS (SELECT 1 FROM game_player_box_scores pb2 WHERE pb2.player_id = ... AND pb2.team_id = ...)` in both rare_points and rare_assists queries
- **Files modified:** scripts/lib/insights/rare-events.ts
- **Committed in:** 6be3348

**4. [Rule 1 - Bug] Fixed opponent-context.ts: full_name column, window_size column, avg_def_rating column**
- **Found during:** Task 1 (anticipated before running — fixed preemptively after schema check)
- **Issue:** `teams.full_name` doesn't exist; rolling_team_stats uses `window_games` not `window_size`; uses `def_rating` not `avg_def_rating`
- **Fix:** Changed `full_name` to `(city || ' ' || name)`, `window_size` to `window_games`, `avg_def_rating` to `def_rating`
- **Files modified:** scripts/lib/insights/opponent-context.ts
- **Committed in:** 6be3348

**5. [Rule 1 - Bug] Fixed league-comparisons.ts: window_size/avg_* columns + GROUP BY error**
- **Found during:** Task 1 (running generate-insights)
- **Issue:** Same column naming issues + `column "total.total_teams" must appear in GROUP BY` when using COUNT(*)+1 with CROSS JOIN subquery
- **Fix:** Replaced CROSS JOIN with scalar subqueries for both rank and total_teams; fixed column names
- **Files modified:** scripts/lib/insights/league-comparisons.ts
- **Committed in:** 6be3348

**6. [Rule 1 - Bug] Fixed ON CONFLICT partial index predicate missing**
- **Found during:** Task 1 (first upsert attempt with data)
- **Issue:** `ON CONFLICT (proof_hash) DO UPDATE` fails with 42P10 because the index is partial (`WHERE proof_hash IS NOT NULL`)
- **Fix:** Changed to `ON CONFLICT (proof_hash) WHERE proof_hash IS NOT NULL DO UPDATE`
- **Files modified:** scripts/generate-insights.ts
- **Committed in:** 6be3348

**7. [Rule 1 - Bug] Fixed milestones.ts ORDER BY year -> season_id**
- **Found during:** Task 1
- **Issue:** `seasons` table has no `year` column — error 42703
- **Fix:** Changed `ORDER BY year DESC` to `ORDER BY season_id DESC`
- **Files modified:** scripts/lib/insights/milestones.ts
- **Committed in:** 6be3348

---

**Total deviations:** 7 auto-fixed (all Rule 1 bugs — column name mismatches between generated code and actual schema)
**Impact on plan:** All fixes required for correctness. The category modules were generated in Phase 03 with schema assumptions that didn't match the actual DB schema. No scope creep.

## Issues Encountered

Multiple column reference errors across the 5 category modules (generated in Phase 03) due to mismatches with actual DB schema:
- `players.team_id` doesn't exist — team membership determined via `game_player_box_scores.team_id`
- `seasons.year` doesn't exist — use `season_id`
- `teams.full_name` doesn't exist — concatenate `city || ' ' || name`
- `rolling_team_stats` uses `window_games` not `window_size`, and plain `off_rating`/`def_rating`/`net_rating` (no `avg_` prefix)
- ON CONFLICT partial index requires matching WHERE predicate

All resolved in Task 1 commit.

## Next Phase Readiness

- `npm run generate-insights` is fully operational — Phase 6 insight engine complete
- `generateLiveInsights()` exported from `src/lib/insights/live.ts` — ready for Phase 7/9 API route wiring
- insights table has 5 rows with valid proof_result — no fabricated insights
- All 5 INSIGHT requirements satisfied

## Self-Check: PASSED

- FOUND: scripts/generate-insights.ts
- FOUND: scripts/verification-phase6.sql
- FOUND: .planning/phases/06-insight-engine/06-04-SUMMARY.md
- FOUND commit: 6be3348 (task 1)
- FOUND commit: a48d03f (task 2)

---
*Phase: 06-insight-engine*
*Completed: 2026-03-06*
