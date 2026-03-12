# Roadmap: Clippers Command Center

## Overview

Build a desktop analytics dashboard for Clippers fans that delivers live game stats, provable insight tiles, player performance trends, scheduling information, and historical exploration — all sourced from real NBA data with no fabrication. Phases 1–3 are already complete (planning artifacts locked). Phases 4–16 build the working application, from data ingestion through live UI to production deployment.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 1: Spec Lock** - Finalize all planning artifacts so implementation never relies on guessing
- [x] **Phase 2: Wireframes** - Define exact screen structure and layout for all 5 MVP screens
- [x] **Phase 3: DB Schema** - Design the full data model supporting all requirements
- [x] **Phase 4: Historical Data Ingestion** - Populate the database with 3 seasons of NBA data via BALLDONTLIE (completed 2026-03-06)
- [x] **Phase 5: Advanced Stats Engine** - Compute derived metrics used by insights and dashboards (completed 2026-03-06)
- [x] **Phase 6: Insight Engine** - Generate provable contextual insights from stored data (completed 2026-03-06)
- [ ] **Phase 7: Live Data Pipeline** - Handle real-time game polling, snapshot storage, and run detection
- [x] **Phase 8: Odds Integration** - Add Vegas betting odds as display-only contextual signals (completed 2026-03-07)
- [x] **Phase 9: API Layer** - Expose backend data to the frontend via 10 REST endpoints (completed 2026-03-07)
- [x] **Phase 10: Core UI Framework** - Build base frontend structure: nav, layout, stat cards, tables, charts (completed 2026-03-07)
- [x] **Phase 11: Live Game Dashboard** - Implement the primary product experience: scoreboard, box score, insights (completed 2026-03-07)
- [x] **Phase 12: Between-Games Dashboard** - Provide team trends, schedule, and insights when no game is active (completed 2026-03-07)
- [x] **Phase 13: Player Trends Page** - Explore individual player performance with logs, rolling averages, charts (completed 2026-03-07)
- [x] **Phase 14: Historical Explorer** - Browse historical Clippers games by season with full box scores (completed 2026-03-12)
- [x] **Phase 15: Reliability and Validation** - Validate failure handling, backoff, fallback, and performance SLAs (completed 2026-03-12)
- [x] **Phase 16: MVP Launch** - Deploy to Vercel + Neon and ship the first fully usable version (completed 2026-03-12)

## Phase Details

### Phase 1: Spec Lock
**Goal**: All planning artifacts are finalized so implementation never relies on guessing
**Depends on**: Nothing (first phase)
**Requirements**: (pre-implementation planning — no v1 requirement IDs)
**Success Criteria** (what must be TRUE):
  1. PROJECT.md, REQUIREMENTS.md, and DESIGN-SYSTEM.md are reviewed and complete
  2. No ambiguous product behavior remains unresolved
  3. API contracts, architecture, and ingestion plan are locked in Docs/
**Plans**: Complete

**Status: COMPLETE** (Docs/PROJECT.md, Docs/REQUIREMENTS.md, Docs/API_SPEC.md, Docs/ARCHITECTURE.md, Docs/INGESTION_PLAN.md, design-system/ all exist)

---

### Phase 2: Wireframes
**Goal**: Every application screen has a defined layout, section hierarchy, and data module map before UI coding begins
**Depends on**: Phase 1
**Requirements**: (pre-implementation planning — no v1 requirement IDs)
**Success Criteria** (what must be TRUE):
  1. All 5 screens (Live Dashboard, Between-Games, Player Trends, Schedule, Historical Explorer) have defined layouts in WIREFRAMES.md
  2. Every UI component maps to a DESIGN-SYSTEM.md component
  3. Data modules on each screen are named and their data source is identified
**Plans**: Complete

**Status: COMPLETE** (Docs/WIREFRAMES.md exists)

---

### Phase 3: DB Schema
**Goal**: The full data model is designed and documented, supporting all application requirements
**Depends on**: Phase 2
**Requirements**: (pre-implementation planning — no v1 requirement IDs)
**Success Criteria** (what must be TRUE):
  1. DB_SCHEMA.sql defines all core tables: games, teams, players, team_box_scores, player_box_scores, live_snapshots, advanced_stats, generated_insights
  2. DATA_DICTIONARY.md documents every table and column
  3. Schema supports live snapshot append-only storage and trend detection
**Plans**: Complete

**Status: COMPLETE** (Docs/DB_SCHEMA.sql and Docs/DATA_DICTIONARY.md exist)

---

