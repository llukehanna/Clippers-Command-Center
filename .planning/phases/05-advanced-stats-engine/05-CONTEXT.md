# Phase 5: Advanced Stats Engine - Context

**Gathered:** 2026-03-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Compute derived metrics (advanced stats + rolling windows) from box score data and store results in `advanced_team_game_stats`, `advanced_player_game_stats`, `rolling_team_stats`, and `rolling_player_stats` tables. This phase builds and validates the computation engine.

Box scores are not fully populated yet (Phase 7 delivers historical box scores via NBA live JSON). Phase 5 seeds 2-3 real games with hardcoded box scores to prove the engine works, then leaves the scripts ready to run at full scale after Phase 7.

Rolling windows and advanced stats are NOT computed on-demand — they are pre-computed and stored so dashboards and the insight engine can query them directly with no computation at request time.

</domain>

<decisions>
## Implementation Decisions

### Data Availability Strategy
- Box scores don't exist at Phase 5 time — Phase 7 (NBA live JSON) populates them at scale
- Phase 5 seeds **2-3 real Clippers games** with hardcoded box scores sourced from Basketball-Reference
- These are real historical records — they stay in the DB permanently; Phase 7 will upsert on top via idempotent writes
- Seeded games serve as both the validation fixture and the first real data in the DB

### Invocation Model
- Single command: `npm run compute-stats`
- Script lives in `scripts/compute-stats.ts` (same pattern as `scripts/backfill.ts`)
- Runs both advanced stats and rolling windows in sequence (one pass)
- **Full recompute every run** — no incremental tracking. With 3 seasons of games, full recompute is fast enough; no `app_kv` checkpoint needed for this script
- Designed to be re-run at any time (idempotent upserts)

### Stats Coverage
**Team-level (per game):** `advanced_team_game_stats`
- possessions, pace, off_rating, def_rating, net_rating, eFG%, TS%, TOV%, REB%

**Team rolling windows:** `rolling_team_stats`
- Windows: last 5 and last 10 games per season
- Stats: off_rating, def_rating, net_rating, pace, eFG%, TS%, TOV%, REB%, record (wins/losses)
- All NBA teams (needed for league comparisons and opponent context in Phase 6)

**Player-level (per game):** `advanced_player_game_stats`
- usage_rate, TS%, eFG%, ast_rate, reb_rate, tov_rate

**Player rolling windows:** `rolling_player_stats`
- Windows: last 5 and last 10 games per season
- Stats: pts, reb, ast, TS%, eFG%, minutes
- All players with box score data (not Clippers-only — needed for league comparisons)

### Validation
- After running `compute-stats` against the 2-3 seeded games, compare computed **eFG%** against the same games on Basketball-Reference.com
- Pass threshold: within **1% tolerance** (e.g., computed 0.542, reference 0.548 -> pass)
- eFG% formula: `(FGM + 0.5 * FG3M) / FGA` — simplest advanced stat, widely published
- One game validated is sufficient for Phase 5 success criteria

### Claude's Discretion
- Exact formula implementations for possessions and ratings (use Dean Oliver's standard 4-factor formulas)
- Which 2-3 specific Clippers games to seed (any clear-cut final regular season games work)
- Console output format for compute-stats (progress + final counts, consistent with backfill style)
- Whether to add `--dry-run` flag

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/lib/db.ts`: `sql` template tag (postgres npm package) — use for all queries
- `scripts/lib/upserts.ts`: Pattern reference for upsert functions — follow same style
- `scripts/backfill.ts`: Invocation pattern, progress logging style, summary output — mirror this

### Established Patterns
- All DB writes use upsert patterns (ON CONFLICT DO UPDATE) — must follow for compute-stats too
- `postgres` sql template tag for all queries — no ORM
- Scripts in `scripts/` directory, invoked via `npm run` in package.json
- `app_kv` table for job checkpoints (not needed for full-recompute compute-stats, but available if needed)

### Integration Points
- Input: `game_team_box_scores` -> `advanced_team_game_stats` + `rolling_team_stats`
- Input: `game_player_box_scores` -> `advanced_player_game_stats` + `rolling_player_stats`
- Input: `games` table (for game ordering, season context, is_home flag)
- Input: `seasons` table (for season_id FK on rolling window rows)
- Output: All four derived tables — consumed by Phase 6 (Insight Engine) and Phase 9 (API Layer)
- Seed script: inserts rows into `game_team_box_scores` and `game_player_box_scores` directly

</code_context>

<specifics>
## Specific Ideas

- `npm run compute-stats` mirrors `npm run backfill` — same mental model, different operation
- Seeded games should be recent Clippers games with clean final box scores (not OT, not postponed)
- The seed script is a one-time utility (`scripts/seed-test-games.ts` or similar) — not part of the main compute-stats flow
- Validation is manual (developer looks up eFG% on Basketball-Reference and compares) — not an automated test

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-advanced-stats-engine*
*Context gathered: 2026-03-06*
