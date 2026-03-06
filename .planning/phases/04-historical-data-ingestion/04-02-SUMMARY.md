---
phase: 04-historical-data-ingestion
plan: 02
subsystem: database
tags: [typescript, postgres, balldontlie, api-client, upserts, etl]

# Dependency graph
requires:
  - phase: 04-01
    provides: scripts directory structure, package.json with postgres + tsx, backfill npm script, DB schema applied to Neon

provides:
  - BDL API TypeScript types (BDLTeam, BDLPlayer, BDLGame, BDLStat, BDLPaginatedResponse)
  - postgres DB client singleton with fail-fast env check
  - BDL fetch wrapper with cursor pagination and exponential retry
  - Typed idempotent upserts for all 7 backfill tables + app_kv checkpoints

affects:
  - 04-03-backfill-orchestrator
  - any phase importing scripts/lib

# Tech tracking
tech-stack:
  added: []
  patterns:
    - bigint FK values returned as text from DB to avoid postgres.js type friction, cast back via ::bigint in SQL
    - TransactionSql cast via `as unknown as typeof sql` to work around TypeScript Omit losing call signatures
    - player_team_stints uses INSERT WHERE NOT EXISTS (no UNIQUE constraint, so no ON CONFLICT)
    - raw_payload stored via JSON.stringify to satisfy postgres JSONValue type constraint
    - DELAY_MS env var override pattern for rate limit tuning without code changes

key-files:
  created:
    - scripts/types/bdl.ts
    - scripts/lib/db.ts
    - scripts/lib/bdl-client.ts
    - scripts/lib/upserts.ts
  modified: []

key-decisions:
  - "bigint FK values fetched as text (::text) and cast back (::bigint) to avoid postgres.js SerializableParameter type gap"
  - "TransactionSql cast to typeof sql via unknown to work around TypeScript Omit stripping call signatures"
  - "raw_payload stored as JSON.stringify string (not sql.json()) to satisfy strict JSONValue typing"
  - "upsertBoxScoresForGame computes team totals from player stats (BDL /stats is player-level only)"

patterns-established:
  - "Pattern 1: All upserts use ON CONFLICT ... DO UPDATE except player_team_stints which uses WHERE NOT EXISTS"
  - "Pattern 2: BDL FK lookups return text IDs (::text), cast back in SQL (::bigint)"
  - "Pattern 3: Env var fail-fast at module load time (not lazily) to surface config errors immediately"

requirements-completed: [DATA-01, DATA-04, DATA-05]

# Metrics
duration: 15min
completed: 2026-03-05
---

# Phase 4 Plan 02: Script Library Layer Summary

**BDL API client with cursor pagination and retry, typed upserts for all 7 tables using ON CONFLICT idempotency, and postgres singleton — complete ETL library for the backfill orchestrator**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-06T03:18:07Z
- **Completed:** 2026-03-06T03:33:00Z
- **Tasks:** 3
- **Files modified:** 4 created

## Accomplishments
- TypeScript interfaces for all 5 BDL API response types in strict mode
- postgres singleton with fail-fast DATABASE_URL check and small pool (max: 3)
- BDL API client with cursor-based fetchAll<T> and 3-attempt exponential withRetry<T>
- Idempotent upserts for seasons, teams, players, stints, games, team box scores, player box scores, and app_kv checkpoints
- Box score upserts wrapped in sql.begin() transaction to prevent partial writes

## Task Commits

Each task was committed atomically:

1. **Task 1: BDL TypeScript types and DB client singleton** - `cf4054b` (feat)
2. **Task 2: BDL API fetch client with pagination and retry** - `479f554` (feat)
3. **Task 3: Typed upsert functions for all backfill tables** - `9a93ee1` (feat)

**Plan metadata:** (docs commit — see state update)

## Files Created/Modified
- `scripts/types/bdl.ts` — BDLTeam, BDLPlayer, BDLGame, BDLStat, BDLPaginatedResponse interfaces
- `scripts/lib/db.ts` — postgres singleton, exits with error if DATABASE_URL unset, pool max=3
- `scripts/lib/bdl-client.ts` — DELAY_MS, sleep, fetchAll<T>, withRetry<T>
- `scripts/lib/upserts.ts` — upsertSeasons, upsertTeams, upsertPlayers, upsertStints, upsertGames, upsertBoxScoresForGame, getCheckpoint, setCheckpoint

