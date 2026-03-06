---
plan: 07-05
phase: 07-live-data-pipeline
status: complete
completed: 2026-03-06
---

# 07-05 Summary: Game Finalization + Post-Game Box Scores

## What Was Built

Post-game finalization pipeline: `scripts/lib/finalize.ts`, `scripts/finalize-games.ts`, updated `scripts/lib/upserts.ts`, and wired into `scripts/poll-live.ts`.

## Key Files

### Created
- `scripts/lib/finalize.ts` — `finalizeGame(gameDbId, nbaGameId)` with NBA API lag guard, 3 retries (60s delay), DNP skipping, team totals from NBA-provided stats
- `scripts/finalize-games.ts` — catch-up script: finds Final games without box scores and calls `finalizeGame` on each

### Modified
- `scripts/lib/upserts.ts` — added `upsertTeamBoxScore()` and `upsertPlayerBoxScore()` with ON CONFLICT upserts
- `scripts/poll-live.ts` — replaced stub `finalizeGame` with real import from `./lib/finalize.js`

## Tasks Completed

1. **Finalization module** — `upserts.ts` box-score upserts + `finalize.ts` with full retry/guard logic
2. **Entry points** — `finalize-games.ts` catch-up script + `poll-live.ts` wired to real `finalizeGame`

## Commits

- `e45fa56` feat(07-05): add upsertTeamBoxScore/upsertPlayerBoxScore and finalizeGame module
- `2ca62e7` feat(07-05): add finalize-games.ts catch-up script and wire finalizeGame into poll-live.ts

## Self-Check: PASSED

All must-haves implemented:
- ✓ `npm run finalize-games` entry point registered (Wave 1, plan 07-03)
- ✓ `upsertTeamBoxScore` and `upsertPlayerBoxScore` with ON CONFLICT upserts
- ✓ `finalizeGame` with NBA API lag guard (waits for stats to be available)
- ✓ 3 retries with 60s delay on finalization failure
- ✓ DNP players skipped
- ✓ Team totals sourced from NBA-provided stats
- ✓ `poll-live.ts` finalization stub replaced with real module import
