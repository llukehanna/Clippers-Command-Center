# INGESTION_PLAN.md

This document defines the MVP ingestion, polling, compute, and refresh jobs for **Clippers Command Center (CCC)**.

It answers:

- what jobs exist
- when they run
- what each job reads
- what each job writes
- how failures are handled
- what “good enough to ship” means operationally

This plan assumes the architecture in `ARCHITECTURE.md` and the schema in `DB_SCHEMA.sql`.

---

# 1) Ingestion Philosophy

CCC uses a **hybrid ingestion model**:

1. **Live polling** for active Clippers games
2. **Scheduled refreshes** for schedule and odds
3. **Post-game finalization jobs** for official box scores and derived stats
4. **Batch jobs** for historical backfill and rolling aggregates

The system must prefer:

- correctness over aggressiveness
- explicit stale states over fake freshness
- append-only snapshots where useful
- idempotent jobs wherever possible

---

# 2) Job Inventory

MVP jobs:

1. `sync_reference_data`
2. `sync_schedule`
3. `poll_live_clippers_game`
4. `finalize_completed_games`
5. `sync_odds`
6. `compute_advanced_stats`
7. `compute_rolling_windows`
8. `generate_insights_batch`
9. `backfill_historical_seasons`
10. `healthcheck_data_freshness`

---

# 3) Core Scheduling Strategy

Recommended MVP schedule:

- **Reference data**: daily
- **Schedule sync**: every 6 hours
- **Odds sync**: every 6 hours, plus closer to next game
- **Live polling**: every ~12 seconds during active Clippers games only
- **Finalize completed games**: every 10 minutes on game nights, every 6 hours otherwise
- **Advanced stats**: immediately after a game is finalized, plus nightly safety run
- **Rolling windows**: immediately after advanced stats run, plus nightly safety run
- **Insight generation**: immediately after rolling windows, plus nightly safety run
- **Healthcheck**: every hour

---

# 4) Job Specifications

## 4.1 `sync_reference_data`

### Purpose
Keep `teams`, `players`, and season metadata consistent.

### Trigger
- daily scheduled job
- manual run allowed

### Reads
- BALLDONTLIE or canonical provider
- existing DB records in:
  - `teams`
  - `players`
  - `seasons`
  - `player_team_stints`

### Writes
- upsert `teams`
- upsert `players`
- upsert `seasons`
- insert/update `player_team_stints`

### Idempotency
Must be idempotent:
- same upstream payload should not create duplicate rows

### Failure Handling
- if provider unavailable, leave current reference data unchanged
- log failure in job logs / `app_kv`
- do not block other jobs

---

## 4.2 `sync_schedule`

### Purpose
Keep upcoming and recent Clippers games current in `games`.

### Trigger
- every 6 hours
- manual run allowed

### Reads
- schedule endpoint / non-live provider
- existing `games`

### Writes
- upsert rows in `games`
- update:
  - `game_date`
  - `start_time_utc`
  - `status`
  - `home_team_id`
  - `away_team_id`
  - `season_id`
  - `is_playoffs` if known

### Scope
MVP minimum:
- current season upcoming games
- recent completed games if status changed late

### Rules
- never delete past games automatically
- status transitions must be monotonic where possible:
  - `scheduled` → `in_progress` → `final`

### Failure Handling
- if provider unavailable, keep existing schedule
- `home` and `schedule` pages should continue using cached DB data

---

## 4.3 `poll_live_clippers_game`

### Purpose
Poll live game state during active Clippers games and store dense snapshots.

### Trigger
- every ~12 seconds **only when a Clippers game is active**

### Activation Logic
Before polling:
1. query `games` for a Clippers game whose status suggests in-progress OR scheduled near now
2. if no candidate exists, do not run continuous live polling
3. if candidate exists, call live API and confirm current state

### Reads
- live NBA endpoint
- `games`
- optionally latest `live_snapshots`

### Writes
- insert into `live_snapshots`
- update current `games` row fields:
  - `status`
  - `period`
  - `clock`
  - `home_score`
  - `away_score`
  - `updated_at`

### Snapshot Contract
Every successful live poll must insert a row into `live_snapshots` with:
- `game_id`
- `captured_at`
- extracted core state
- full raw `payload`

### Why append-only snapshots?
This allows:
- run detection
- momentum reconstruction
- debugging
- stale/live comparisons

### Failure Handling
If live provider fails:
1. do not overwrite last known good values with nulls
2. do not insert fake snapshot
3. increment failure counter in runtime state
4. UI should continue to use last cached good snapshot
5. if repeated failures occur, `/api/live` should return `state=DATA_DELAYED`

### Backoff Strategy
- first failure: retry on next normal cycle
- repeated failures: exponential backoff up to a reasonable ceiling (e.g. 60 seconds)
- once upstream recovers, return to normal cadence

---

## 4.4 `finalize_completed_games`

