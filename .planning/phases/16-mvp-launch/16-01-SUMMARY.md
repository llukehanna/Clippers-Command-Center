---
phase: 16-mvp-launch
plan: "01"
subsystem: live-data-pipeline
tags: [cron, vercel, production, live-data]
dependency_graph:
  requires: [scripts/lib/nba-live-client.ts, scripts/lib/poll-live-logic.ts, src/lib/db.ts, src/lib/types/live.ts]
  provides: [app/api/cron/poll-live/route.ts, vercel.json, .env.example]
  affects: [live_snapshots table, games table, game_team_box_scores table, game_player_box_scores table]
tech_stack:
  added: [vercel.json crons]
  patterns: [stateless cron handler, Next.js App Router GET handler, append-only snapshot INSERT]
key_files:
  created:
    - app/api/cron/poll-live/route.ts
    - vercel.json
  modified:
    - .env.example
decisions:
  - "Finalization logic inlined with src/lib/db sql instead of importing scripts/lib/finalize.ts — avoids process.exit code path from Next.js API layer boundary"
  - "scripts/lib/nba-live-client and poll-live-logic imported via relative path (../../../../scripts/lib/) — moduleResolution:bundler resolves .ts files directly, no inlining needed"
  - "All error paths return HTTP 200 — prevents Vercel Cron retry storm on CDN outage; non-fatal design"
  - "void LAC_TEAM_ID used to suppress unused import warning while keeping the export visible for type-checking"
metrics:
  duration: "2 minutes"
  completed: "2026-03-12"
  tasks_completed: 2
  files_changed: 3
---

# Phase 16 Plan 01: Vercel Cron Route for Live Data Pipeline Summary

**One-liner:** Stateless Vercel Cron route replaces long-running poll-live.ts script — one NBA CDN fetch + DB write per 60s invocation, all paths return HTTP 200.

## What Was Built

Created the production live data pipeline entry point. Vercel Cron fires every minute via `vercel.json`, calls `/api/cron/poll-live`, which runs one poll cycle and exits. No while-loop, no backoff state, no process-level long-running behavior.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Stateless cron route handler | bf1b0e5 | app/api/cron/poll-live/route.ts |
| 2 | vercel.json cron config + .env.example update | 37be5b9 | vercel.json, .env.example |

## Key Decisions Made

1. **Finalization inlined with Next.js-safe sql**: `scripts/lib/finalize.ts` imports `scripts/lib/db.ts` which calls `process.exit()` — incompatible with the Next.js API layer. The finalization logic was inlined into the cron route using `src/lib/db sql` instead. This keeps the behavior identical while staying within the app boundary.

2. **scripts/lib imports via relative path**: With `moduleResolution: bundler` in tsconfig, TypeScript resolves `.ts` files directly via relative paths. The `../../../../scripts/lib/nba-live-client` and `../../../../scripts/lib/poll-live-logic` imports work cleanly — no inlining needed for these files.

3. **HTTP 200 on all paths**: The plan explicitly required this. On CDN outage, returning 5xx would trigger Vercel's automatic retry logic, causing thundering-herd retries. All paths (NO_ACTIVE_GAME, ERROR, OK) return 200.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Finalization uses src/lib/db instead of scripts/lib/finalize import**
- **Found during:** Task 1
- **Issue:** `scripts/lib/finalize.ts` imports `scripts/lib/db.ts` which calls `process.exit()` — this would crash the Next.js worker if the finalization SQL failed. Plan noted this risk ("If TypeScript strict mode rejects it, inline the minimal needed code").
- **Fix:** Inlined equivalent finalization SQL directly in the cron route using `src/lib/db sql` (the Next.js-safe client that throws instead of calling process.exit). Logic is identical to finalize.ts.
- **Files modified:** app/api/cron/poll-live/route.ts
- **Commit:** bf1b0e5

## Verification Results

- `npx tsc --noEmit` — zero errors in cron route file (pre-existing errors in api-live.test.ts are out of scope)
- vercel.json is valid JSON with `crons` key, path `/api/cron/poll-live`, schedule `* * * * *`
- .env.example contains DATABASE_URL, BALLDONTLIE_API_KEY, ODDS_API_KEY
- app/api/cron/poll-live/route.ts has no while-loop, returns 200 on all paths, exports GET

## Self-Check: PASSED

Files created:
- FOUND: app/api/cron/poll-live/route.ts
- FOUND: vercel.json
- FOUND: .env.example (ODDS_API_KEY present)

Commits:
- bf1b0e5: feat(16-01): stateless cron route handler
- 37be5b9: chore(16-01): vercel.json cron config and .env.example ODDS_API_KEY
