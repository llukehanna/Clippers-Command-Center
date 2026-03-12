---
phase: 15-reliability-and-validation
plan: 03
subsystem: ui
tags: [reliability, stale-data, data-delayed, banner, api, typescript]

# Dependency graph
requires:
  - phase: 15-reliability-and-validation-01
    provides: Test infrastructure and vitest config with @/* alias; runPollCycle extraction
  - phase: 15-reliability-and-validation-02
    provides: Timing SLA tests for /api/home and /api/history/games; stale duplicate removed
  - phase: 11-live-game-dashboard
    provides: StaleBanner component and useLiveData hook
provides:
  - DATA_DELAYED API response includes snapshot_captured_at field (accurate last-captured time)
  - StaleBanner uses capturedAt prop (snapshot time) instead of generatedAt (response time)
  - hooks/useLiveData.ts LiveDashboardPayload type extended with snapshot_captured_at field
  - Human-verified: scoreboard visible + amber banner during DATA_DELAYED, no blank screen
affects: [live-dashboard, api-live, stale-data-handling]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Distinguish capture time from response time in API payloads — snapshot_captured_at vs meta.generated_at"
    - "StaleBanner prefers capturedAt over generatedAt for accurate staleness reporting"
    - "Optional prop fallback pattern: timeRef = capturedAt ?? generatedAt"

key-files:
  created: []
  modified:
    - app/api/live/route.ts
    - components/stale-banner/StaleBanner.tsx
    - hooks/useLiveData.ts
    - app/live/page.tsx

key-decisions:
  - "snapshot_captured_at added as top-level field in DATA_DELAYED response only — not in LIVE or NO_ACTIVE_GAME branches where snap.captured_at is not meaningful"
  - "StaleBanner keeps generatedAt prop for backward compat; prefers capturedAt when present"
  - "LiveDashboardPayload.snapshot_captured_at typed as optional string — safe for all three API states"

patterns-established:
  - "API reliability: surface the data capture timestamp separately from the response generation timestamp"

requirements-completed: [RELY-03]

# Metrics
duration: 15min
completed: 2026-03-11
---

# Phase 15 Plan 03: Reliability and Validation — DATA_DELAYED Accurate Staleness Summary

**Fixed StaleBanner to show time since last snapshot capture (not response generation) during DATA_DELAYED, surfacing snapshot_captured_at from the API and extending the LiveDashboardPayload type**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-11
- **Completed:** 2026-03-11
- **Tasks:** 2 (1 auto + 1 human-verify)
- **Files modified:** 4

## Accomplishments

- Fixed the RELY-03 bug: during a real outage, `meta.generated_at` is approximately "now" (response was just built), not when game data was last captured; banner now uses the correct timestamp
- Added `snapshot_captured_at: snap.captured_at` to the DATA_DELAYED response branch in `app/api/live/route.ts`
- Extended `StaleBanner` with a `capturedAt?: string` prop that takes precedence over `generatedAt` in the minutes-ago calculation
- Extended `LiveDashboardPayload` in `hooks/useLiveData.ts` with `snapshot_captured_at?: string` so `app/live/page.tsx` passes it to StaleBanner without type casts
- Human verification approved: scoreboard remains visible during DATA_DELAYED, amber banner shows correct relative time, no blank screen or skeleton loaders

## Task Commits

1. **Task 1: Surface snapshot.captured_at in DATA_DELAYED response and fix StaleBanner** - `a629186` (feat)
2. **Task 2: Human verification** - approved (no code commit)

## Files Created/Modified

- `app/api/live/route.ts` - DATA_DELAYED branch now includes `snapshot_captured_at: snap.captured_at`
- `components/stale-banner/StaleBanner.tsx` - Added `capturedAt` prop; prefers it over `generatedAt` for minutes-ago calculation
- `hooks/useLiveData.ts` - `LiveDashboardPayload` extended with `snapshot_captured_at?: string`
- `app/live/page.tsx` - StaleBanner usage updated to pass `capturedAt={data?.snapshot_captured_at}`

## Decisions Made

- `snapshot_captured_at` added only to the DATA_DELAYED response branch — it is not meaningful in LIVE or NO_ACTIVE_GAME states, so it stays scoped to the outage path
- StaleBanner retains `generatedAt` prop for backward compatibility; fallback chain is `capturedAt ?? generatedAt`
- LiveDashboardPayload uses `snapshot_captured_at?: string` (optional) so type is safe for all three API response states without runtime guards

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- RELY-03 closed: DATA_DELAYED UI is correct and human-verified
- Phase 15 plans 01, 02, and 03 all complete — reliability and validation phase is done
- System is ready for any remaining phases or production hardening

---
*Phase: 15-reliability-and-validation*
*Completed: 2026-03-11*
