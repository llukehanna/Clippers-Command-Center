# Architecture

**Analysis Date:** 2026-03-05

## Pattern Overview

**Overall:** Three-tier web application with hybrid ingestion pipeline

**Key Characteristics:**
- Next.js (App Router) serves both frontend and backend via API routes — no separate backend process
- All writes come from background ingestion jobs; all API routes are read-only GET endpoints
- Data is precomputed and stored (rolling windows, advanced stats, insights) to keep API routes fast
- A "provable insight" constraint is enforced at the data layer: every insight row must carry `proof_sql`, `proof_params`, and `proof_result`
- UI operates in three distinct modes — Live Game, Between-Games (Home), and Historical Explorer — each backed by a dedicated page-shaped API endpoint

## Layers

**Frontend (React/Next.js pages):**
- Purpose: Render the dashboard for one of three modes; poll API on a cadence matching game state
- Location: `src/app/` (App Router convention, not yet scaffolded)
- Contains: Page components, chart wrappers, insight rotation tiles, box score tables
- Depends on: API layer
- Used by: End user (desktop browser)

**API Layer (Next.js API routes):**
- Purpose: Expose page-shaped JSON endpoints; aggregate data from DB and optionally generate live insights on demand
- Location: `src/app/api/` (e.g., `src/app/api/live/route.ts`, `src/app/api/home/route.ts`)
- Contains: Route handlers, caching headers, staleness metadata construction, live insight generation for `/api/live`
- Depends on: Database (PostgreSQL via connection pool), precomputed tables (`rolling_team_stats`, `rolling_player_stats`, `advanced_team_game_stats`, `insights`)
- Used by: Frontend pages

**Ingestion / Compute Jobs:**
- Purpose: Keep the database populated with fresh data from external providers; runs on scheduled cadence
- Location: Not yet scaffolded; planned as GitHub Actions scheduled workflows for slow jobs, app-side runner for live polling
- Contains: 10 named jobs (`sync_reference_data`, `sync_schedule`, `poll_live_clippers_game`, `finalize_completed_games`, `sync_odds`, `compute_advanced_stats`, `compute_rolling_windows`, `generate_insights_batch`, `backfill_historical_seasons`, `healthcheck_data_freshness`)
- Depends on: External APIs (NBA Live JSON, BALLDONTLIE, odds provider), PostgreSQL
- Used by: Nothing at runtime; writes to DB which API reads

**Database (PostgreSQL):**
- Purpose: Single source of truth for all historical, live-snapshot, derived, and insight data
- Location: Neon (serverless Postgres) or similar
- Schema: `Docs/DB_SCHEMA.sql`
- Key tables: `games`, `teams`, `players`, `player_team_stints`, `game_team_box_scores`, `game_player_box_scores`, `live_snapshots`, `advanced_team_game_stats`, `rolling_team_stats`, `rolling_player_stats`, `odds_snapshots`, `insights`, `app_kv`

## Data Flow

**Live Game Flow:**

1. `poll_live_clippers_game` job checks `games` table for an active Clippers game
2. If active: calls NBA Live JSON API (~12 second cadence), writes raw payload to `live_snapshots`, updates `games` row (score, period, clock)
3. Frontend polls `GET /api/live` every 12 seconds
4. `/api/live` reads latest `live_snapshots`, current `games` state, precomputed rolling stats, and optionally generates live insights on demand (deterministic, with proof payload)
5. Response includes `state: LIVE | NO_ACTIVE_GAME | DATA_DELAYED` so UI can handle upstream outages gracefully
6. Response caching: `Cache-Control: no-store`; optional 2–5 second in-memory cache for burst requests

**Historical / Batch Flow:**

1. `sync_schedule` keeps `games` current from BALLDONTLIE every 6 hours
2. `finalize_completed_games` detects status transitions to `final`, writes `game_team_box_scores` and `game_player_box_scores`
3. `compute_advanced_stats` runs immediately after finalization → writes `advanced_team_game_stats` and `advanced_player_game_stats`
4. `compute_rolling_windows` runs after advanced stats → writes `rolling_team_stats` and `rolling_player_stats`
5. `generate_insights_batch` runs after rolling windows → writes `insights` rows with `proof_sql + proof_result`
6. Frontend accesses this via `GET /api/home`, `GET /api/history/*`, `GET /api/players/{id}` with longer cache TTLs (5–60 minutes for non-live)

**State Management (frontend):**
- No global state store specified for MVP; each page polls its dedicated endpoint
- UI rotates 2–3 insight tiles locally from a pool returned by API (no layout shift constraint)

## Key Abstractions