### Phase 4: Historical Data Ingestion
**Goal**: The database is seeded with 3 seasons of reference and schedule data from BALLDONTLIE, giving the live pipeline and dashboards real teams, players, and game records to work with
**Depends on**: Phase 3
**Requirements**: DATA-01, DATA-04
**Success Criteria** (what must be TRUE):
  1. All NBA teams and active players are present in the database
  2. 3 seasons (2022–2024) of game schedule and metadata are present in `games`
  3. Ingestion scripts are idempotent — re-running does not create duplicate records
  4. Box scores are intentionally out of scope for backfill: `game_team_box_scores` and `game_player_box_scores` are populated going forward by the NBA live JSON finalization pipeline (Phase 7)

**Source split (locked):**
- BALLDONTLIE free tier: teams, players, schedule/game metadata
- NBA live JSON: live scoreboard, live box scores, post-game final box score finalization

**Plans**: 3 plans

Plans:
- [x] 04-01-PLAN.md — Next.js scaffold, dependencies, DB schema application, verification SQL
- [x] 04-02-PLAN.md — Script library: BDL types, DB client, API fetch client with retry, upsert functions
- [x] 04-03-PLAN.md — Backfill orchestrator (reference + schedule only), human verification checkpoint

---

### Phase 5: Advanced Stats Engine
**Goal**: Derived metrics (advanced stats and rolling windows) are computed and stored so dashboards and insights can query them directly
**Depends on**: Phase 4
**Requirements**: DATA-02, DATA-03
**Success Criteria** (what must be TRUE):
  1. advanced_stats table is populated with possessions, pace, offensive rating, defensive rating, eFG%, and TS% for historical games
  2. Rolling windows (last 5 / last 10) are computed for both teams and players
  3. At least one computed advanced stat is validated against a known reference value
**Plans**: 2 plans

Plans:
- [ ] 05-01-PLAN.md — Seed script (hardcoded box scores for 2-3 real Clippers games) + formula library (pure advanced stat functions)
- [ ] 05-02-PLAN.md — Compute-stats orchestrator, rolling windows library, verification SQL, npm script registration

---

### Phase 6: Insight Engine
**Goal**: The system generates contextual, provable insights from stored data that can be displayed to users with confidence
**Depends on**: Phase 5
**Requirements**: INSIGHT-01, INSIGHT-02, INSIGHT-03, INSIGHT-04, INSIGHT-05
**Success Criteria** (what must be TRUE):
  1. The engine produces insights covering: scoring runs, clutch alerts, player streaks, milestones, rare statistical events, opponent context, and league comparisons
  2. Every insight record contains proof_sql, proof_params, and proof_result
  3. Insights without a valid proof are excluded from all output — zero fabricated insights surface
  4. Live insights can be generated on-demand from a current snapshot combined with rolling window data
**Plans**: 4 plans

Plans:
- [ ] 06-01-PLAN.md — Vitest test infrastructure, proof_hash unique index schema migration
- [ ] 06-02-PLAN.md — Shared types (proof-utils.ts), live insight pure function (src/lib/insights/live.ts)
- [ ] 06-03-PLAN.md — 5 batch category modules (streaks, milestones, rare-events, opponent-context, league-comparisons)
- [ ] 06-04-PLAN.md — generate-insights.ts orchestrator, upsert loop, npm script, verification SQL

---

### Phase 7: Live Data Pipeline
**Goal**: The system detects active Clippers games, polls NBA live JSON at ~12s cadence, stores snapshots, detects runs and clutch moments in real time, and finalizes box scores after each game ends
**Depends on**: Phase 6
**Requirements**: LIVE-01, LIVE-06, LIVE-07, LIVE-08, LIVE-09, LIVE-12
**Source**: NBA live JSON (`cdn.nba.com/static/json/liveData/`) — public, key-free
**Success Criteria** (what must be TRUE):
  1. System correctly detects when a Clippers game is in progress and activates live mode
  2. Live snapshots are stored in live_snapshots on every poll, append-only
  3. Scoring runs of 8–0 or greater are detected and flagged
  4. Clutch situations (last 5 min of Q4/OT, margin ≤ 8) are detected correctly
  5. When the live source fails, the system serves the last cached snapshot with a "data delayed" indicator
  6. After a game reaches Final status, the finalization job writes team and player box scores to `game_team_box_scores` / `game_player_box_scores` from the NBA live JSON boxscore endpoint
**Plans**: 5 plans

