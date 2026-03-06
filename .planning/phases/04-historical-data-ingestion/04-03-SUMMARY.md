---
phase: 04-historical-data-ingestion
plan: 03
subsystem: database
tags: [typescript, postgres, balldontlie, etl, backfill, orchestrator]

# Dependency graph
requires:
  - phase: 04-01
    provides: scripts directory structure, package.json with postgres + tsx, backfill npm script, DB schema applied to Neon
  - phase: 04-02
    provides: BDL API types, DB client singleton, BDL fetch client with pagination/retry, typed upserts for all 7 tables

provides:
  - Backfill orchestrator script (scripts/backfill.ts) — main entry point for npm run backfill
  - 3-season NBA historical data in Neon: teams, players, games, player + team box scores

affects:
  - 05-advanced-stats-engine
  - 06-insight-engine
  - all phases requiring real NBA data

# Tech tracking
tech-stack:
  added: []
  patterns:
    - fetchStatsForBatch builds repeated game_ids[] URL params manually (fetchAll Record<string,string> can't express repeated keys)
    - season-level checkpoints via app_kv — backfill is resumable after interruption
    - game_id fetched as ::text from DB and passed as string to upsertBoxScoresForGame

key-files:
  created:
    - scripts/backfill.ts
  modified: []

key-decisions:
  - "fetchStatsForBatch bypasses fetchAll to build repeated game_ids[] query params manually via URL string concatenation"
  - "game_id fetched as text (::text) from games table and passed as string to upsertBoxScoresForGame to match function signature"

patterns-established:
  - "Pattern 1: Repeated API array params built as manual URL strings when fetchAll Record<string,string> is insufficient"

requirements-completed: [DATA-01, DATA-04, DATA-05]

# Metrics
duration: 5min
completed: 2026-03-06
---

# Phase 4 Plan 03: Backfill Orchestrator Summary

**ETL orchestrator for 3-season NBA data ingestion — teams/players sync, season-by-season game + box score upserts, checkpoint-based resumability, and final count summary**

## Performance

- **Duration:** ~5 min (Task 1 only; Task 2 is human verification)
- **Started:** 2026-03-06T03:24:51Z
- **Completed:** 2026-03-06T03:30:00Z (Task 1); Task 2 pending human verification
- **Tasks:** 1/2 complete (Task 2 is checkpoint:human-verify)
- **Files modified:** 1 created

## Accomplishments
- Backfill orchestrator with startup banner, per-season progress logging, and final DB count summary
- Checkpoint logic reads/writes `backfill:last_completed_season` via app_kv — fully resumable
- `fetchStatsForBatch` helper builds repeated `game_ids[]` URL params manually (workaround for fetchAll limitation)
- All 3 seasons (2022, 2023, 2024) processed in order; skipped game IDs tracked and printed
- `sql.end()` called in both success and error paths

## Task Commits

1. **Task 1: Write backfill orchestrator** - `ba1d858` (feat)

**Task 2 (checkpoint:human-verify):** Pending user verification that backfill runs end-to-end and data is correct in Neon.

## Files Created/Modified
- `scripts/backfill.ts` — main ETL orchestrator, SEASONS=[2022,2023,2024], 221 lines

## Decisions Made
- **fetchStatsForBatch manual URL builder:** `fetchAll` accepts `Record<string, string>` which can't express repeated `game_ids[]` params (same key, multiple values). Wrote a standalone `fetchStatsForBatch` that builds the URL string manually and handles cursor pagination the same way.
- **game_id as string:** `upsertBoxScoresForGame` signature takes `gameId: string`. Queried the games table with `game_id::text` and passed the string directly, consistent with the pattern established in Plan 02.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] fetchAll cannot express repeated game_ids[] query params**
- **Found during:** Task 1 (writing backfill orchestrator)
- **Issue:** `fetchAll` accepts `Record<string, string>` — the same key can't appear twice. BDL `/stats` requires `game_ids[]=123&game_ids[]=456` (repeated key). The plan's indexed key suggestion (`game_ids[0]=123`) may not be accepted by BDL API.
- **Fix:** Added `fetchStatsForBatch` inline helper that builds the URL string manually (`gameIds.map(id => \`game_ids[]=${id}\`).join('&')`) and handles cursor pagination. This matches the plan's fallback suggestion exactly.
- **Files modified:** scripts/backfill.ts
- **Verification:** TypeScript strict mode passes (tsc --noEmit with project tsconfig)
- **Committed in:** ba1d858 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — URL param limitation)
**Impact on plan:** Plan explicitly documented this as a known issue and provided the fallback approach. Implementation follows the plan's fallback exactly.

## Issues Encountered
- The plan's verify command (`npx tsc --noEmit --strict scripts/backfill.ts`) skips the project tsconfig, which causes spurious errors from library files (missing esModuleInterop, downlevelIteration). Used `node node_modules/typescript/bin/tsc --noEmit` with the project tsconfig instead — passes with 0 errors.

## User Setup Required
Before running `npm run backfill`, ensure `.env.local` has:
- `DATABASE_URL=postgresql://...` (Neon connection string)
- `BALLDONTLIE_API_KEY=...` (BDL API key)
- `DELAY_MS=1000` (if ALL-STAR tier key) or `12000` (free tier)

Then: `npm run db:schema` to apply schema, then `npm run backfill`.

## Next Phase Readiness
- Task 2 (human-verify) is pending — run `npm run backfill` and verify with `psql $DATABASE_URL -f scripts/verification.sql`
- After checkpoint approved: Phase 5 (Advanced Stats Engine) has real data to compute against

## Self-Check: PASSED

- FOUND: scripts/backfill.ts
- FOUND commit: ba1d858 (Task 1)

---
*Phase: 04-historical-data-ingestion*
*Completed: 2026-03-06*
