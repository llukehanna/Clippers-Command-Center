---
plan: 07-04
phase: 07-live-data-pipeline
status: complete
completed: 2026-03-06
---

# 07-04 Summary: Poll-Live Polling Loop

## What Was Built

`scripts/poll-live.ts` — the long-running game-night polling loop, primary live data pipeline entry point.

## Key Files

### Created
- `scripts/poll-live.ts` — 306-line polling loop with full game-night functionality

## Tasks Completed

1. **DB integration layer** — `findActiveClippersGameInDB()` (30-min window query), `insertSnapshot()` (plain INSERT, no ON CONFLICT), `updateGamesRow()` (status/score updates)
2. **Main polling loop** — `pollLoop()` at 12s cadence, `buildRecentScoring()` (2-min lookback), `fetchRollingContext()` with correct schema column aliases, `finalizeGame()` stub, exponential backoff via `calculateBackoff()`

## Deviations

- **Auto-fixed (Rule 1):** Plan's `fetchRollingContext` query used `window_size`/`avg_points`/`avg_fg_pct` column names, but actual `rolling_team_stats` schema uses `window_games`/`off_rating`/`def_rating`/`efg_pct`/`pace`. Query updated to match real schema with proper aliases for `RollingTeamRow` interface.

## Commits

- `be57f4d` feat(07-04): implement scripts/poll-live.ts — game-night live polling loop

## Self-Check: PASSED

All must-haves implemented:
- ✓ 12s poll cadence via `POLL_INTERVAL_MS = 12_000`
- ✓ Append-only `INSERT INTO live_snapshots` (no ON CONFLICT)
- ✓ Console logs `[Q3 4:32] LAC 87 - OPP 82 | snapshot #N stored` format
- ✓ Exponential backoff on CDN failure (warns, does NOT exit)
- ✓ `generateLiveInsights` called on each successful poll
- ✓ Triggers `finalizeGame()` when `gameStatus === 3`
- ✓ Exits with "No active Clippers game found. Run npm run sync-schedule first." when no game
