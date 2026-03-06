# ARCHITECTURE.md

Clippers Command Center (CCC) architecture for the MVP.

This document locks the system shape so implementation can proceed without rework.

---

# 1) Product Scope (MVP)

MVP supports three core user modes:

1. **Live Game Dashboard** (highest priority)
   - When a Clippers game is active, show:
     - scoreboard + time
     - dense box score
     - key live metrics
     - 2–3 rotating “provable” insights tied to game moment and team context
     - Clippers-relevant league context (small side panel)

2. **Between-Games Dashboard (Home)**
   - When no game is active:
     - macro team snapshot
     - upcoming schedule + Vegas odds
     - player trend summaries
     - rotating “provable” insights (macro)

3. **Historical Explorer**
   - Browse past seasons/games and see:
     - box score
     - provable historical insights
     - player performance trend views

Desktop/laptop only for MVP.

---

# 2) Tech Stack (Recommended)

## Frontend / Web App
- **Next.js (App Router) + TypeScript**
- UI components: **shadcn/ui**
- Styling: Tailwind (consistent with design system)
- Charts: Recharts (or equivalent), chosen for speed of implementation

## Backend
- Next.js API routes:
  - Page-shaped endpoints (see `docs/API_SPEC.md`)
  - Lightweight server-side caching
- No auth for MVP.

## Database
- **PostgreSQL**
- Schema per `docs/DB_SCHEMA.sql`

## Hosting (MVP-appropriate defaults)
Pick one of these two:

### Option A (fastest)
- Web + API: Vercel
- Postgres: Neon (or Supabase Postgres)
- Cron: GitHub Actions scheduled workflows (free)

### Option B (more unified, still simple)
- Web + API + Cron: Fly.io or Render
- Postgres: managed Postgres

MVP should optimize for low friction. Option A is typically the easiest.

---

# 3) High-Level Component Diagram

```text
                ┌────────────────────────────────────┐
                │              Next.js                │
                │  Pages (UI) + API Routes (/api/*)   │
                └────────────────────────────────────┘
                           │                 │
                           │ reads/writes    │ reads
                           ▼                 ▼
                ┌──────────────────┐   ┌───────────────────┐
                │   PostgreSQL DB   │   │ External Providers │
                │ (history + live)  │   │ NBA Live / BDL /   │
                └──────────────────┘   │ Odds Provider      │
                           ▲            └───────────────────┘
                           │
                           │ scheduled jobs / triggers
                           ▼
                ┌────────────────────────────────────┐
                │       Ingestion + Compute Jobs      │
                │ (GH Actions cron or app scheduler)  │
                └────────────────────────────────────┘
```

---

# 4) Data Sources and Responsibilities

## Source: NBA Live JSON (live + post-game)
Use for:
- live score / clock / period
- live box score fields during active games
- **post-game final box score** (team and player stats after game ends)
- live context signals

Cadence:
- **~12 seconds** during active Clippers games only.
- **post-game finalization**: poll until `gameStatus = Final`, then write box scores to `game_team_box_scores` / `game_player_box_scores`.

Storage:
- store raw payloads into `live_snapshots` (append-only)
- store extracted current state into `games` fields (score/period/clock)
- write final box scores to `game_team_box_scores` and `game_player_box_scores` after game ends

Notes:
- live source may be volatile; always support “data delayed” states.
- never invent missing fields.
- NBA live JSON is public and key-free; no rate limit concerns.

## Source: BALLDONTLIE (reference + schedule)
Use for:
- teams and players (canonical IDs, metadata)
- game schedule and metadata (dates, opponents, status, final scores)

**Not used for:**
- box scores — NBA live JSON finalizes these post-game
- player stats — not feasible at free tier (5 req/min)

Cadence:
- reference data (teams/players): daily refresh
- schedule sync: every 6 hours

Storage:
- `teams`, `players`, `seasons`, `player_team_stints`
- `games` (schedule rows — scores/status updated by live poller)

## Source: Odds Provider (Vegas odds)
Use for:
- spreads, moneylines, totals

