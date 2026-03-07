---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: planning
stopped_at: Completed 13-player-trends-page-04-PLAN.md — Phase 13 complete
last_updated: "2026-03-07T21:15:14.503Z"
last_activity: 2026-03-05 — Roadmap created; Phases 1–3 confirmed complete from existing Docs/
progress:
  total_phases: 17
  completed_phases: 11
  total_plans: 37
  completed_plans: 37
  percent: 15
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-05)

**Core value:** A Clippers fan watching a game opens the dashboard and immediately sees the live score, full box score, and 2–3 provable insight tiles — all from real data.
**Current focus:** Phase 4 — Historical Data Ingestion

## Current Position

Phase: 4 of 16 (Historical Data Ingestion)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-03-05 — Roadmap created; Phases 1–3 confirmed complete from existing Docs/

Progress: [███░░░░░░░░░░░░░░░░░] 15% (3/16 phases complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: N/A
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1–3 (complete, pre-coded) | - | - | - |

**Recent Trend:**
- Last 5 plans: N/A
- Trend: N/A

*Updated after each plan completion*
| Phase 04-historical-data-ingestion P01 | 10 | 2 tasks | 10 files |
| Phase 04-historical-data-ingestion P02 | 15 | 3 tasks | 4 files |
| Phase 05-advanced-stats-engine P01 | 25 | 2 tasks | 2 files |
| Phase 05-advanced-stats-engine P02 | 20 | 2 tasks | 4 files |
| Phase 06-insight-engine P01 | 2 | 2 tasks | 5 files |
| Phase 06-insight-engine P02 | 3 | 2 tasks | 3 files |
| Phase 06-insight-engine P03 | 5 | 2 tasks | 5 files |
| Phase 06-insight-engine P04 | 6 | 2 tasks | 9 files |
| Phase 07-live-data-pipeline P01 | 12 | 2 tasks | 2 files |
| Phase 07-live-data-pipeline P02 | 3 | 2 tasks | 4 files |
| Phase 07-live-data-pipeline P03 | 8 | 2 tasks | 2 files |
| Phase 08-odds-integration P01 | 1 | 2 tasks | 3 files |
| Phase 08-odds-integration P02 | 2 | 2 tasks | 4 files |
| Phase 09-api-layer P01 | 3 | 2 tasks | 10 files |
| Phase 09-api-layer P04 | 3 | 2 tasks | 2 files |
| Phase 09-api-layer P02 | 2 | 1 tasks | 1 files |
| Phase 09-api-layer P05 | 4 | 2 tasks | 4 files |
| Phase 09-api-layer P06 | 5 | 1 tasks | 2 files |
| Phase 09-api-layer P03 | 5 | 1 tasks | 2 files |
| Phase 10-core-ui-framework P01 | 12 | 3 tasks | 15 files |
| Phase 10-core-ui-framework P02 | 15 | 2 tasks | 6 files |
| Phase 10-core-ui-framework P03 | 2 | 3 tasks | 7 files |
| Phase 10.1-design-system-refinement-for-premium-apple-like-analytics-ui P01 | 2 | 3 tasks | 5 files |
| Phase 10.1-design-system-refinement-for-premium-apple-like-analytics-ui P02 | 2 | 2 tasks | 6 files |
| Phase 10.1-design-system-refinement-for-premium-apple-like-analytics-ui P03 | 20 | 2 tasks | 1 files |
| Phase 11-live-game-dashboard P01 | 5 | 2 tasks | 5 files |
| Phase 11-live-game-dashboard P02 | 12 | 3 tasks | 3 files |
| Phase 12-between-games-dashboard P01 | 3 | 3 tasks | 7 files |
| Phase 12-between-games-dashboard P02 | 1 | 2 tasks | 3 files |
| Phase 12-between-games-dashboard P02 | 60 | 3 tasks | 3 files |
| Phase 13-player-trends-page P01 | 3 | 3 tasks | 4 files |
| Phase 13-player-trends-page P02 | 2 | 2 tasks | 2 files |
| Phase 13-player-trends-page P03 | 5 | 2 tasks | 6 files |
| Phase 13-player-trends-page P04 | 2 | 1 tasks | 0 files |
| Phase 13-player-trends-page P04 | 12 | 2 tasks | 2 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Planning]: Next.js App Router chosen — full-stack TypeScript, Vercel-native, API routes co-located
- [Planning]: Page-shaped API endpoints — minimize round trips, avoid over-fetching
- [Planning]: Insights generated on-demand in /api/live — simpler than background job, still provable
- [Planning]: Append-only live_snapshots — enables run detection, momentum analysis, post-game reconstruction
- [Planning]: Odds display-only, null if unavailable — no betting functionality, never fabricate
- [Phase 04-01]: Use postgres npm package (not ORM) for DB client — lightweight, TypeScript-native, Neon-compatible
- [Phase 04-01]: npm run backfill + db:schema as entry points for data pipeline — keeps data scripts separate from app layer
- [Phase 04-01]: shadcn/ui Neutral color scheme chosen; DB_SCHEMA.sql applied directly to Neon (no ORM migrations)
- [Phase 04-02]: bigint FK values fetched as text (::text) and cast back (::bigint) to avoid postgres.js SerializableParameter type gap
- [Phase 04-02]: TransactionSql cast via unknown to typeof sql to work around TypeScript Omit stripping call signatures
- [Phase 04-02]: upsertBoxScoresForGame aggregates team totals from player stats since BDL /stats is player-level only
- [Phase 04-03]: fetchStatsForBatch bypasses fetchAll to build repeated game_ids[] query params manually via URL string concatenation
- [Re-scope 2026-03-06]: BDL free tier ceiling accepted. BDL scope narrowed to teams/players/schedule. NBA live JSON owns live scoreboard, live box scores, and post-game finalization. Historical box score backfill via BDL /stats removed from MVP. Box score tables remain in schema for extensibility.
- [Phase 04-historical-data-ingestion]: BDL free tier ceiling accepted — box score backfill removed from MVP scope
- [Phase 04-historical-data-ingestion]: NBA live JSON owns live scoreboard and post-game box scores (Phase 7)
- [Phase 05-advanced-stats-engine]: Selected LAC vs MIA (2024-01-01) and LAC vs PHX (2024-01-08) as seed games — regulation wins, confirmed in games table
- [Phase 05-advanced-stats-engine]: Formula library has zero DB dependency — pure functions enable isolated verification without DB setup
- [Phase 05-advanced-stats-engine]: Rolling windows yield 0 rows when seeded game count (2) is below minimum window size (5) — correct behavior per plan spec
- [Phase 05-advanced-stats-engine]: DISTINCT + ORDER BY on cast expressions requires subquery wrapping in PostgreSQL (error 42P10)
- [Phase 06-insight-engine]: Vitest chosen as test runner — ESM-native, TypeScript-first, no transpile step required
- [Phase 06-insight-engine]: uq_insights_proof_hash partial unique index (WHERE proof_hash IS NOT NULL) enables ON CONFLICT upsert deduplication while allowing null proof_hash rows
- [Phase 06-insight-engine]: TDD Wave 0: RED tests committed before proof-utils.ts exists — Plan 02 turns them GREEN
- [Phase 06-insight-engine]: makeProofHash hashes (sql, params, result) tuple to match existing RED tests — tests are the TDD source of truth
- [Phase 06-insight-engine]: live.ts placed in src/lib/insights/ for Phase 9 Next.js API route import compatibility
- [Phase 06-insight-engine]: Streak detection uses rn-rn2 SQL window function grouping pattern — consecutive detection in DB not app-side
- [Phase 06-insight-engine]: opponent-context queries next non-final LAC game, falls back to most recent completed — useful year-round
- [Phase 06-insight-engine]: league-comparisons only generates when Clippers rank <= 5 — filters noise, keeps insights meaningful
- [Phase 06-insight-engine]: ON CONFLICT partial index requires WHERE proof_hash IS NOT NULL predicate — must match index definition exactly
- [Phase 06-insight-engine]: players table has no team_id — Clippers player filter uses EXISTS on game_player_box_scores.team_id
- [Phase 06-insight-engine]: rolling_team_stats uses window_games (not window_size) and def/off/net_rating (no avg_ prefix); teams has no full_name — use city || name
- [Phase 07-live-data-pipeline]: src/lib/types/live.ts has zero runtime imports — pure type declarations only, safe to import from both scripts/ and Next.js app
- [Phase 07-live-data-pipeline]: NBA CDN HTTP client uses 15s timeout — CDN is faster than BDL API, shorter timeout avoids stale game state
- [Phase 07-live-data-pipeline]: calculateBackoff uses Math.min(baseMs * Math.pow(2, failureCount), 60_000) — capped at 60s ceiling for LIVE-12
- [Phase 07-live-data-pipeline]: LAC_TEAM_ID exported from poll-live-logic.ts so poll-live.ts (Plan 04) can import it alongside helpers
- [Phase 07-live-data-pipeline]: vitest.config.ts broadened from insights/ subdirs to scripts/lib/**/*.test.ts for new test file locations
- [Phase 07-live-data-pipeline]: Season ID derived from current month: month < 6 = prior year, else current year — handles NBA season spanning calendar years
- [Phase 07-live-data-pipeline]: sync-schedule.ts resolves LAC BDL team_id from teams table at runtime — avoids hardcoding, robust to BDL data changes
- [Phase 08-odds-integration]: OddsAdapter uses structural typing — no explicit implements needed
- [Phase 08-odds-integration]: NUMERIC DB columns cast to float8 in SELECT for JS number compatibility
- [Phase 08-odds-integration]: captured_at::text returned as ISO string for Phase 9 meta.stale computation
- [Phase 08-odds-integration]: TheOddsApiAdapter throws at construction if ODDS_API_KEY missing — startup guard before any HTTP call
- [Phase 08-odds-integration]: sync-odds.ts exits 0 with console.warn on provider failure — non-fatal cron design
- [Phase 09-api-layer]: db.ts throws Error on missing DATABASE_URL (not process.exit) — Next.js surfaces error in overlay rather than hard-crashing
- [Phase 09-api-layer]: globalThis._sql cache in db.ts survives Next.js hot reload — avoids connection pool exhaustion during development
- [Phase 09-api-layer]: odds.ts import changed from scripts/lib/db.js to ./db.js — eliminates process.exit code path from API layer
- [Phase 09-api-layer]: Two separate SQL queries for active_only filter rather than dynamic interpolation — cleaner postgres.js template parameterization
- [Phase 09-api-layer]: rolling_player_stats uses columns points/rebounds/assists/minutes (not avg-suffixed) — actual DB schema overrides plan interface spec
- [Phase 09-api-layer]: key_metrics computed from live snapshot payload (not advanced_stats table) — on-the-fly eFG%, TO margin, reb margin, pace in GET /api/live
- [Phase 09-api-layer]: other_games returns [] for MVP in /api/live — non-LAC live snapshot data not stored in current schema
- [Phase 09-api-layer]: odds:null when no snapshot — never fabricate; meta.source='mixed' only when at least one game has odds
- [Phase 09-api-layer]: insights always queried from insights table (not generated_insights) — CONTEXT.md had wrong table name
- [Phase 09-api-layer]: cursor pagination for history/games uses base64(JSON({game_date, game_id})) — opaque cursor for DESC ordering
- [Phase 09-api-layer]: Fragment-aware sql mock: distinguishes sub-fragment calls from main query calls for accurate tagged-template-literal mocking in vitest
- [Phase 09-api-layer]: insights route: proof.summary=category, proof.result=proof_result (JSONB parsed by postgres driver); TTL=30s with Cache-Control: public, max-age=30
- [Phase 09-api-layer]: Team lookup embedded as SQL subquery (not cached bigint) — avoids postgres.js type error, consistent with /api/live pattern
- [Phase 09-api-layer]: minutes TEXT parsed in JS not SQL — handles PT34M12S and MM:SS provider formats; keeps SQL portable and logic testable
- [Phase 09-api-layer]: ts_pct null in player_trends — not stored in game_player_box_scores; null is honest per never-fabricate rule
- [Phase 10-core-ui-framework]: Clippers dark palette: :root and .dark use identical hex values since html.dark is always active — dark-only design
- [Phase 10-core-ui-framework]: shadcn CLI used exclusively for UI primitives — keeps components in sync with registry
- [Phase 10-core-ui-framework]: TopNav import commented in layout.tsx — Plan 02 uncomments it when component is created
- [Phase 10-core-ui-framework]: LiveDashboardPayload defined locally in useLiveData.ts — type was not in Phase 7 types; meta typed as MetaEnvelope from api-utils
- [Phase 10-core-ui-framework]: TopNav is Server Component — NavLinks and LiveDot are client components; client boundary propagates through import chain
- [Phase 10-core-ui-framework]: LiveDot polls /api/live at 30s; useLiveData hook polls at 12s — polling intervals split by consumer granularity need
- [Phase 10-core-ui-framework]: BoxScoreTable uses raw HTML table inside overflow-y-auto div — avoids shadcn Table wrapper's overflow-auto breaking sticky thead
- [Phase 10-core-ui-framework]: formatStat and CustomTooltip intentionally duplicated per chart file — self-contained MVP design
- [Phase 10-core-ui-framework]: ChartSeries type exported from LineChartWrapper, re-imported by BarChartWrapper — minimal inter-file coupling
- [Phase 10.1-design-system-refinement-for-premium-apple-like-analytics-ui]: StatCard uses plain div (not Card/CardContent) — shadcn Card applies its own CSS variable mappings that fight new tokens; direct div gives precise control
- [Phase 10.1-design-system-refinement-for-premium-apple-like-analytics-ui]: border-white/[0.06] instead of border-border — rgba hairline avoids the old #334155 heavy border value, gives premium floating appearance on dark backgrounds
- [Phase 10.1-design-system-refinement-for-premium-apple-like-analytics-ui]: --muted set to rgba(255,255,255,0.05) — drives Skeleton shimmer base color automatically at correct darkness level
- [Phase 10.1-design-system-refinement-for-premium-apple-like-analytics-ui]: ChartSeries.color made optional with CHART_COLORS fallback — callers using var(--chart-N) still work; new callers get automatic token defaults
- [Phase 10.1-design-system-refinement-for-premium-apple-like-analytics-ui]: strokeOpacity not opacity for CartesianGrid — targets line stroke color only, not the whole SVG group
- [Phase 10.1-design-system-refinement-for-premium-apple-like-analytics-ui]: MASTER.md fully rewritten as authoritative Phase 11-14 reference — overrides all original conflicting values (light background, Fira fonts, blue primary)
- [Phase 11-live-game-dashboard]: formatClock regex with passthrough fallback — never throws on non-ISO or empty input
- [Phase 11-live-game-dashboard]: getNextIndex extracted as pure function from hook — testable without jsdom per LIVE-10 requirement
- [Phase 11-live-game-dashboard]: LiveScoreboard renders LIVE and DATA_DELAYED states identically — StaleBanner in page shell (Plan 03) handles delay indicator
- [Phase 11-live-game-dashboard]: BoxScoreModule each BoxScoreTable sorts independently — intentional per-team sort state
- [Phase Phase 11-live-game-dashboard]: useInsightRotation omits items from useEffect deps — timer runs at fixed 8s, SWR refresh does not reset cycle
- [Phase Phase 11-live-game-dashboard]: OtherGamesPanel returns null when games empty — no placeholder per design decision
- [Phase Phase 11-live-game-dashboard]: NoGameIdleState uses SWR refreshInterval:0 — one-time fetch for next game data
- [Phase 12-between-games-dashboard]: Import path for src/lib from components is @/src/lib (not @/lib) — tsconfig @/* maps to project root, src/ is a subdirectory
- [Phase 12-between-games-dashboard]: last10Rows query extended with JOIN teams for abbreviations and game_date — reuses existing query without adding new SQL
- [Phase 12-between-games-dashboard]: ScheduleTable is 'use client' (BoxScoreTable requires client boundary); TeamSnapshot and NextGameHero are Server Components
- [Phase 12-between-games-dashboard]: PointDiffChart uses direct recharts Cell for per-bar coloring — BarChartWrapper lacks Cell support; approved deviation per plan
- [Phase 12-between-games-dashboard]: PointDiffTooltipProps custom interface instead of TooltipProps generic — Recharts type does not expose payload for destructuring in installed version; matches BarChartWrapper pattern
- [Phase 12-between-games-dashboard]: insights scope fixed to between_games (not team) — only live/between_games/historical are valid API values
- [Phase 13-player-trends-page]: charts object shape is a breaking change — replaces rolling_pts/rolling_ts with 8 split keys (rolling_{pts,ts,reb,ast}_{l5,l10})
- [Phase 13-player-trends-page]: include_traded branch filters by pts.start_date >= seasonStart to limit to current season only
- [Phase 13-player-trends-page]: season_averages in player detail scoped to last 25 box score rows (SQL LIMIT 25) — labeled accordingly for UI
- [Phase 13-player-trends-page]: RosterViewToggle exports Player type so app/players/page.tsx can import it and avoid duplication
- [Phase 13-player-trends-page]: L10 stats displayed as em-dash in all roster views since /api/players does not include trend_summary
- [Phase 13-player-trends-page]: SplitsDisplay returns null when splits is null — hides section entirely rather than showing empty state
- [Phase 13-player-trends-page]: TrendChartSection shows placeholder text when chartData is empty — graceful empty state for LineChartWrapper
- [Phase 13-player-trends-page]: Removed ?include_traded=true from /api/players fetch — caused 0 results due to season date filter; plain endpoint returns correct active roster
- [Phase 13-player-trends-page]: is_traded made optional (is_traded?: boolean) in RosterViewToggle Player type — API does not guarantee the field when include_traded is not passed

### Roadmap Evolution

- Phase 10.1 inserted after Phase 10: Design system refinement for premium Apple-like analytics UI (URGENT)

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-03-07T21:15:14.501Z
Stopped at: Completed 13-player-trends-page-04-PLAN.md — Phase 13 complete
Resume file: None
