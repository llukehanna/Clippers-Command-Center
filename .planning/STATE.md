---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: planning
stopped_at: Phase 7 context gathered
last_updated: "2026-03-06T22:46:50.785Z"
last_activity: 2026-03-05 — Roadmap created; Phases 1–3 confirmed complete from existing Docs/
progress:
  total_phases: 16
  completed_phases: 3
  total_plans: 9
  completed_plans: 9
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

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-03-06T22:46:50.783Z
Stopped at: Phase 7 context gathered
Resume file: .planning/phases/07-live-data-pipeline/07-CONTEXT.md
