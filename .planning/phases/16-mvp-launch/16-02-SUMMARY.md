---
phase: 16-mvp-launch
plan: "02"
subsystem: infra
tags: [github-actions, cron, automation, data-pipeline]

requires:
  - phase: 07-live-data-pipeline
    provides: sync-schedule.ts, finalize-games.ts, compute-stats.ts scripts used by workflows
  - phase: 06-insight-engine
    provides: generate-insights.ts script used by post-game workflow
  - phase: 08-odds-integration
    provides: sync-odds.yml pattern used as workflow template

provides:
  - Daily automated schedule sync at 6am PT via GitHub Actions
  - Nightly post-game chained pipeline (finalize-games -> compute-stats -> generate-insights) at 2am PT
affects: [16-mvp-launch, operations]

tech-stack:
  added: []
  patterns:
    - GitHub Actions workflow with sequential steps for step-level failure propagation
    - Each step scoped to only the env vars it requires

key-files:
  created:
    - .github/workflows/sync-schedule.yml
    - .github/workflows/post-game.yml
  modified: []

key-decisions:
  - "post-game uses single job with sequential run steps (not separate jobs with needs:) — ensures step-level failure stops the chain automatically"
  - "Each step in post-game.yml carries only the env vars it needs — finalize-games gets BALLDONTLIE_API_KEY, compute-stats/generate-insights get DATABASE_URL only"

patterns-established:
  - "Workflow pattern: checkout@v4 + setup-node@v4(20/npm) + npm ci + run steps — matches sync-odds.yml template"

requirements-completed: []

duration: 2min
completed: 2026-03-12
---

# Phase 16 Plan 02: GitHub Actions Automated Data Pipelines Summary

**Two GitHub Actions workflows automating daily schedule sync (6am PT) and nightly post-game chained pipeline (finalize-games -> compute-stats -> generate-insights at 2am PT)**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-12T07:00:06Z
- **Completed:** 2026-03-12T07:01:20Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created sync-schedule.yml with daily cron at 6am PT (14:00 UTC), workflow_dispatch, DATABASE_URL + BALLDONTLIE_API_KEY secrets
- Created post-game.yml with nightly cron at 2am PT (10:00 UTC), sequential finalize-games -> compute-stats -> generate-insights steps with step-level failure propagation
- Both workflows follow the established sync-odds.yml pattern exactly (checkout@v4, setup-node@v4 node 20/cache npm, npm ci)

## Task Commits

Each task was committed atomically:

1. **Task 1: sync-schedule workflow** - `f21f48a` (feat)
2. **Task 2: post-game chained workflow** - `cf4b02b` (feat)

## Files Created/Modified

- `.github/workflows/sync-schedule.yml` - Daily schedule sync workflow at 0 14 * * * with DATABASE_URL + BALLDONTLIE_API_KEY
- `.github/workflows/post-game.yml` - Nightly post-game pipeline at 0 10 * * * chaining finalize-games -> compute-stats -> generate-insights

## Decisions Made

- Used single job with sequential `run` steps in post-game.yml (not separate jobs with `needs:`) so GitHub Actions' default step failure behavior stops the chain automatically without additional configuration
- finalize-games step includes BALLDONTLIE_API_KEY since that script fetches from BDL API; compute-stats and generate-insights steps get DATABASE_URL only — each step scoped precisely to its requirements

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

Both workflows depend on GitHub Secrets already established for sync-odds.yml:
- `DATABASE_URL` — already in use
- `BALLDONTLIE_API_KEY` — needed for sync-schedule and finalize-games steps; must be added to GitHub Secrets if not already present
- `ODDS_API_KEY` — unchanged, only used by sync-odds.yml

## Next Phase Readiness

- Automated data pipeline infrastructure complete — schedule stays current, post-game box scores finalized and stats/insights recomputed nightly without manual intervention
- Ready for Plan 03 (remaining MVP launch tasks)

---
*Phase: 16-mvp-launch*
*Completed: 2026-03-12*
