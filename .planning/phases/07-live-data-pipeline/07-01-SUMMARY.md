---
phase: 07-live-data-pipeline
plan: 01
subsystem: api
tags: [typescript, nba, live-data, types, http-client]

# Dependency graph
requires:
  - phase: 06-insight-engine
    provides: ScoringEvent and LiveSnapshot interfaces that LiveGameState must be compatible with

provides:
  - src/lib/types/live.ts — shared LiveGameState and NBA API response types (zero runtime imports)
  - scripts/lib/nba-live-client.ts — NBA CDN HTTP client with clock parsing utilities

affects:
  - 07-02-poll-live (imports fetchScoreboard, parseNBAClock from nba-live-client)
  - 07-03-finalize-games (imports fetchBoxscore from nba-live-client)
  - 07-04-live-snapshots (imports fetchPlayByPlay, clockToSecondsRemaining)
  - 09-api-routes (imports LiveGameState from src/lib/types/live)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - NBA CDN fetch with AbortController and 15s timeout (mirrors bdl-client.ts)
    - ISO 8601 duration regex parsing for clock display and seconds conversion

key-files:
  created:
    - src/lib/types/live.ts
    - scripts/lib/nba-live-client.ts
  modified: []

key-decisions:
  - "src/lib/types/live.ts has zero runtime imports — pure type declarations only, safe to import from both scripts/ and Next.js app"
  - "NBA CDN HTTP client uses 15s timeout (vs 30s for BDL) — CDN is faster, shorter timeout avoids stale game state"
  - "parseNBAClock and clockToSecondsRemaining are pure functions with no side effects — only unit-testable parts of the client"

patterns-established:
  - "Clock parsing: /PT(\\d+)M([\\d.]+)S/ regex, parseInt for minutes, Math.floor(parseFloat()) for seconds"
  - "NBA CDN fetch pattern: nbaGet<T>(path) with AbortController timeout, typed generics, no retry (CDN is reliable)"

requirements-completed: [LIVE-12]

# Metrics
duration: 12min
completed: 2026-03-06
---

# Phase 7 Plan 01: Shared Types and NBA Live HTTP Client Summary

**TypeScript contract layer for Phase 7: shared LiveGameState types in src/lib/types/live.ts and NBA CDN HTTP client with ISO 8601 clock parsing in scripts/lib/nba-live-client.ts**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-06T23:05:00Z
- **Completed:** 2026-03-06T23:17:00Z
- **Tasks:** 2
- **Files modified:** 2 created

## Accomplishments
- Defined all NBA live JSON API response types (scoreboard, boxscore, play-by-play) matching verified endpoint shapes
- Defined LiveGameState application type for Phase 9 /api/live route with is_stale/stale_reason fields (LIVE-12)
- Implemented parseNBAClock converting "PT04M32.00S" -> "4:32" with proper zero-padding
- Implemented clockToSecondsRemaining for ScoringEvent.event_time_seconds construction
- All 9 unit tests passing GREEN via Vitest TDD cycle

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/lib/types/live.ts** - `984c431` (feat)
2. **Task 2: RED tests for clock parsing** - `339832a` (test) — pre-existing from prior session
3. **Task 2: Implement nba-live-client.ts** - `11b062a` (feat)

## Files Created/Modified
- `src/lib/types/live.ts` — NBAScoreboardResponse, NBABoxscoreResponse, NBAPlayByPlayResponse, ScoreboardGame, BoxscoreTeam, BoxscorePlayer, PlayerStatistics, TeamStatistics, PlayByPlayAction, LiveGameState
- `scripts/lib/nba-live-client.ts` — parseNBAClock, clockToSecondsRemaining, fetchScoreboard, fetchBoxscore, fetchPlayByPlay

## Decisions Made
- Zero-import types file: src/lib/types/live.ts contains only TypeScript interfaces — safe to import from both Next.js app and scripts/ without bundler conflicts
- 15s timeout: NBA CDN is a static JSON CDN, much faster than BDL API; 15s is generous for slow connections
- Pure function isolation: parseNBAClock and clockToSecondsRemaining have no side effects — enables deterministic unit testing without mocking

## Deviations from Plan

None — plan executed exactly as written. The RED test commit (339832a) pre-existed from a prior planning/research session; the implementation committed atomically in GREEN.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness
- Plan 02 (poll-live.ts) can now import fetchScoreboard and parseNBAClock from scripts/lib/nba-live-client.ts
- Phase 9 API routes can import LiveGameState from src/lib/types/live.ts
- All type contracts match verified NBA live JSON endpoint shapes

---
*Phase: 07-live-data-pipeline*
*Completed: 2026-03-06*