## Decisions Made
- **bigint as text**: postgres.js SerializableParameter type doesn't include bigint. Resolved by fetching FK values as `::text` and casting back in SQL with `::bigint`. Avoids runtime errors and is type-safe.
- **TransactionSql cast**: TypeScript's `Omit<Sql, ...>` strips call signatures from TransactionSql, so `txSql` can't be called as a template tag. Worked around with `tx as unknown as typeof sql`. Runtime behavior is correct — this is a types-only limitation.
- **Team box scores aggregated from player stats**: BDL's `/stats` endpoint returns player-level data only. Team totals are computed by grouping player stats by team within `upsertBoxScoresForGame`.
- **JSON.stringify for raw_payload**: `sql.json(stat)` required the BDLStat type to satisfy postgres JSONValue. Used `JSON.stringify(stat)` passed as a string instead — postgres converts TEXT → JSONB automatically.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript type errors for bigint FK values passed as SQL parameters**
- **Found during:** Task 3 (upserts.ts type check)
- **Issue:** postgres.js `SerializableParameter` does not include `bigint`. Queries returning `player_id: bigint` couldn't be re-used as template tag parameters.
- **Fix:** Changed all FK lookups to `SELECT id::text`, then cast back `${id}::bigint` in SQL strings.
- **Files modified:** scripts/lib/upserts.ts
- **Verification:** `tsc --noEmit --strict` passes with 0 errors
- **Committed in:** 9a93ee1 (Task 3 commit)

**2. [Rule 1 - Bug] TransactionSql has no call signatures in TypeScript**
- **Found during:** Task 3 (upserts.ts type check)
- **Issue:** `Omit<Sql, ...>` strips the template tag call signatures from TransactionSql, so `txSql\`...\`` fails type checking.
- **Fix:** Added `const txSql = tx as unknown as typeof sql;` cast inside the begin callback.
- **Files modified:** scripts/lib/upserts.ts
- **Verification:** `tsc --noEmit --strict` passes; runtime behavior unchanged (postgres.js TransactionSql is callable)
- **Committed in:** 9a93ee1 (Task 3 commit)

**3. [Rule 1 - Bug] sql.json(stat) rejected — BDLStat not assignable to JSONValue**
- **Found during:** Task 3 (upserts.ts type check)
- **Issue:** BDLStat interface doesn't satisfy postgres JSONValue type (missing index signature).
- **Fix:** Used `JSON.stringify(stat)` and passed the resulting string. PostgreSQL casts TEXT → JSONB automatically.
- **Files modified:** scripts/lib/upserts.ts
- **Verification:** `tsc --noEmit --strict` passes
- **Committed in:** 9a93ee1 (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 1 — TypeScript type system friction with postgres.js generics)
**Impact on plan:** All auto-fixes are type-level only. Runtime semantics are identical to the plan's code. No scope creep.

## Issues Encountered
- The `npx tsc` shim in node_modules/.bin was broken (missing `../lib/tsc.js`). Used `node node_modules/typescript/bin/tsc` directly for type checking throughout. This is a local tooling issue unrelated to the code.

## User Setup Required
None - no external service configuration required (env vars already documented in plan 04-01).

## Next Phase Readiness
- All 4 library files are ready for import by the backfill orchestrator (Plan 04-03)
- `upsertBoxScoresForGame` signature uses string IDs — caller must pass `game_id::text` from DB query
- DELAY_MS env var can be set to 1000 for faster backfill on paid API tier
- No blockers for Plan 04-03

## Self-Check: PASSED

- FOUND: scripts/types/bdl.ts
- FOUND: scripts/lib/db.ts
- FOUND: scripts/lib/bdl-client.ts
- FOUND: scripts/lib/upserts.ts
- FOUND commit: cf4054b (Task 1)
- FOUND commit: 479f554 (Task 2)
- FOUND commit: 9a93ee1 (Task 3)

---
*Phase: 04-historical-data-ingestion*
*Completed: 2026-03-05*