Plans:
- [ ] 07-01-PLAN.md — Shared types (src/lib/types/live.ts) and NBA live JSON HTTP client (scripts/lib/nba-live-client.ts)
- [ ] 07-02-PLAN.md — TDD: clock parsing tests and poll-live-logic pure helpers (game detection, backoff)
- [ ] 07-03-PLAN.md — sync-schedule.ts script and Phase 7 npm script registration in package.json
- [ ] 07-04-PLAN.md — poll-live.ts: game detection, poll loop, snapshot INSERT, insight wiring, backoff, finalization trigger
- [ ] 07-05-PLAN.md — finalize-games.ts catch-up script, box score upserts in upserts.ts, shared finalize.ts module

---

### Phase 8: Odds Integration
**Goal**: Vegas betting odds appear as display-only contextual data in the schedule and dashboard, with graceful null handling when unavailable
**Depends on**: Phase 7
**Requirements**: ODDS-01, ODDS-02, ODDS-03, ODDS-04
**Success Criteria** (what must be TRUE):
  1. Odds data ingests from an external provider into odds_snapshots (append-only)
  2. Spread, moneyline, and over/under display correctly for upcoming Clippers games
  3. When the odds provider is unavailable, odds sections are hidden — no fabricated values appear
  4. The odds provider is swappable by changing the adapter without touching display logic
**Plans**: 2 plans

Plans:
- [ ] 08-01-PLAN.md — Types contracts (OddsAdapter, OddsSnapshot, OddsEvent) + TDD getLatestOdds query helper
- [ ] 08-02-PLAN.md — TheOddsApiAdapter HTTP client, sync-odds.ts orchestrator, npm script, GitHub Actions cron

---

### Phase 9: API Layer
**Goal**: All frontend pages have dedicated, fast REST endpoints returning complete, structured payloads
**Depends on**: Phase 8
**Requirements**: API-01, API-02, API-03, API-04, API-05, API-06, API-07
**Success Criteria** (what must be TRUE):
  1. GET /api/live returns the complete Live Dashboard payload (score, box score, insights, other games)
  2. GET /api/home returns the complete Between-Games Dashboard payload (trends, schedule, odds)
  3. GET /api/players and /api/players/{id} return player data with rolling averages and game logs
  4. GET /api/schedule returns upcoming games with odds
  5. GET /api/history/seasons, /games, and /games/{id} return historical data correctly
  6. GET /api/insights returns eligible insights with proof payloads by scope
  7. Every endpoint response includes meta: generated_at, source, stale, stale_reason, ttl_seconds
**Plans**: 6 plans

Plans:
- [ ] 09-01-PLAN.md — Foundation: src/lib/db.ts singleton, src/lib/api-utils.ts helpers, odds.ts import fix, 6 RED test scaffolds
- [ ] 09-02-PLAN.md — GET /api/live: live snapshot query, key_metrics computation, insights, odds, 3 game states
- [ ] 09-03-PLAN.md — GET /api/home: team snapshot, rolling ratings, last_10, schedule with odds, player trends, insights
- [ ] 09-04-PLAN.md — GET /api/players (roster) and GET /api/players/{id} (trends, splits, game log)
- [ ] 09-05-PLAN.md — GET /api/schedule, GET /api/history/seasons, /games (paginated), /games/{id} (with available flag)
- [ ] 09-06-PLAN.md — GET /api/insights: scope-filtered, is_active=true only, sorted by importance DESC

---

### Phase 10: Core UI Framework
**Goal**: The base frontend structure is in place — navigation, layout grid, and all reusable components — so page implementations compose from working parts
**Depends on**: Phase 9
**Requirements**: (no dedicated v1 requirement IDs — foundation for LIVE-02–05, LIVE-10–11, HOME-01–06, PLAYER-01–06, SCHED-01–04, HIST-01–04)
**Success Criteria** (what must be TRUE):
  1. Navigation renders correctly and routes between all 5 pages
  2. Stat cards, tables, and chart components render correctly with mock data
  3. Layout grid respects the 1024px minimum and 1280px primary target
**Plans**: 3 plans

Plans:
- [ ] 10-01-PLAN.md — SWR install, Clippers design tokens (globals.css), root layout (Inter, dark, 1024px), 5 page stubs, shadcn primitives
- [ ] 10-02-PLAN.md — Navigation shell: TopNav, NavLinks (active state), LiveDot (SWR polling), StaleBanner, useLiveData hook
- [ ] 10-03-PLAN.md — Reusable data components: StatCard, BoxScoreTable (sticky/sortable), LineChartWrapper, BarChartWrapper, skeleton loaders

---

### Phase 10.1: Design system refinement for premium Apple-like analytics UI (INSERTED)