### Purpose
Convert completed games into stable historical records with full box scores.

### Source
**NBA live JSON** — public, key-free, no rate limit concerns.
Box score endpoint: `cdn.nba.com/static/json/liveData/boxscore/boxscore_{gameId}.json`

BALLDONTLIE `/stats` is **not used** for finalization (5 req/min free tier makes multi-game batches impractical).

### Trigger
- every 10 minutes on active game nights
- every 6 hours otherwise
- manual run allowed

### Reads
- NBA live JSON boxscore endpoint for each candidate game
- candidate games in `games` with:
  - `status != final` OR
  - recent completion window and incomplete downstream tables

### Writes
- update `games.status = final`, `home_score`, `away_score`
- upsert `game_team_box_scores` (one row per team per game)
- upsert `game_player_box_scores` (one row per player per game)

### Rules
A game is finalized only when:
- NBA live JSON `gameStatus = Final`
- both team scores are non-null
- player box score rows are present

### Failure Handling
- partial writes must not leave duplicate rows — use transaction per game
- if player box score write fails, mark job incomplete and retry
- if NBA live JSON is unavailable, leave existing data unchanged

---

## 4.5 `sync_odds`

### Purpose
Refresh pregame Vegas odds for upcoming Clippers games.

### Trigger
- every 6 hours
- optional extra run:
  - 2–3 hours before scheduled tip for the next game

### Reads
- free odds provider
- upcoming Clippers games from `games`

### Writes
- insert append-only rows into `odds_snapshots`

### Rules
- provider adapter layer must normalize:
  - spread_home
  - spread_away
  - moneyline_home
  - moneyline_away
  - total_points
- do not overwrite old odds rows; snapshots are historical
- UI should use the latest snapshot for each game

### Failure Handling
- if provider unavailable or payload invalid:
  - write nothing
  - keep previous odds rows
  - UI returns `odds: null` if nothing valid exists

---

## 4.6 `compute_advanced_stats`

### Purpose
Compute derived stats after final box scores exist.

### Trigger
- immediately after `finalize_completed_games`
- nightly safety run
- manual run allowed

### Reads
- `games`
- `game_team_box_scores`
- `game_player_box_scores`

### Writes
- upsert `advanced_team_game_stats`
- optionally upsert `advanced_player_game_stats`

### Metrics
Minimum MVP metrics:
- possessions
- pace
- offensive rating
- defensive rating
- net rating
- eFG%
- TS%
- turnover rate
- rebound rate

### Rules
- only compute for games with final sufficient box score data
- calculations must be deterministic
- reruns must upsert cleanly

### Failure Handling
- if one game fails, continue with others and log failure list
- failed game IDs should be stored for retry

---

## 4.7 `compute_rolling_windows`

### Purpose
Precompute rolling team/player windows for fast dashboard access.

### Trigger
- immediately after `compute_advanced_stats`
- nightly safety run
- manual run allowed

### Reads
- `advanced_team_game_stats`
- `advanced_player_game_stats`
- `game_team_box_scores`
- `game_player_box_scores`
- `games`

### Writes
- upsert `rolling_team_stats`
- upsert `rolling_player_stats`

### Window Sizes
MVP:
- 5 games
- 10 games

Optional later:
- 20 games
- season-to-date

### Rules
- `as_of_game_date` should represent the final game in the window
- reruns must replace/upsert, not duplicate

---

## 4.8 `generate_insights_batch`

### Purpose
Generate provable insights for between-games and historical contexts.

### Trigger
- immediately after rolling windows update
- nightly safety run
- manual run allowed

### Reads
- all relevant history/advanced/rolling tables
- existing `insights`

### Writes
- insert/update `insights`

### Scopes Covered
- `between_games`
- `historical`

### MVP Insight Categories
- player streaks
- team streaks
- milestones
- rare events
- comparisons
- opponent context
- league comparisons

### Proof Requirements
Every inserted insight must include:
- `proof_sql`
- `proof_params`
- `proof_result`

If proof cannot be produced:
- discard the candidate insight

### Conflict Strategy
If the same logical insight already exists:
- update existing row rather than insert duplicate
- ideally compare via deterministic fingerprint / hash

---

## 4.9 `backfill_historical_seasons`

### Purpose
One-time seed of 3-season reference and schedule data from BALLDONTLIE.

### Scope (MVP)
Populates:
- `teams`, `players`, `seasons` — reference data
- `games` — schedule rows with metadata and final scores for 2022–2024

**Excludes from MVP backfill:**
- `game_team_box_scores` / `game_player_box_scores` — BALLDONTLIE free tier (5 req/min) makes 3-season stats ingestion impractical. Historical box scores for games before the live pipeline existed can be added in a future milestone using a paid BDL tier or an alternative historical source.

### Trigger
- manual (one-time seed)
- safe to re-run (fully idempotent)

### Reads
- BALLDONTLIE `/teams`, `/players`, `/games`

