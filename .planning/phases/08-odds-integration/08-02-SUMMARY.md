---
phase: 08-odds-integration
plan: "02"
subsystem: infra
tags: [odds, http-client, typescript, github-actions, cron, postgres]

# Dependency graph
requires:
  - phase: 08-odds-integration
    provides: OddsAdapter interface, OddsEvent/OddsSnapshot types, scripts/lib/db.ts sql tag, setCheckpoint helper
provides:
  - TheOddsApiAdapter implementing OddsAdapter (ODDS-01, ODDS-04)
  - scripts/sync-odds.ts orchestrator that fetches, filters, and inserts Clippers odds
  - .github/workflows/sync-odds.yml cron workflow running every 6 hours
  - npm run sync-odds script entry point
affects:
  - Phase 9 API routes (odds data in odds_snapshots available for getLatestOdds)
  - Phase 16 deployment (GitHub Actions workflow wires 6-hour cadence)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - AbortController timeout pattern (30s) mirrors nbaGet pattern from nba-live-client.ts
    - Single bulk HTTP call for all NBA odds — no per-game endpoints
    - Optional chaining throughout parseEvent for missing market fields (never throw on missing market)
    - Prefer first bookmaker with all three markets (h2h, spreads, totals); fall back to first bookmaker
    - teams table ILIKE '%clippers%' for robust LAC team_id lookup without hardcoding
    - ON CONFLICT (game_id, provider, captured_at) DO NOTHING for append-only ingestion
    - Provider failure exits 0 with console.warn — never crashes the cron

key-files:
  created:
    - scripts/lib/odds-client.ts
    - scripts/sync-odds.ts
    - .github/workflows/sync-odds.yml
  modified:
    - package.json

key-decisions:
  - "TheOddsApiAdapter throws at construction time if ODDS_API_KEY missing — startup guard, not runtime surprise"
  - "sync-odds.ts outer try/catch catches provider failures and exits 0 — cron never fails permanently on API unavailability"
  - "Game matching uses game_date (first 10 chars of commence_time) + teams ILIKE — avoids hardcoded team IDs"
  - "raw_payload stores OddsEvent fields as JSON for audit/debugging without needing to re-fetch"

patterns-established:
  - "oddsGet<T> mirrors nbaGet<T>: AbortController, setTimeout, !res.ok throw, AbortError rethrow as TIMEOUT, clearTimeout in finally"
  - "Provider swapping = change adapter instantiation in sync-odds.ts only — no other files change"

requirements-completed: [ODDS-01, ODDS-04]

# Metrics
duration: 2min
completed: 2026-03-07
---

# Phase 8 Plan 02: TheOddsApiAdapter HTTP Client and Sync Orchestrator Summary

**TheOddsApiAdapter bulk-fetching NBA odds from The Odds API v4, sync-odds.ts filtering to Clippers games and inserting append-only into odds_snapshots, and a 6-hour GitHub Actions cron workflow**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-07T00:22:00Z
- **Completed:** 2026-03-07T00:24:46Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- TheOddsApiAdapter implements OddsAdapter with a single bulk HTTP call, 30s timeout, and bookmaker selection logic
- sync-odds.ts orchestrates fetch → filter to Clippers → game_id lookup → INSERT ON CONFLICT DO NOTHING → checkpoint
- .github/workflows/sync-odds.yml wires the 6-hour cron and workflow_dispatch manual trigger

## Task Commits

Each task was committed atomically:

1. **Task 1: TheOddsApiAdapter HTTP client** - `0ac36c8` (feat)
2. **Task 2: sync-odds orchestrator + npm script + GitHub Actions workflow** - `88402ff` (feat)

## Files Created/Modified
- `scripts/lib/odds-client.ts` - TheOddsApiAdapter implementing OddsAdapter: oddsGet helper with AbortController, parseEvent with optional chaining for all market fields
- `scripts/sync-odds.ts` - Orchestrator: ODDS_API_KEY guard, fetch, filter to Clippers, game_id lookup, INSERT ON CONFLICT DO NOTHING, setCheckpoint
- `.github/workflows/sync-odds.yml` - Cron `0 */6 * * *` + workflow_dispatch; DATABASE_URL and ODDS_API_KEY from secrets
- `package.json` - sync-odds script already registered (was pre-existing from prior work)

## Decisions Made
- TheOddsApiAdapter throws at construction if ODDS_API_KEY is missing — fails fast at startup before any HTTP call
- Provider failure in the try/catch exits with process.exit(0) and console.warn — non-fatal per locked design decision
- Bookmaker selection prefers first with all three markets (h2h, spreads, totals), falls back to first bookmaker
- Game matching uses `game_date = commence_time.slice(0,10)` + `teams.name ILIKE '%clippers%'` — robust without hardcoded IDs

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
- Add `ODDS_API_KEY` to GitHub repository secrets for the sync-odds workflow to run in CI
- Add `DATABASE_URL` to GitHub repository secrets (likely already present from other workflows)
- Locally: add `ODDS_API_KEY=<key>` to `.env.local` before running `npm run sync-odds`

## Next Phase Readiness
- odds_snapshots ingestion pipeline is complete and functional
- getLatestOdds (Phase 08-01) and TheOddsApiAdapter (this plan) are both ready for Phase 9 API route consumption
- GitHub Actions cron wires Phase 16 deployment cadence automatically

## Self-Check: PASSED
- scripts/lib/odds-client.ts: FOUND
- scripts/sync-odds.ts: FOUND
- .github/workflows/sync-odds.yml: FOUND
- 08-02-SUMMARY.md: FOUND
- Commit 0ac36c8 (Task 1): FOUND
- Commit 88402ff (Task 2): FOUND

---
*Phase: 08-odds-integration*
*Completed: 2026-03-07*