**Goal:** Refine the visual language of the existing UI shell — design tokens, typography, spacing, and all shared components from Phase 10 — to achieve a premium dark analytics aesthetic (Apple Sports / Linear / Raycast references). No new features. Every component that Phase 11–14 builds on top of reflects the premium direction.
**Requirements**: (inserted phase — no formal requirement IDs)
**Depends on:** Phase 10
**Plans:** 3/3 plans complete

Plans:
- [ ] 10.1-01-PLAN.md — globals.css token rewrite (background, surface, border, chart palette, spacing) + TopNav + NavLinks + StatCard + StatCardSkeleton
- [ ] 10.1-02-PLAN.md — BoxScoreTable + LineChartWrapper + BarChartWrapper + BoxScoreSkeleton + ChartSkeleton + StaleBanner
- [ ] 10.1-03-PLAN.md — MASTER.md canonical rewrite + human visual review checkpoint

---

### Phase 11: Live Game Dashboard
**Goal**: A fan watching a Clippers game opens the dashboard and sees the live score, full box score, insight tiles, and other-games panel — all updating in real time
**Depends on**: Phase 10
**Requirements**: LIVE-02, LIVE-03, LIVE-04, LIVE-05, LIVE-10, LIVE-11
**Success Criteria** (what must be TRUE):
  1. Live scoreboard shows the current score, game clock, and quarter
  2. Full team and player box scores render with all standard columns (MIN, PTS, REB, AST, STL, BLK, TO, FG, 3PT, FT, +/-)
  3. Key live metrics row shows eFG%, TO margin, rebound margin, pace, and FT edge
  4. 2–3 rotating insight tiles display simultaneously with provable content
  5. Other NBA games relevant to the Clippers appear in the side panel with score, time, and a Clippers-relevant note
**Plans**: 3 plans

Plans:
- [ ] 11-01-PLAN.md — Utility functions (formatClock, computeFtEdge) + Wave 0 test scaffolds
- [ ] 11-02-PLAN.md — LiveScoreboard, KeyMetricsRow, BoxScoreModule components
- [ ] 11-03-PLAN.md — InsightTileArea, useInsightRotation, OtherGamesPanel, NoGameIdleState, full page assembly + visual checkpoint

---

### Phase 12: Between-Games Dashboard
**Goal**: When no Clippers game is active, the dashboard shows meaningful team trends, upcoming schedule, player summaries, and odds
**Depends on**: Phase 10
**Requirements**: HOME-01, HOME-02, HOME-03, HOME-04, HOME-05, HOME-06, SCHED-01, SCHED-02
**Success Criteria** (what must be TRUE):
  1. Dashboard loads correctly and displays when no live game is detected
  2. Recent team performance trends are visible
  3. Upcoming Clippers schedule shows opponent, date, time, and home/away for each game
  4. Player trend summaries appear for top Clippers players
  5. Rotating team performance insights display from stored data
  6. Vegas odds (spread, moneyline, over/under) appear on schedule rows when available
**Plans**: 2 plans

Plans:
- [ ] 12-01-PLAN.md — API extension (last10_games), home-utils lib + tests, TeamSnapshot, NextGameHero, ScheduleTable, page shell
- [ ] 12-02-PLAN.md — PlayerTrendsTable, PointDiffChart, complete page assembly, visual verification checkpoint

---

### Phase 13: Player Trends Page
**Goal**: A user can select any Clippers player and explore their performance in depth — game log, rolling averages, trend charts, and splits
**Depends on**: Phase 10
**Requirements**: PLAYER-01, PLAYER-02, PLAYER-03, PLAYER-04, PLAYER-05, PLAYER-06
**Success Criteria** (what must be TRUE):
  1. User can select a Clippers player and the page loads their data
  2. Rolling averages for last 5 and last 10 games display correctly
  3. Season averages are visible
  4. Trend charts render for rolling scoring and at least one secondary metric
  5. Game log table shows all standard box score columns
  6. Splits (home/away, wins/losses) are visible
**Plans**: 4 plans

Plans:
- [ ] 13-01-PLAN.md — API extensions (traded players, rolling_reb/ast, season_averages) + player-utils TDD
- [ ] 13-02-PLAN.md — Roster page /players with list/cards/grid toggle and traded badges
- [ ] 13-03-PLAN.md — Player detail page: header, rolling averages table, trend chart, splits, game log
- [ ] 13-04-PLAN.md — Visual verification checkpoint for all six PLAYER requirements

---