### Writes
- `teams`, `players`, `seasons`, `games`

### Rules
- resumable via `app_kv` season checkpoints
- process season-by-season
- upsert all game statuses (scheduled, in-progress, final) — live poller updates scores going forward

### Extensibility
The schema (`game_team_box_scores`, `game_player_box_scores`, `advanced_team_game_stats`, etc.) is fully in place. Richer historical ingestion can be layered in by:
- upgrading to a paid BDL tier and running `/stats` batches
- using an alternative historical provider
- writing a one-off migration script against any source that covers the gap

---

## 4.10 `healthcheck_data_freshness`

### Purpose
Monitor whether expected data is fresh enough for the UI to trust.

### Trigger
- every hour
- more often on game nights if desired

### Reads
- `games`
- latest `live_snapshots`
- latest `odds_snapshots`
- `app_kv` job markers

### Writes
- `app_kv` status entries, for example:
  - `last_live_snapshot_at`
  - `last_schedule_sync_at`
  - `last_odds_sync_at`
  - `last_finalize_run_at`
  - `last_advanced_stats_run_at`

### Responsibilities
- determine whether live data is stale
- determine whether odds are stale
- determine whether final box scores are missing for games marked complete

### UI Impact
This job does not directly power UI, but it helps produce:
- stale banners
- operational visibility
- easier debugging

---

# 5) Job Dependency Graph

```text
sync_reference_data
      │
      ├── sync_schedule
      │       └── sync_odds
      │
      └── backfill_historical_seasons
               └── finalize_completed_games
                        └── compute_advanced_stats
                                 └── compute_rolling_windows
                                          └── generate_insights_batch

poll_live_clippers_game
      └── live-facing API and optional live insight generation

healthcheck_data_freshness
      └── monitors everything
```

---

# 6) Live Insight Generation Strategy

Live insights are slightly different from batch insights.

## Recommended MVP approach
Do **not** run a separate heavy background job every 12 seconds.

Instead:
- poll and store live snapshots
- have `/api/live` generate a small live insight set on demand using:
  - current game snapshot
  - recent rolling stats
  - historical stats as needed
- optionally cache this result briefly (2–5 seconds)

## Why?
This is simpler, cheaper, and easier to debug for MVP.

## Rule
Even if generated on demand, live insights must still be:
- deterministic
- provable from DB + current snapshot
- returned with proof summary/result payload

---

# 7) Runtime State and Checkpoints

Use `app_kv` for lightweight checkpointing.

Recommended keys:
- `reference_sync:last_success_at`
- `schedule_sync:last_success_at`
- `odds_sync:last_success_at`
- `finalize_games:last_success_at`
- `advanced_stats:last_success_at`
- `rolling_stats:last_success_at`
- `insights_batch:last_success_at`
- `historical_backfill:last_cursor`
- `historical_backfill:last_completed_season`
- `live_poll:last_snapshot_at:{game_id}`

This keeps the system resumable and observable.

---

# 8) Failure Policy

## General Rules
- Jobs must be idempotent where possible
- Per-game operations should be transactional
- Partial failures should be retryable
- Do not delete good data because upstream is temporarily worse

## Upstream Outage Rules
If an upstream source fails:
- preserve last known good DB state
- record failure metadata
- surface stale state to API/UI where relevant

## Bad Payload Rules
If a payload is malformed:
- reject that record
- log enough detail to debug
- continue processing other independent records

---

# 9) Shipping Checklist for Ingestion

The ingestion system is ship-ready when:

- schedule sync populates upcoming Clippers games correctly
- live polling captures snapshots every ~12 seconds during an active game
- final box scores ingest correctly after games end
- advanced stats populate for finalized games
- rolling windows populate for team/player trends
- batch insights generate with proof payloads
- odds snapshots store and latest odds appear in schedule/home
- stale or delayed upstream data does not crash UI
- all jobs can be rerun safely

---

# 10) Recommended MVP Implementation Order

Build jobs in this order:

1. `sync_reference_data`
2. `sync_schedule`
3. `finalize_completed_games`
4. `compute_advanced_stats`
5. `compute_rolling_windows`
6. `generate_insights_batch`
7. `sync_odds`
8. `poll_live_clippers_game`
9. `healthcheck_data_freshness`
10. `backfill_historical_seasons`

Why this order:
- get stable historical/base data working first
- prove stats and insights pipeline
- then add live complexity
- then add observability/health

---

# 11) Operational Recommendation

For MVP, run jobs through **GitHub Actions scheduled workflows** wherever possible, except:

- `poll_live_clippers_game` should be triggered only on game nights / active games and may be easier as an application-side scheduled process or short-lived repeated runner

If GitHub Actions is too awkward for 12-second cadence:
- move live polling to the app host or a lightweight worker
- keep all slower cadence jobs in scheduled workflows

This split is practical and tailored to the product.