**Page-Shaped API Endpoints:**
- Purpose: Each endpoint returns everything one UI page needs in a single response, minimizing client-side joins
- Examples:
  - `/api/live` — full live game dashboard payload
  - `/api/home` — full between-games dashboard payload
  - `/api/players/{player_id}` — full player trends page payload
- Pattern: Request → DB query of precomputed tables → JSON shape with `meta` object (staleness, TTL, source)

**Provable Insights:**
- Purpose: Every fact displayed to the user can be verified from stored data
- Table: `insights` in `Docs/DB_SCHEMA.sql`
- Pattern: Candidate insight is generated → proof SQL is executed → `proof_result` snapshot stored alongside insight → API only returns `is_active=true` insights with non-null `proof_result`
- Two generation paths: batch (via `generate_insights_batch` job) and on-demand for live scope (in `/api/live` handler)

**Provider Adapters (odds layer):**
- Purpose: Normalize different odds providers into a common schema; allows provider swap without schema change
- Pattern: Each ingestion job normalizes to `spread_home`, `spread_away`, `moneyline_home`, `moneyline_away`, `total_points` before inserting into `odds_snapshots`

**Rolling Stat Tables:**
- Purpose: Avoid expensive window-function queries at request time; precomputed rolling windows (last 5, last 10) for both teams and players
- Tables: `rolling_team_stats`, `rolling_player_stats`
- Pattern: API reads the row with highest `as_of_game_date` for the desired `window_games` value

**`app_kv` Checkpointing:**
- Purpose: Lightweight key-value store in PostgreSQL for job state, last-success timestamps, and backfill cursors
- Table: `app_kv`
- Pattern: Jobs write `last_success_at` keys; `healthcheck_data_freshness` reads them to determine staleness for UI `meta.stale` flags

## Entry Points

**Frontend Entry (Live Dashboard):**
- Location: `src/app/page.tsx` or `src/app/live/page.tsx` (to be scaffolded)
- Triggers: Browser navigation; auto-detects game state via `/api/live` response `state` field
- Responsibilities: Poll `/api/live` every 12 seconds; render scoreboard, box score, key metrics, rotating insights, other-games side panel

**Frontend Entry (Home/Between-Games):**
- Location: `src/app/home/page.tsx` (or default route when `state=NO_ACTIVE_GAME`)
- Triggers: Automatic when `/api/live` returns `NO_ACTIVE_GAME`
- Responsibilities: Render team snapshot, upcoming schedule with odds, player trend summaries, insight tiles

**API Entry (`/api/live`):**
- Location: `src/app/api/live/route.ts`
- Triggers: Frontend polling every 12 seconds
- Responsibilities: Read latest live snapshot + game state from DB; generate live insights on demand; return full page payload with staleness metadata; `Cache-Control: no-store`

**Ingestion Entry (`poll_live_clippers_game`):**
- Location: To be scaffolded; planned as app-side scheduled runner or GitHub Actions on game nights
- Triggers: Scheduled every 12 seconds while a Clippers game is active
- Responsibilities: Check for active game in `games`; call NBA Live API; insert into `live_snapshots`; update `games` row

## Error Handling

**Strategy:** Fail-safe — never overwrite good data with null on upstream failure; surface staleness explicitly in `meta.stale`

**Patterns:**
- If live provider fails: do not overwrite `games` fields; increment failure counter; return `DATA_DELAYED` state to UI
- Exponential backoff for repeated live poll failures (up to ~60 second ceiling)
- Per-game transaction boundaries in `finalize_completed_games` — partial writes roll back
- If insight cannot be proven: discard candidate (never display unverifiable insights)
- Odds missing: store nothing; return `odds: null` in API response
- API error envelope: `{ "error": { "code": "...", "message": "...", "details": {} } }` for all non-2xx responses

## Cross-Cutting Concerns

**Staleness signaling:** Every API response includes `meta.generated_at`, `meta.stale` (boolean), `meta.stale_reason`, and `meta.ttl_seconds`. The `healthcheck_data_freshness` job updates `app_kv` keys which API routes check to populate these fields.

**Idempotency:** All ingestion jobs must be safe to rerun — upsert semantics throughout, no duplicate rows on repeated execution.

**Caching strategy by endpoint:**
- `/api/live` — `Cache-Control: no-store`, optional 2–5 second in-memory burst cache
- `/api/home`, `/api/schedule` — `Cache-Control: public, max-age=300` (5 minutes)
- `/api/history/*` — long cache acceptable (hours); DB stable for finalized games
- `/api/players` — up to `max-age=3600`

**Clippers-first constraint:** All endpoints default to `team=LAC`; league data is fetched only to provide context for Clippers performance.

---

*Architecture analysis: 2026-03-05*