### Phase 14: Historical Explorer
**Goal**: A user can browse any Clippers season, find a specific game, and view its full box score and related historical insights
**Depends on**: Phase 10
**Requirements**: HIST-01, HIST-02, HIST-03, HIST-04, SCHED-03, SCHED-04
**Success Criteria** (what must be TRUE):
  1. User can browse Clippers games filtered by season
  2. Game list shows date, opponent, result, and final score for every game
  3. Opening a historical game displays the full box score
  4. Historical game detail surfaces insights related to that specific game
  5. Odds columns on schedule show null/unavailable rather than fabricated values when data is absent
**Plans**: 3 plans

Plans:
- [ ] 14-01-PLAN.md — history-utils + GameListTable + SeasonControls + SeasonSummaryBar + /history page (HIST-01, HIST-02)
- [ ] 14-02-PLAN.md — GameHeader + HistoryGameDetail + /history/[game_id] page (HIST-03, HIST-04)
- [ ] 14-03-PLAN.md — ScheduleTable odds fix + full visual verification checkpoint (SCHED-03, SCHED-04)

---

### Phase 15: Reliability and Validation
**Goal**: The system behaves correctly under real-world failure conditions — upstream outages, rate limits, stale data — and all performance SLAs are met
**Depends on**: Phase 14
**Requirements**: PERF-01, PERF-02, PERF-03, RELY-01, RELY-02, RELY-03
**Success Criteria** (what must be TRUE):
  1. /api/live responds in under 200ms under normal load
  2. /api/home responds in under 300ms under normal load
  3. /api/history/* responds in under 400ms under normal load
  4. During a simulated upstream API outage, the system continues serving cached data without errors
  5. Live polling applies exponential backoff on repeated failures
  6. The UI remains functional and meaningful during all simulated upstream outage scenarios
**Plans**: 3 plans

Plans:
- [ ] 15-01-PLAN.md — /api/live integration tests: all 3 states, timing SLA, DATA_DELAYED contract (PERF-01, RELY-01, RELY-02)
- [ ] 15-02-PLAN.md — /api/home and /api/history timing spot-check tests + delete stale src/app/api/live/route.ts (PERF-02, PERF-03)
- [ ] 15-03-PLAN.md — StaleBanner captured_at fix + DATA_DELAYED UI verification checkpoint (RELY-03)

---

### Phase 16: MVP Launch
**Goal**: The application is deployed to production and the end-to-end workflow — from live game detection through insight display — is verified working on real infrastructure
**Depends on**: Phase 15
**Requirements**: (deployment milestone — no dedicated v1 requirement IDs)
**Success Criteria** (what must be TRUE):
  1. Application is deployed to Vercel with Neon PostgreSQL as the database
  2. Scheduled GitHub Actions jobs run ingestion and odds refresh on correct cadence
  3. End-to-end workflow tested: live game detected, dashboard updates, insights appear
  4. No fabricated data surfaces anywhere in the deployed application
**Plans**: 3 plans

Plans:
- [ ] 16-01-PLAN.md — Stateless Vercel Cron route (/api/cron/poll-live) + vercel.json cron config + .env.example update
- [ ] 16-02-PLAN.md — GitHub Actions workflows: sync-schedule.yml (daily 6am PT) + post-game.yml (nightly 2am PT chain)
- [ ] 16-03-PLAN.md — Pre-launch data backfill + Vercel deployment + MVP smoke test checkpoint

---

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → ... → 16

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Spec Lock | - | Complete | 2026-03-05 |
| 2. Wireframes | - | Complete | 2026-03-05 |
| 3. DB Schema | - | Complete | 2026-03-05 |
| 4. Historical Data Ingestion | 3/3 | Complete   | 2026-03-06 |
| 5. Advanced Stats Engine | 2/2 | Complete   | 2026-03-06 |
| 6. Insight Engine | 4/4 | Complete   | 2026-03-06 |
| 7. Live Data Pipeline | 3/5 | In Progress|  |
| 8. Odds Integration | 2/2 | Complete   | 2026-03-07 |
| 9. API Layer | 6/6 | Complete   | 2026-03-07 |
| 10. Core UI Framework | 3/3 | Complete    | 2026-03-07 |
| 10.1 Design System Refinement | 3/3 | Complete    | 2026-03-07 |
| 11. Live Game Dashboard | 3/3 | Complete   | 2026-03-07 |
| 12. Between-Games Dashboard | 2/2 | Complete    | 2026-03-07 |
| 13. Player Trends Page | 4/4 | Complete    | 2026-03-07 |
| 14. Historical Explorer | 4/4 | Complete    | 2026-03-12 |
| 15. Reliability and Validation | 3/3 | Complete    | 2026-03-12 |
| 16. MVP Launch | 3/3 | Complete   | 2026-03-12 |