Cadence:
- pregame odds refresh every 6 hours, plus an additional refresh closer to tip (optional)
- live odds are out of scope unless easy

Storage:
- `odds_snapshots` (append-only snapshots)

Rules:
- if odds missing, store nothing and return null to UI

---

# 5) Computation and Derived Data

## Advanced stats
Compute after final box scores are available:
- possessions, pace
- off/def/net rating
- eFG%, TS%
- turnover/rebound rates

Storage:
- `advanced_team_game_stats`
- optionally `advanced_player_game_stats`

## Rolling windows
Compute:
- last 5 / last 10 team stats
- last 5 / last 10 player stats

Storage:
- `rolling_team_stats`
- `rolling_player_stats`

Cadence:
- after each game final ingestion
- optionally nightly backfill

---

# 6) Insight System Architecture (Provable Insights)

## Requirement
Insights must be **provable**:

- Each insight includes a proof query and proof result snapshot.
- The UI only displays insights that include valid proof payloads.
- No “mostly true” facts.

## Data Model
Insights are stored in `insights` table:

- scope: `live | between_games | historical`
- target: team/game/player/season ids
- text: headline + detail
- selection: importance score and active flag
- proof: `proof_sql`, `proof_params`, `proof_result`, optional `proof_hash`

## Generation Lifecycle

### Between-games / historical insights (batch)
Triggered:
- after a final box score is ingested
- during backfill runs
- optionally nightly

Process:
1. pull required game/player/team stats from DB
2. run insight rules to generate candidate insights
3. validate each with proof query
4. insert/update insights as active with proof_result snapshot

### Live insights (near-live)
Triggered:
- during live polling, or on request in `/api/live` if fast enough

MVP approach recommendation:
- generate a small set of live insights using the latest known live state + recent rolling windows
- write them to DB with a short TTL (`valid_to`) OR generate in-memory in API route
- always include proof snapshot (can be a compact computed proof object, but it must be derived deterministically from DB/live payloads)

## Selection and Rotation
- server returns a pool sorted by `importance`
- client displays **2–3 rotating** tiles at a time
- rotation must not cause layout shift (wireframe constraint)

---

# 7) API Layer Responsibilities

API contract lives in `docs/API_SPEC.md`.

Key characteristics:
- Page-shaped endpoints: `/api/live`, `/api/home`, etc.
- Include staleness metadata
- Avoid excessive joining on every request by relying on:
  - rolling tables
  - precomputed advanced stats
  - cached “current game” state

---

# 8) Caching Strategy

## Live
- `/api/live` should be `no-store`
- still acceptable to do **short in-memory caching** (e.g., 2–5 seconds) if multiple UI components request simultaneously

## Non-live
- `/api/home`, `/api/schedule` can be cached server-side for 1–5 minutes without harming correctness
- `/api/history/*` can cache longer (hours), since the DB is stable

## Cache Invalidation
Primary invalidation triggers:
- on new live snapshot ingestion (live views)
- on final box score ingestion (home/history views)
- on odds update ingestion (schedule/home views)

---

# 9) Operational Model (Jobs)

Jobs are defined in `docs/INGESTION_PLAN.md`.

MVP operational requirement:
- system works if jobs run on schedule with occasional upstream failure
- UI remains usable during upstream outages by showing “data delayed” with last known values

---

# 10) Security and Secrets

- Use `.env` (never commit) and `.env.example` (commit)
- Denylist sensitive file reads for Claude/GSD (e.g., `.env`, keys)
- Never store API keys in DB
- If storing raw payloads, ensure they do not contain secrets (they should not)

---

# 11) Non-Goals (MVP)

- authentication / multi-user accounts
- multi-team personalization (keep path open but don’t design for it yet)
- mobile-first layout
- full-league explorer UI
- live betting odds (unless trivially available)
- play-by-play animation engine

---

# 12) Definition of “Ship-Ready” for Architecture

This architecture is considered locked when:

- stack choice is finalized (hosting + DB)
- data sources are confirmed
- insight system model is accepted (“provable” enforced)
- job model is accepted (cron vs in-app scheduler)

After this file is locked, implementation should proceed via GSD phases without major rewrites.
