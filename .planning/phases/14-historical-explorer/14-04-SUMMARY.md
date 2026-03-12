---
phase: 14-historical-explorer
plan: "04"
subsystem: ui
tags: [next.js, typescript, react, history, game-detail]

# Dependency graph
requires:
  - phase: 14-02
    provides: "Game detail API route and page shell with GameHeader / HistoryGameDetail"
  - phase: 14-03
    provides: "Schedule table and W/L status guards"
provides:
  - "game detail page reads correct nested abbreviations: game.home_team.abbreviation / game.away_team.abbreviation"
  - "boxScoreForDetail derives home?/away? from box_score.teams[] by team_abbr match before passing to HistoryGameDetail"
  - "mapPlayerRow returns id field required by BoxScoreRow interface (React key)"
affects:
  - "14-historical-explorer"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shape-contract adapter in RSC: derive named keys from API array before passing to typed component"

key-files:
  created: []
  modified:
    - "app/history/[game_id]/page.tsx"
    - "app/api/history/games/[game_id]/route.ts"

key-decisions:
  - "page.tsx adapts API shape (teams[] array) to HistoryGameDetail interface (home?/away? named keys) — no component changes needed"
  - "mapPlayerRow adds id alongside player_id for backward compat — BoxScoreRow uses id as React key"

patterns-established:
  - "RSC adapter pattern: consume API shape then map to component interface before JSX, not inside the component"

requirements-completed:
  - HIST-03

# Metrics
duration: 2min
completed: 2026-03-12
---

# Phase 14 Plan 04: Historical Explorer Summary

**Fixed 3 shape-contract bugs in game detail page: team abbreviations now read from nested objects, box_score.teams[] mapped to home?/away? for HistoryGameDetail, and mapPlayerRow returns id field for BoxScoreRow React keys**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-12T02:01:17Z
- **Completed:** 2026-03-12T02:03:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Game detail page now reads `game.home_team.abbreviation` and `game.away_team.abbreviation` (previously used undefined `game.home_abbr`)
- `boxScoreForDetail` correctly derives `home?` and `away?` entries from `box_score.teams[]` by `team_abbr` match — HistoryGameDetail receives the shape it expects
- `mapPlayerRow` now returns `id: p.player_id` so BoxScoreTable row keys are defined strings (prevents React key warning and potential render bugs)
- TypeScript compiles clean (zero errors); 142 vitest tests pass with no regressions

## Task Commits

1. **Task 1: Fix page.tsx — read nested abbreviations and derive home/away from teams[]** - `a3a22bd` (fix)
2. **Task 2: Fix mapPlayerRow — add id field required by BoxScoreRow** - `3395701` (fix)

## Files Created/Modified
- `app/history/[game_id]/page.tsx` - Fixed abbreviation field access, added boxScoreForDetail adapter, updated GameHeader/HistoryGameDetail props
- `app/api/history/games/[game_id]/route.ts` - Added `id: p.player_id` to mapPlayerRow return object

## Decisions Made
- page.tsx adapts the API shape (teams[] array) to the HistoryGameDetail interface (home?/away? named keys) — no component changes needed, adapter logic lives in the RSC page shell
- mapPlayerRow adds `id` alongside `player_id` for backward compatibility — BoxScoreRow uses `id` as React key

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- HIST-03 closed: game detail page renders real team abbreviations, W/L badge, and player box score rows at runtime
- Phase 14 historical explorer is complete — all four plans executed
- No blockers for subsequent phases

---
*Phase: 14-historical-explorer*
*Completed: 2026-03-12*
