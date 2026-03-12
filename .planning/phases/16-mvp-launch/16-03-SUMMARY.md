---
phase: 16-mvp-launch
plan: "03"
subsystem: infra
tags: [vercel, deployment, smoke-test, env-vars, neon, next-js]

# Dependency graph
requires:
  - phase: 16-01
    provides: Vercel cron route (app/api/cron/poll-live/route.ts) and vercel.json
  - phase: 16-02
    provides: GitHub Actions workflows (sync-schedule.yml, post-game.yml)
provides:
  - Live production deployment at https://clippers-command-center.vercel.app
  - All 5 page routes verified HTTP 200 in production
  - All key API routes verified HTTP 200 with real data
  - NEXT_PUBLIC_BASE_URL env var configured in Vercel
  - 11 LAC players set to is_active=true in production DB
affects: [ongoing-operations, monitoring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - NEXT_PUBLIC_BASE_URL must be set in Vercel env vars for server-side fetch in page components
    - player is_active flag must be maintained after each backfill run

key-files:
  created: []
  modified: []

key-decisions:
  - "NEXT_PUBLIC_BASE_URL=https://clippers-command-center.vercel.app added to Vercel production env vars — server-side fetch in page components falls back to localhost:3000 without it, causing 500s"
  - "11 LAC players re-set to is_active=true after backfill reset them to false — backfill scripts do not preserve is_active state"

patterns-established:
  - "Post-backfill: always verify is_active=true for current LAC roster players after running npm run backfill"
  - "Env var checklist for Vercel: DATABASE_URL, BALLDONTLIE_API_KEY, ODDS_API_KEY, CRON_SECRET, NEXT_PUBLIC_BASE_URL"

requirements-completed: []

# Metrics
duration: 11min
completed: 2026-03-12
---

# Phase 16 Plan 03: MVP Launch — Smoke Test Verification Summary

**All 5 page routes and 4 API routes returning HTTP 200 on Vercel production with real data after fixing missing NEXT_PUBLIC_BASE_URL env var and LAC player is_active state**

## Performance

- **Duration:** 11 min
- **Started:** 2026-03-12T08:09:20Z
- **Completed:** 2026-03-12T08:20:30Z
- **Tasks:** 3 (tasks 1 and 2 completed in prior session; task 3 completed this session)
- **Files modified:** 0 (data fixes only)

## Accomplishments

- All 5 page routes (`/`, `/schedule`, `/live`, `/history`, `/players`) return HTTP 200 in production
- All 4 API routes (`/api/players`, `/api/schedule`, `/api/live`, `/api/home`) return HTTP 200 with real data
- `/api/live` correctly returns `DATA_DELAYED` with `stale_reason: poll daemon offline` (no live game today)
- `/api/schedule` returns 14 upcoming Clippers games (next: Mar 13 vs CHI)
- `/api/players` returns 11 active LAC roster players (real names: Kawhi, Harden, Zubac, etc.)
- `/api/home` returns team snapshot with 4 insights

## Task Commits

This plan had no code changes — tasks 1 and 2 were backfill/deployment operations, task 3 was verification only.

1. **Task 1: Pre-launch data backfill** - completed in prior session (45 teams, 5530 players, 3981 games seeded)
2. **Task 2: Vercel deployment** - completed in prior session (deployed to https://clippers-command-center.vercel.app)
3. **Task 3: Smoke test verification** - no code commit (data fix + env var addition via Vercel CLI)

## Files Created/Modified

None — all changes were infrastructure/data:
- Vercel env var `NEXT_PUBLIC_BASE_URL` added via `npx vercel env add`
- Vercel redeployed to pick up the new env var
- 11 LAC players updated to `is_active=true` directly in Neon DB

## Decisions Made

- **NEXT_PUBLIC_BASE_URL is required in Vercel env**: The schedule and history pages use server-side `fetch()` with a `baseUrl` that falls back to `http://localhost:3000`. Without `NEXT_PUBLIC_BASE_URL` set in Vercel production, both pages returned HTTP 500. Added via `npx vercel env add NEXT_PUBLIC_BASE_URL production`.
- **is_active must be manually maintained post-backfill**: The `npm run backfill` script seeds players from BDL API and sets all players to `is_active=false` by default. The 11 LAC players (from the 2024 box score data) needed to be re-set to `is_active=true` in the production DB after each backfill run.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing NEXT_PUBLIC_BASE_URL env var in Vercel production**
- **Found during:** Task 3 (smoke test verification)
- **Issue:** `/schedule` and `/history` returned HTTP 500. Both pages do server-side `fetch(baseUrl + '/api/...')` where `baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'`. Without the env var set, Vercel functions fetched `http://localhost:3000/api/...` which fails.
- **Fix:** Added `NEXT_PUBLIC_BASE_URL=https://clippers-command-center.vercel.app` via `npx vercel env add`, then redeployed with `npx vercel --prod`.
- **Files modified:** None (Vercel environment variable, not code)
- **Verification:** Both `/schedule` and `/history` return HTTP 200 after redeployment
- **Committed in:** N/A (infrastructure change)

**2. [Rule 1 - Bug] LAC players had is_active=false after backfill**
- **Found during:** Task 3 (smoke test verification — `/api/players` returned 0 players)
- **Issue:** The `/api/players` route filters by `is_active = true`. After `npm run backfill` ran in task 1, all 11 LAC players were reset to `is_active=false`, so the endpoint returned an empty array.
- **Fix:** Updated all 11 players with LAC `player_team_stints` to `is_active=true` via direct DB UPDATE: `UPDATE players SET is_active = true WHERE player_id IN (SELECT DISTINCT p.player_id FROM players p JOIN player_team_stints pts ON pts.player_id = p.player_id JOIN teams t ON pts.team_id = t.team_id WHERE t.abbreviation = 'LAC')`.
- **Files modified:** None (data fix, not code)
- **Verification:** `/api/players?_t={epoch}` returns 11 players (Amir Coffey, Ivica Zubac, James Harden, Kawhi Leonard, Marcus Morris, Norman Powell, Nah'Shon Hyland, Paul George, Robert Covington, Russell Westbrook, Terance Mann)
- **Committed in:** N/A (data fix)

---

**Total deviations:** 2 auto-fixed (1 blocking env var, 1 data bug)
**Impact on plan:** Both fixes necessary for production correctness. No scope creep.

## Issues Encountered

- `/api/live` returns `DATA_DELAYED` with `stale_reason: poll daemon offline` — this is **expected and correct** behavior. The poll daemon (cron route) runs as a Vercel Cron Job that fires every minute during games. No Clippers game is scheduled for today (2026-03-12), so the last snapshot was from the Mar 7 game. The state is honest and correct per the never-fabricate rule.
- CDN cache on `/api/players` made it appear the data fix hadn't worked — verified with cache-busting `?_t=epoch` query param, confirmed 11 players returned correctly from fresh function invocation.

## Smoke Test Results

| # | Check | Result |
|---|-------|--------|
| 1 | GET / — homepage loads | 200 OK |
| 2 | GET /live — live dashboard loads | 200 OK |
| 3 | GET /schedule — schedule page loads | 200 OK |
| 4 | GET /history — history page loads | 200 OK |
| 5 | GET /players — player roster loads | 200 OK |
| 6 | GET /api/live — state: DATA_DELAYED (correct) | 200 OK |
| 7 | GET /api/home — team data, 4 insights, next game | 200 OK |
| 8 | GET /api/schedule — 14 upcoming games | 200 OK |
| 9 | GET /api/players — 11 active LAC players | 200 OK |
| 10 | Data integrity — real player names, real game dates | Pass |
| 11 | Odds columns — null/-- (no odds in DB) | Pass |

## Next Phase Readiness

- MVP v1.0 is live at https://clippers-command-center.vercel.app
- All routes are functional with real data
- Vercel Cron active for `poll-live` (every minute)
- GitHub Actions workflows present: `sync-schedule` + `post-game`
- Known ongoing: `is_active` flag will need re-setting after each `npm run backfill` run (or backfill script should be updated to preserve `is_active` state in a future maintenance task)

---
*Phase: 16-mvp-launch*
*Completed: 2026-03-12*
