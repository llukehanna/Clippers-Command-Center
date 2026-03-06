---
phase: 06-insight-engine
plan: 01
subsystem: testing
tags: [vitest, typescript, esm, postgres, insights, schema, index]

# Dependency graph
requires:
  - phase: 05-advanced-stats-engine
    provides: advanced stats schema and DB already provisioned on Neon
provides:
  - Vitest test runner configured and runnable via npm test
  - proof.test.ts RED scaffold for makeProofHash and guardProofResult (Plan 02 fills GREEN)
  - live.test.ts stub for generateLiveInsights (Plan 02 fills GREEN)
  - uq_insights_proof_hash partial unique index live in Neon insights table
affects: [06-02, 06-03, 06-04]

# Tech tracking
tech-stack:
  added: [vitest ^4]
  patterns: [TDD Wave 0 - write RED tests before implementation; partial unique index for ON CONFLICT deduplication]

key-files:
  created:
    - vitest.config.ts
    - scripts/lib/insights/__tests__/proof.test.ts
    - scripts/lib/insights/live.test.ts
  modified:
    - package.json
    - Docs/DB_SCHEMA.sql

key-decisions:
  - "Vitest chosen as test runner — ESM-native, TypeScript-first, no transpile step required"
  - "Partial unique index (WHERE proof_hash IS NOT NULL) allows NULL rows to coexist while enforcing deduplication for non-null hashes"
  - "Tests committed in RED state intentionally — proof-utils.ts is Plan 02's deliverable"

patterns-established:
  - "TDD Wave 0: commit RED tests before implementation files exist — proof-utils.ts import fails as expected"
  - "ON CONFLICT (proof_hash) upsert pattern enabled by uq_insights_proof_hash partial unique index"

requirements-completed: [INSIGHT-03, INSIGHT-04]

# Metrics
duration: 2min
completed: 2026-03-06
---

# Phase 06 Plan 01: Insight Engine — Test Infra and Schema Index Summary

**Vitest installed and configured for ESM+TS; proof_hash partial unique index live on Neon; RED test scaffold for makeProofHash/guardProofResult committed as TDD Wave 0 starting point**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-06T22:09:48Z
- **Completed:** 2026-03-06T22:11:15Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Vitest installed (^4), `npm test` script wired up, `vitest.config.ts` created targeting `scripts/lib/insights/**/*.test.ts`
- `proof.test.ts` written with 6 behavioral tests in RED state (import of `proof-utils.js` fails — correct TDD Wave 0)
- `live.test.ts` stub created with 5 `it.todo` tests for `generateLiveInsights` (Plan 02 fills GREEN)
- `CREATE UNIQUE INDEX IF NOT EXISTS uq_insights_proof_hash ON insights (proof_hash) WHERE proof_hash IS NOT NULL` added to `Docs/DB_SCHEMA.sql` and applied to Neon via `npm run db:schema` (exits 0)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install Vitest, create vitest.config.ts, and write proof unit test scaffold** - `c2bf9ac` (test)
2. **Task 2: Add proof_hash unique index to DB_SCHEMA.sql and apply to Neon** - `ea26239` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `vitest.config.ts` - Vitest config; includes glob `scripts/lib/insights/**/*.test.ts` and `src/lib/insights/**/*.test.ts`
- `scripts/lib/insights/__tests__/proof.test.ts` - RED unit tests for `makeProofHash` (4 tests) and `guardProofResult` (2 tests)
- `scripts/lib/insights/live.test.ts` - Stub with 5 `it.todo` tests for `generateLiveInsights`
- `package.json` - Added `"test": "vitest run"` script; vitest ^4 added to devDependencies
- `Docs/DB_SCHEMA.sql` - Added `uq_insights_proof_hash` partial unique index after insights table indexes

## Decisions Made
- Vitest chosen (ESM-native, TypeScript-first, no transpile step) — matches project's ESM module setup
- Partial unique index `WHERE proof_hash IS NOT NULL` chosen so rows with null `proof_hash` remain insertable without conflict; only non-null hashes are deduplicated
- Tests intentionally committed in RED state as TDD Wave 0 — `proof-utils.ts` is Plan 02's deliverable

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness
- Plan 02 can now create `scripts/lib/insights/proof-utils.ts` and turn the RED tests GREEN
- Plan 02 can fill in `live.test.ts` stubs once `generateLiveInsights` is implemented
- Plan 04 ON CONFLICT upserts will work because `uq_insights_proof_hash` index is live in Neon

---
*Phase: 06-insight-engine*
*Completed: 2026-03-06*

## Self-Check: PASSED

- vitest.config.ts: FOUND
- scripts/lib/insights/__tests__/proof.test.ts: FOUND
- scripts/lib/insights/live.test.ts: FOUND
- Docs/DB_SCHEMA.sql: FOUND
- Commit c2bf9ac (Task 1): FOUND
- Commit ea26239 (Task 2): FOUND
- uq_insights_proof_hash in schema: FOUND
