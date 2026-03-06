# Phase 6: Insight Engine - Context

**Gathered:** 2026-03-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Generate and store provable insights from stored data into the `insights` table. Covers two modes:
1. **Batch** (`between_games`, `historical` scopes): `npm run generate-insights` reads historical/advanced/rolling tables and upserts insight rows
2. **Live** (`live` scope): `generateLiveInsights(snapshot, rollingData)` function built in Phase 6, returned transiently from `/api/live` — not stored in DB. Phase 7 wires it into the polling loop.

Phase 6 does NOT build the live polling pipeline (Phase 7), the API layer (Phase 9), or the UI (Phases 11–14).

</domain>

<decisions>
## Implementation Decisions

### Insight Category Split

All 7 required categories are implemented in Phase 6:

**Batch categories** (between_games + historical scopes, stored in `insights` table):
- Player streaks — 2–3 types (e.g., scoring streak, hot shooting run)
- Milestones — 2–3 types (e.g., season points milestone, games played milestone)
- Rare statistical events — 2–3 types (top 5% threshold across 3-season DB)
- Opponent context — 2–3 types (e.g., opponent off/def rating, head-to-head record)
- League comparisons — 2–3 types (e.g., Clippers rank top-N in stat last-10)

**Live categories** (transient, returned from `/api/live`, NOT stored in DB):
- Scoring runs — detect 8–0 or greater runs by either team from current snapshot
- Clutch alerts — detect last 5 min of Q4/OT with score margin ≤ 8

**Rare event threshold**: top 5% percentile rank across all games in the 3-season DB. A performance in the top 5th percentile of its stat triggers a rare event insight.

### Batch Generation Model

- Entry point: `npm run generate-insights` → `scripts/generate-insights.ts`
- Internal modules: `scripts/lib/insights/` directory — one file per category (streaks.ts, milestones.ts, rare-events.ts, opponent-context.ts, league-comparisons.ts)
- Mirrors `compute-stats.ts` pattern: imports lib modules, runs in sequence, logs progress + summary
- **Full recompute every run** — no incremental tracking (same model as compute-stats)
- Idempotent upserts handle re-runs cleanly

### Deduplication Strategy

- `proof_hash` = deterministic SHA fingerprint of `(category, team_id, player_id, game_id, season_id, metric_key)`
- ON CONFLICT on `proof_hash` → UPDATE existing row (update headline, detail, importance, proof_result, updated_at)
- This ensures the same logical insight is updated rather than duplicated across runs

### Importance Scoring

Formula: `base + rarity_boost + recency_boost` (capped at 100)

**Category base scores:**
- milestone: 80
- rare_event: 78
- streak: 72
- league_comparison: 65
- opponent_context: 60

**Rarity boost** (for categories that compute a percentile rank):
- Top 1%: +15
- Top 5%: +5

**Recency boost** (based on insight's associated game date):
- Game in last 7 days: +10
- Game in last 30 days: +5
- Older: no boost

### Live Insight Architecture

- Live generator lives in `scripts/lib/insights/live.ts` (or `src/lib/insights/live.ts` if co-located with app)
- Function signature: `generateLiveInsights(snapshot: LiveSnapshot, rollingData: RollingContext): InsightCandidate[]`
- Fully typed inputs — no DB dependency in the function itself
- Implements full scoring run detection (8-0 or greater) and clutch alert detection (last 5 min Q4/OT, margin ≤ 8)
- Proven by unit tests with constructed snapshots (no live data needed to verify)
- Phase 7 wires this function into the live polling loop
- Live insights are **transient**: generated on each `/api/live` call, returned in response payload, never written to `insights` table

### Claude's Discretion

- Exact SHA hashing implementation for proof_hash
- Console output format for generate-insights (mirror backfill/compute-stats style)
- Specific SQL queries per insight type (within the category + threshold decisions above)
- Whether to add --dry-run flag
- File location for live.ts (scripts/lib vs src/lib — whichever integrates better with Phase 9 API layer)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/lib/db.ts`: `sql` template tag — use for all queries in insight generators
- `scripts/lib/advanced-stats.ts`: Formula library pattern — pure functions, zero DB dependency. Same pattern for insight detection logic.
- `scripts/lib/rolling-windows.ts`: Rolling window query patterns — insight generators can share rolling data queries
- `scripts/lib/upserts.ts`: Upsert function pattern to follow for insight upserts
- `scripts/compute-stats.ts`: Entry point pattern — mirror structure for generate-insights.ts

### Established Patterns
- `postgres` sql template tag for all DB queries — no ORM
- Scripts in `scripts/` directory, invoked via `npm run` in package.json
- All DB writes use upsert patterns (ON CONFLICT DO UPDATE)
- Full recompute model (no incremental state in app_kv) — same as compute-stats

### Integration Points
- Input: `advanced_team_game_stats`, `advanced_player_game_stats` (from Phase 5)
- Input: `rolling_team_stats`, `rolling_player_stats` (from Phase 5)
- Input: `games`, `teams`, `players`, `seasons` tables (reference data)
- Input: `game_team_box_scores`, `game_player_box_scores` (for streak/milestone detection)
- Output: `insights` table — consumed by Phase 9 (API Layer) via `/api/insights` and embedded in page endpoints
- Live output: returned directly from `/api/live` (Phase 7+9 wire this up)

</code_context>

<specifics>
## Specific Ideas

- `npm run generate-insights` mirrors `npm run compute-stats` — same mental model
- The `scripts/lib/insights/` subdirectory follows how Phase 5 split `advanced-stats.ts` and `rolling-windows.ts` as separate lib modules
- Live generator function is pure (no side effects, no DB writes) — easier to test and reason about
- Scoring run detection: track consecutive scoreless possessions for one team vs scoring by the other. 8-0 threshold is per REQUIREMENTS.
- Clutch alert: game_clock <= 5:00 AND period >= 4 AND abs(home_score - away_score) <= 8

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-insight-engine*
*Context gathered: 2026-03-06*
