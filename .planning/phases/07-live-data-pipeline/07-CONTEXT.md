# Phase 7: Live Data Pipeline - Context

**Gathered:** 2026-03-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the live polling engine for Clippers games: detect active games, poll NBA live JSON at ~12s cadence, store append-only snapshots, wire in live insight detection (scoring runs + clutch alerts), and finalize box scores after games complete. Covers `poll-live`, `finalize-games`, and `sync-schedule` scripts. API layer (/api/live) is Phase 9; UI is Phase 11.

</domain>

<decisions>
## Implementation Decisions

### Poller execution model
- `npm run poll-live` — a long-running Node process started manually before a game
- Auto-exits when game reaches Final status (no manual Ctrl+C needed)
- One log line per poll: e.g. `[Q3 4:32] LAC 87 - MIA 82 | snapshot #47 stored`
- On API failure: warn and continue with exponential backoff (up to ~60s ceiling); do NOT exit on first failure
- Failure counter shown in warning lines; normal cadence resumes when API recovers

### Finalization trigger
- Poller triggers finalization inline when it detects `gameStatus = Final` — same process, before exiting
- Finalization retries up to 3 times with 60s delay if player box score rows are absent (NBA API lag)
- Also build a standalone `npm run finalize-games` script for catch-up runs (games missed when poll-live wasn't running)
- Both scripts use the NBA live JSON boxscore endpoint: `cdn.nba.com/static/json/liveData/boxscore/boxscore_{gameId}.json`

### Script and code location
- All Phase 7 scripts follow `scripts/` pattern: `scripts/poll-live.ts`, `scripts/finalize-games.ts`, `scripts/sync-schedule.ts`
- NBA Live JSON HTTP logic extracted to `scripts/lib/nba-live-client.ts` — mirrors `bdl-client.ts` pattern
  - Encapsulates all endpoint URLs, fetch logic, and response type definitions
- Shared TypeScript types (`LiveSnapshot`, `LiveGameState`, etc.) written to `src/lib/types/` so Phase 9 API routes can import them without depending on scripts/

### Pre-game detection window
- `poll-live` queries `games` table for a Clippers game with `status = 'in_progress'` OR `status = 'scheduled'` with start time within 30 minutes
- If no candidate found: exit with message "No active Clippers game found."
- Pre-game snapshots (period=0 or null before tip-off) are stored normally — every successful poll writes a snapshot, logged as pre-game
- `sync-schedule.ts` (also built in Phase 7) keeps `games` table current using BALLDONTLIE /games for recent + upcoming Clippers games

### Phase 7 scope also includes
- `npm run sync-schedule` — keeps games table current (status, scores, upcoming games) via BALLDONTLIE
- Wires `generateLiveInsights(snapshot, rollingData)` from Phase 6 `src/lib/insights/live.ts` into the poll loop
- Live insights are transient — not stored in DB, returned by `/api/live` in Phase 9

### Claude's Discretion
- Exact NBA live JSON endpoint URLs and field mapping to `live_snapshots` columns
- Polling loop implementation details (setInterval vs async loop with sleep)
- app_kv key names for tracking last poll time and failure counters
- Console output format for finalize-games and sync-schedule (mirror backfill/compute-stats style)
- Whether to add `--dry-run` flag to any scripts

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/lib/db.ts`: `sql` template tag — use for all DB queries in poll-live, finalize-games, sync-schedule
- `scripts/lib/bdl-client.ts`: Pattern to mirror for `nba-live-client.ts` (HTTP client with typed responses)
- `scripts/lib/upserts.ts`: Upsert helpers — finalize-games will add upserts for `game_team_box_scores` / `game_player_box_scores`
- `src/lib/insights/live.ts`: `generateLiveInsights(snapshot, rollingData)` already built — Phase 7 calls this in the poll loop
- `app_kv` table: checkpoint pattern for job state tracking

### Established Patterns
- `scripts/` directory with `npm run` entry points — all Phase 4, 5, 6 jobs follow this
- Idempotent upserts (ON CONFLICT DO UPDATE) for all DB writes
- Console progress: one line per operation + summary at end (mirror backfill style)
- `scripts/lib/` for shared library modules (db, clients, utilities)

### Integration Points
- `live_snapshots` table: `game_id`, `captured_at`, `provider_ts`, `period`, `clock`, `home_score`, `away_score`, `payload` (JSONB) — Phase 7 writes here
- `games` table: poll-live updates `status`, `period`, `clock`, `home_score`, `away_score`, `updated_at`; sync-schedule upserts upcoming game rows
- `game_team_box_scores` / `game_player_box_scores`: finalize-games writes here from NBA boxscore endpoint
- `src/lib/insights/live.ts`: poll-live calls `generateLiveInsights` on each snapshot (transient, not stored)
- `src/lib/types/`: new — shared TypeScript types for Phase 9 API route compatibility

</code_context>

<specifics>
## Specific Ideas

- `npm run poll-live` — start it before tip, walk away. It logs each poll, handles failures, and exits cleanly on Final.
- `npm run sync-schedule` — run this before poll-live to ensure the game is in the DB with correct status
- `npm run finalize-games` — catch-up script for any nights you didn't run poll-live
- The three scripts together form the live data operations playbook for game nights

</specifics>

<deferred>
## Deferred Ideas

- GitHub Actions cron for finalize-games (10-minute cadence on game nights) — Phase 16 (MVP Launch / deployment)
- Vercel Cron for sync-schedule — deployment phase
- "Waiting mode" for poll-live (slow pre-game check every 5 min) — not in Phase 7 scope

</deferred>

---

*Phase: 07-live-data-pipeline*
*Context gathered: 2026-03-06*
