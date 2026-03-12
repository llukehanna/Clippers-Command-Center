# Clippers Command Center

## What This Is

Clippers Command Center (CCC) is a desktop analytics dashboard for avid LA Clippers fans. It provides live game stats, player performance trends, contextual insights, and scheduling information — all sourced from real NBA data and served without fabrication. The primary use case is as a second-screen companion during live Clippers games.

## Core Value

A Clippers fan watching a game opens the dashboard and immediately sees the live score, full box score, and 2–3 insight tiles telling them something real and meaningful about the game — all verified from stored data.

## Requirements

### Validated

- ✓ Product specification and principles defined — Docs/PROJECT.md
- ✓ UX wireframes for all 5 MVP screens defined — Docs/WIREFRAMES.md
- ✓ Database schema designed — Docs/DB_SCHEMA.sql + Docs/DATA_DICTIONARY.md
- ✓ API contracts defined — Docs/API_SPEC.md
- ✓ Architecture locked — Docs/ARCHITECTURE.md
- ✓ Ingestion plan designed — Docs/INGESTION_PLAN.md
- ✓ Design system created — design-system/clippers-command-center/MASTER.md

### Active

- [ ] Next.js project scaffold with PostgreSQL connection
- [ ] Historical data ingestion (3 seasons via BALLDONTLIE)
- [ ] Advanced stats computation engine
- [ ] Rolling window aggregation (last 5 / last 10)
- [ ] Batch insight generation with provable proofs
- [ ] Live polling pipeline (~12s cadence during Clippers games)
- [ ] Odds data integration (display-only, graceful null handling)
- [ ] REST API layer (10 endpoints per API_SPEC.md)
- [ ] Core UI framework (navigation, stat cards, tables, charts)
- [ ] Live Game Dashboard (scoreboard, box score, insight tiles, other-games panel)
- [ ] Between-Games Dashboard (team snapshot, schedule, player trends, insights)
- [ ] Player Trends Page (game log, rolling averages, charts, splits)
- [ ] Schedule Page (upcoming games + odds)
- [ ] Historical Explorer (season browser, game detail, historical insights)
- [ ] Failure handling (DATA_DELAYED states, cached fallbacks, exponential backoff)
- [ ] Deployed to Vercel + Neon PostgreSQL

### Out of Scope

- User accounts / authentication — personal use only for v1
- Push notifications — deferred
- Fantasy integrations — deferred
- Video highlights — deferred
- Social sharing — deferred
- Betting functionality — odds are display-only
- Mobile layout — desktop-first only for MVP
- Multi-team dashboards — Clippers-first only for v1
- Full-league explorer UI — Clippers-centric only

## Context

- Specs are fully documented in `Docs/` — treat all files there as authoritative source of truth.
- Design system lives in `design-system/clippers-command-center/`. Page-specific overrides in `design-system/clippers-command-center/pages/` supersede MASTER.md for their page.
- Data sources: NBA live JSON (live polling), BALLDONTLIE API (historical), external odds provider (Vegas odds).
- Insights must be **provable**: each must store `proof_sql`, `proof_params`, and `proof_result`. Insights without valid proof must not be displayed.
- Live polling runs ~12 seconds during active Clippers games. Snapshots stored append-only in `live_snapshots`.
- Between-games: schedule + odds refresh every 6 hours; final box scores fetched after game completion.

## Constraints

- **Tech stack**: Next.js (App Router) + TypeScript, shadcn/ui, Tailwind, Recharts, PostgreSQL — locked per ARCHITECTURE.md.
- **Hosting**: Vercel (app) + Neon (Postgres) + GitHub Actions (scheduled jobs) — free tier constraints apply.
- **Data integrity**: No fabricated data. Missing data returns null; UI hides missing sections rather than guessing.
- **Performance**: `/api/live` < 200ms, `/api/home` < 300ms, `/api/history/*` < 400ms.
- **Desktop-only**: 1024px minimum, 1280px primary target, 1440px ideal.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Next.js App Router | Full-stack TypeScript, Vercel-native, API routes co-located | — Pending |
| PostgreSQL over SQLite | Future scalability while remaining free on Neon | — Pending |
| Page-shaped API endpoints | Minimize round trips per page, avoid over-fetching | — Pending |
| Live insights generated on-demand in `/api/live` | Simpler than background job every 12s; still provable | — Pending |
| Append-only live_snapshots | Enables run detection, momentum analysis, post-game reconstruction | — Pending |
| Odds display-only, null if unavailable | No betting functionality; never fabricate values | — Pending |
| GitHub Actions for scheduled jobs (except live polling) | Free tier, simple, declarative | — Pending |

---
*Last updated: 2026-03-05 after initialization from Docs/*
