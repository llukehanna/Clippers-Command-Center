# External Integrations

**Analysis Date:** 2026-03-05

## APIs & External Services

**NBA Live Data (Primary Live Source):**
- NBA public live JSON endpoints - Live score, clock, period, live box score fields
  - SDK/Client: Direct HTTP fetch (no official SDK)
  - Auth: None documented (public endpoints)
  - Cadence: Every ~12 seconds during active Clippers games only
  - Failure behavior: Exponential backoff; UI serves last cached snapshot with `DATA_DELAYED` state

**BALLDONTLIE API (Historical + Schedule Source):**
- BallDontLie API (`balldontlie.io`) - Schedule, final box scores, player/team canonical IDs
  - SDK/Client: Direct HTTP fetch or unofficial SDK
  - Auth: API key (env var name TBD; stored in `.env`)
  - Cadence: Schedule refresh every 6 hours; final box scores polled until final status appears after game ends; reference data daily
  - Writes to: `games`, `game_team_box_scores`, `game_player_box_scores`, `players`, `teams`, `seasons`, `player_team_stints`

**Odds Provider (Vegas Odds):**
- External odds feed (provider not yet locked; examples cited: `theoddsapi`, `sportsdataio`)
  - SDK/Client: Direct HTTP via provider adapter layer (designed to be swappable)
  - Auth: API key (env var name TBD)
  - Cadence: Every 6 hours; optional extra refresh 2–3 hours before scheduled tip
  - Data: spread_home, spread_away, moneyline_home, moneyline_away, total_points
  - Failure behavior: Write nothing; UI returns `odds: null` — odds section hides, never fabricates
  - Writes to: `odds_snapshots` (append-only)

## Data Storage

**Databases:**
- PostgreSQL - Primary data store for all application data
  - Connection: Environment variable (connection string; name TBD, e.g., `DATABASE_URL`)
  - Client: Node.js PostgreSQL client (e.g., `pg`, `postgres`, or `@neondatabase/serverless`)
  - Provider: Neon (serverless Postgres, free tier) or Supabase Postgres
  - Extensions: `pgcrypto` (required for UUID generation)

**Core Tables:**
- `seasons` - Season metadata
- `teams` - All NBA teams (reference)
- `players` - All NBA players (reference)
- `player_team_stints` - Roster membership history
- `games` - All league games across ingested seasons (scheduled, in_progress, final)
- `game_team_box_scores` - Team box score per game (final)
- `game_player_box_scores` - Player box score per game (final)
- `live_snapshots` - Append-only live poll snapshots (~12s cadence during Clippers games)
- `advanced_team_game_stats` - Computed derived metrics (pace, ratings, eFG%, TS%)
- `advanced_player_game_stats` - Optional player-level derived metrics
- `rolling_team_stats` - Precomputed rolling windows (last 5, last 10 games)
- `rolling_player_stats` - Precomputed player rolling windows
- `odds_snapshots` - Append-only Vegas odds snapshots per game/provider
- `insights` - Provable insight records with `proof_sql`, `proof_params`, `proof_result`
- `app_kv` - Lightweight key-value store for job checkpointing and freshness tracking

**File Storage:**
- Local filesystem only (no blob storage integration)

**Caching:**
- No external cache (e.g., Redis) — caching via Next.js server-side `Cache-Control` headers
  - Live endpoints (`/api/live`): `Cache-Control: no-store`; optional 2–5 second in-memory cache for burst requests
  - Non-live endpoints (`/api/home`, `/api/schedule`): `Cache-Control: public, max-age=300`
  - Historical endpoints (`/api/history/*`): longer cache (hours) since DB is stable

## Authentication & Identity

**Auth Provider:**
- None — no user accounts or authentication in MVP
- All endpoints are public GET routes only
- Future expansion path exists but not designed for MVP

## Monitoring & Observability

**Error Tracking:**
- Not specified; no error tracking service detected

**Logs:**
- Job failure metadata stored in `app_kv` table
- Freshness tracking keys in `app_kv`:
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
- `healthcheck_data_freshness` job runs hourly and writes these keys

**Stale Data Signaling:**
- `/api/live` returns `state: "DATA_DELAYED"` when upstream fails repeatedly
- All API responses include `meta.stale` (boolean) and `meta.stale_reason` fields

## CI/CD & Deployment

**Hosting:**
- Vercel (web app + Next.js API routes)
- Alternative: Fly.io or Render (unified hosting)

**CI Pipeline:**
- GitHub Actions - Scheduled workflows for ingestion jobs:
  - Daily: `sync_reference_data`
  - Every 6 hours: `sync_schedule`, `sync_odds`
  - Every 10 min on game nights / 6 hours otherwise: `finalize_completed_games`
  - After finalization: `compute_advanced_stats` → `compute_rolling_windows` → `generate_insights_batch`
  - Hourly: `healthcheck_data_freshness`
  - Manual only: `backfill_historical_seasons`
- Live polling (`poll_live_clippers_game`) runs as application-side process or lightweight worker due to 12-second cadence

## Environment Configuration

**Required env vars (names TBD at implementation):**
- Database connection string (e.g., `DATABASE_URL`)
- BallDontLie API key
- Odds provider API key
- Any secrets required for hosting platform deployment

**Secrets location:**
- `.env` file (never committed to git)
- `.env.example` committed with placeholder values
- API keys must never be stored in the database

## Webhooks & Callbacks

**Incoming:**
- None — system is poll-based only; no webhooks expected from NBA or odds providers

**Outgoing:**
- None — no outbound webhook delivery

## External Data Scope

**Historical data seeded at launch:**
- 3 full NBA seasons (all teams, all players, all games)
- Populated via one-time `backfill_historical_seasons` job

**Future data source (post-MVP):**
- Basketball Reference scraping (deferred; architecture keeps path open)

---

*Integration audit: 2026-03-05*
