# Codebase Concerns

**Analysis Date:** 2026-03-05

---

## Status: Pre-Implementation Planning Stage

This project is entirely in the planning/documentation phase. No application code, database migrations, ingestion scripts, or frontend code exist yet. The concerns identified here are architectural risks, design gaps, and known complexity hotspots drawn from the planning documents.

---

## Tech Debt

**Duplicated / Conflicting Design System:**
- Issue: `design-system/clippers-command-center/MASTER.md` contains two distinct design system definitions concatenated together. The first definition uses a light background (`#F8FAFC`), generic blue palette, and lists "Webinar Registration" as the page pattern. The second definition (the correct one) uses a dark background (`#0F172A`), Clippers color palette, and sports analytics patterns. The live page override file `design-system/clippers-command-center/pages/live.md` is similarly duplicated.
- Files: `design-system/clippers-command-center/MASTER.md`, `design-system/clippers-command-center/pages/live.md`
- Impact: Any AI agent or developer reading these files will encounter ambiguous, conflicting design rules. The wrong (webinar/light-mode) rules could bleed into generated UI code. The live page override also incorrectly references a webinar-style section structure ("Hero + Speaker Bio + Urgency") before the correct analytics-specific override.
- Fix approach: Deduplicate both files, keeping only the second (sports analytics) definition in each. Remove all webinar/registration/speaker/CTA content from both files.

**`DESIGN-SYSTEM.md` Referenced but Missing:**
- Issue: `Docs/WIREFRAMES.md` line 19 references `docs/DESIGN-SYSTEM.md` as a governing document ("Visual styling must follow: docs/DESIGN-SYSTEM.md"). This file does not exist in `Docs/`. The design system lives at `design-system/clippers-command-center/MASTER.md` instead.
- Files: `Docs/WIREFRAMES.md`, `design-system/clippers-command-center/MASTER.md`
- Impact: Planning documents point to a non-existent file. AI agents parsing WIREFRAMES.md may look for a non-existent artifact, causing confusion about authoritative design rules.
- Fix approach: Either create `Docs/DESIGN-SYSTEM.md` as a pointer/redirect to the correct location, or update the reference in WIREFRAMES.md to the correct path.

**`minutes` Field Stored as Text in `game_player_box_scores`:**
- Issue: `DB_SCHEMA.sql` line 155 stores player minutes as a provider-formatted TEXT string (e.g., `"34:12"`) rather than a numeric value. The comment says "can parse later."
- Files: `Docs/DB_SCHEMA.sql`
- Impact: All downstream consumers (advanced stats calculations, rolling window aggregates, player trend displays) must parse this string before doing math. This is fragile and error-prone across multiple job implementations. Any provider that formats minutes differently will silently corrupt computation.
- Fix approach: Either normalize on ingest (convert to decimal minutes as REAL, e.g., `34.2`) or add a computed column. Store raw string in `raw_payload` only. Define a canonical `minutes_decimal` column.

**`rolling_player_stats` Missing Key Metrics:**
- Issue: `DB_SCHEMA.sql` `rolling_player_stats` table stores only `points`, `rebounds`, `assists`, `ts_pct`, `efg_pct`, `minutes`. The API spec (`API_SPEC.md` player endpoint) returns these for the trends page, but the schema omits steals, blocks, turnovers, and FG splits — all of which appear in the player game log and trend views in the wireframe. The `rolling_team_stats` has similar gaps (no raw FG/3PT/FT counts).
- Files: `Docs/DB_SCHEMA.sql`, `Docs/API_SPEC.md`
- Impact: Either the rolling stats table must be queried alongside `game_player_box_scores` on every player trends page request (defeating the purpose of pre-aggregation), or the dashboard will display fewer stats than the wireframe requires.
- Fix approach: Add steals, blocks, turnovers, fg_made, fg_attempted, fg3_made, fg3_attempted to `rolling_player_stats` before implementation begins.

**Live Insights Generated On-Demand Without a Persistence Contract:**
- Issue: `Docs/INGESTION_PLAN.md` Section 6 recommends generating live insights on-demand inside `/api/live` rather than persisting them. However, `Docs/DB_SCHEMA.sql` and `Docs/API_SPEC.md` define an `insights` table and all insight responses require `proof_sql`, `proof_params`, `proof_result`. The in-memory approach sidesteps the persistence model but must still produce proof payloads. The two approaches are not reconciled in detail.
- Files: `Docs/INGESTION_PLAN.md`, `Docs/DB_SCHEMA.sql`, `Docs/API_SPEC.md`
- Impact: Implementers will make ad-hoc decisions about whether live insights are stored in the `insights` table, stored temporarily, or built entirely in-memory. Without a clear contract, proof data may be omitted or shaped inconsistently.
- Fix approach: Decide and document before implementation: either (a) live insights are generated and written to `insights` with a short `valid_to` TTL, or (b) live insights are built in-memory and returned in a separate `live_insights` response shape that is documented as non-persistent.

---

## Security Considerations

**No Authentication for MVP — Documented Non-Goal with Future Risk:**
- Risk: The application explicitly has no authentication (`Docs/ARCHITECTURE.md` Section 11, `Docs/PROJECT.md`). All API endpoints are open GET routes. The architecture note says "keep path open but don't design for it yet."
- Files: `Docs/ARCHITECTURE.md`, `Docs/API_SPEC.md`
- Current mitigation: Personal-use only. No write endpoints in MVP.
- Recommendations: Before any public exposure, add at minimum a simple shared-secret API key header check or basic auth at the reverse proxy level. Document this explicitly in ARCHITECTURE.md as a pre-public prerequisite. The current docs make no mention of how to harden for even minimal exposure.

**API Keys in Environment Variables Without Documented Example File:**
- Risk: `Docs/ARCHITECTURE.md` Section 10 says to use `.env` and `.env.example` (commit the example). No `.env.example` file exists yet.
- Files: `Docs/ARCHITECTURE.md`
- Current mitigation: None — project is pre-implementation.
- Recommendations: Create `.env.example` early in Phase 4 before any ingestion code runs. This prevents secrets from accidentally entering the repository if a developer sets up `.env` before the example file is established.

**`proof_sql` Stored in Database Could Enable SQL Injection at the Application Layer:**
- Risk: The `insights` table stores raw SQL strings in `proof_sql`. If any code path re-executes proof queries dynamically (for verification or re-proof), this is a potential injection surface if `proof_params` values are not sanitized.
- Files: `Docs/DB_SCHEMA.sql`
- Current mitigation: Not yet implemented, so no active risk.
- Recommendations: When implementing proof re-execution, always use parameterized queries. Treat `proof_sql` as a template and `proof_params` as separately bound parameters. Never string-interpolate proof params into proof SQL.

---

## Performance Bottlenecks

**`live_snapshots` Table Will Grow Unboundedly Without a Retention Policy:**
- Problem: `live_snapshots` stores a row every ~12 seconds for every active Clippers game. A full NBA season is ~82 Clippers games × ~2.5 hours × 300 snapshots/hour = ~61,500 rows per season minimum. Over 3 seasons this is ~185,000 rows — manageable, but with no defined cleanup or archival strategy this grows indefinitely.
- Files: `Docs/DB_SCHEMA.sql`, `Docs/INGESTION_PLAN.md`
- Cause: No retention policy is defined in schema or ingestion plan.
- Improvement path: Add a retention policy (e.g., keep snapshots only for the last 30 days unless the game is recent). Archive older snapshots to `raw_payload` in `game_team_box_scores` or a cold storage bucket. Index on `game_id, captured_at DESC` is already present which will help queries, but table bloat still occurs.

**`insights` Table Has No Cleanup for Stale `is_active=false` Rows:**
- Problem: The `generate_insights_batch` job inserts/updates insights and sets `is_active`. Over time the table will accumulate deactivated insights with no defined archival or TTL cleanup strategy.
- Files: `Docs/DB_SCHEMA.sql`, `Docs/INGESTION_PLAN.md` Section 4.8
- Cause: No explicit cleanup for old inactive insights.
- Improvement path: Add periodic cleanup of `is_active=false` insights older than N seasons, or implement a soft-delete with a retention window. For now, add this to the `generate_insights_batch` job specification.

**`/api/live` On-Demand Live Insight Generation Could Cause Slow Responses:**
- Problem: The recommended MVP approach generates live insights on every `/api/live` request rather than from pre-computed rows. The insights require querying rolling stats, historical data, and game snapshots. The performance requirement in `Docs/MVP_CHECKLIST.md` is `/api/live` response under 200ms, which is aggressive if 3–5 insight queries run inline.
- Files: `Docs/INGESTION_PLAN.md` Section 6, `Docs/MVP_CHECKLIST.md` Section 14
- Cause: Design tension between simplicity (in-memory) and performance (< 200ms).
- Improvement path: Either (a) persist live insights to the `insights` table with `valid_to` TTL so `/api/live` just reads them, or (b) cache the computed live insight set for 5 seconds in a server-side cache. Document which approach is chosen before implementation.

**`rolling_player_stats` and `rolling_team_stats` Have No Cross-Season Boundary Logic Defined:**
- Problem: Rolling windows (last 5, last 10 games) will silently cross season boundaries unless explicitly excluded. A player's last 5 games in the new season may aggregate with their last games of the previous season.
- Files: `Docs/DB_SCHEMA.sql`, `Docs/INGESTION_PLAN.md` Section 4.7
- Cause: The `compute_rolling_windows` job spec does not define cross-season boundary behavior.
- Improvement path: Specify in the `compute_rolling_windows` job whether windows are season-scoped or calendar-scoped. Most basketball contexts expect season-scoped rolling windows.

---

## Fragile Areas

**`finalize_completed_games` Job Fragility — Partial Write Recovery:**
- Files: `Docs/INGESTION_PLAN.md` Section 4.4
- Why fragile: The spec says "if team box score ingested but player box score fails, mark job incomplete and retry." The mechanism for "mark job incomplete" is not defined (use `app_kv`? a separate table? a flag on the `games` row?). Without a concrete contract, implementations may differ and recovery may be inconsistent.
- Safe modification: Define a concrete failed-game-id retry list in `app_kv` before implementation. Key like `finalize_games:retry_queue` storing an array of `game_id` values.
- Test coverage gap: No test plan exists for partial write recovery across the finalization pipeline.

**`sync_schedule` Status Monotonicity Rule Is Not Enforced at the DB Level:**
- Files: `Docs/DB_SCHEMA.sql`, `Docs/INGESTION_PLAN.md` Section 4.2
- Why fragile: The ingestion plan says status must transition monotonically (`scheduled → in_progress → final`). This is an application-level rule only — the `games.status` column is a plain TEXT field with no DB constraint enforcing valid transitions. A buggy provider response or ingestion bug could set a `final` game back to `scheduled`.
- Safe modification: Add a DB check constraint or trigger to prevent backward status transitions, or handle it in application logic with explicit guards before any `UPDATE games SET status = ...`.

**`odds_snapshots` Unique Constraint May Cause Silent Duplicate Failures:**
- Files: `Docs/DB_SCHEMA.sql`
- Why fragile: The unique constraint on `odds_snapshots` is `(game_id, provider, captured_at)`. If the odds provider returns the same odds data multiple times within the same second, and captured_at has second-level resolution, inserts will fail silently. The ingestion plan says to insert append-only rows but doesn't address this collision case.
- Safe modification: Use `INSERT ... ON CONFLICT DO NOTHING` or round `captured_at` to a defined granularity (e.g., truncate to the minute) when inserting.

**Backfill Job Has No Atomic Progress Checkpoint:**
- Files: `Docs/INGESTION_PLAN.md` Section 4.9
- Why fragile: `backfill_historical_seasons` stores progress in `app_kv` (`historical_backfill:last_cursor`, `historical_backfill:last_completed_season`), but the spec does not define what constitutes a safe checkpoint. If the backfill job fails mid-season, the cursor may point to an inconsistent state (some games written, others not).
- Safe modification: Define checkpointing at the individual game level rather than season level. Store the last successfully finalized `game_id` per season, not just a season-level cursor.

---

## Scaling Limits

**BALLDONTLIE API Rate Limits — No Plan for Historical Backfill:**
- Current capacity: BALLDONTLIE free tier typically imposes strict rate limits (e.g., 30–60 requests/minute on free tier).
- Limit: Ingesting 3 seasons of full-league game data (roughly 3,600+ games) with team and player box scores for each game could require thousands of API calls. At 30 requests/minute this could take hours.
- Scaling path: Implement the backfill with explicit rate limit handling and retry-with-backoff. Store all raw payloads in `raw_payload` JSONB columns so individual endpoints are called once. Document expected backfill runtime before execution.

**`live_snapshots.payload` JSONB Size With Full NBA Live Payloads:**
- Current capacity: NBA live JSON endpoints return dense payloads (~20–50KB per response including all player stats).
- Limit: At ~12-second polling over a 2.5-hour game, that is ~750 snapshots × 50KB = ~37MB of JSONB per game stored uncompressed in PostgreSQL. Over a full season of Clippers games this is ~3GB of JSONB payload in one table.
- Scaling path: Consider compressing raw payloads (PostgreSQL TOAST compression helps, but check actual storage). Alternatively, store only extracted fields and drop the full payload after 7 days.

**Neon/Supabase Free Tier Database Size Limits:**
- Current capacity: Neon free tier offers 512MB storage; Supabase free tier offers 500MB. With historical data, live snapshots, and rolling stats for 3 seasons this will likely exceed free tier limits.
- Limit: The `live_snapshots` payload column alone could fill free tier storage within a single season.
- Scaling path: Plan for paid DB tier from the start, or implement payload compression and retention policies. Document storage estimates in ARCHITECTURE.md before deployment.

---

## Missing Critical Features

**No Health Endpoint Defined in API Spec:**
- Problem: `Docs/MVP_CHECKLIST.md` Section 1 says "MVP_CHECKLIST verification: `/api/health` (or similar test endpoint) returns status OK." However, `Docs/API_SPEC.md` contains no definition for this endpoint.
- Blocks: System boot validation and operational monitoring per the MVP checklist.

**No Defined Mechanism for "Other Games" Data in `/api/live`:**
- Problem: `Docs/API_SPEC.md` `/api/live` returns `other_games` (scores and notes for relevant non-Clippers games). The notes field includes Clippers-relevant context (e.g., "Warriors loss improves Clippers tiebreak outlook"). There is no ingestion job, data source, or computation pipeline defined for generating these contextual notes.
- Files: `Docs/API_SPEC.md`, `Docs/INGESTION_PLAN.md`
- Blocks: Implementation of the "Other Games Context Panel" on the live dashboard.

**Conference Standings / Seed Data Not Covered by Any Ingestion Job:**
- Problem: `Docs/API_SPEC.md` `/api/home` returns `team_snapshot.conference_seed`. `Docs/WIREFRAMES.md` shows conference position in the team snapshot. No ingestion job in `Docs/INGESTION_PLAN.md` defines a source or sync cadence for standings/seed data.
- Files: `Docs/API_SPEC.md`, `Docs/INGESTION_PLAN.md`
- Blocks: Home dashboard team snapshot will be incomplete.

**No Defined Migration or Schema Versioning Strategy:**
- Problem: `Docs/DB_SCHEMA.sql` uses `CREATE TABLE IF NOT EXISTS` throughout, which is appropriate for initial setup but provides no mechanism for evolving the schema (adding columns, changing constraints) once deployed. No migration tool (e.g., Flyway, Alembic, Prisma Migrate, Drizzle) is mentioned in any planning document.
- Files: `Docs/DB_SCHEMA.sql`, `Docs/ARCHITECTURE.md`
- Blocks: Any schema change after initial deployment requires a manual migration with no tracking.

**No Cron/Scheduler Implementation Path for 12-Second Live Polling:**
- Problem: `Docs/INGESTION_PLAN.md` Section 11 notes that GitHub Actions cannot run at 12-second intervals (minimum is 5 minutes). The plan defers this to "the app host or a lightweight worker" without specifying how. For Vercel (the recommended hosting option), long-running background processes are not supported.
- Files: `Docs/INGESTION_PLAN.md`, `Docs/ARCHITECTURE.md`
- Blocks: The core Live Game experience — the highest-priority feature — has no concrete implementation path for its polling mechanism in the current hosting/infra plan.

---

## Test Coverage Gaps

**No Testing Infrastructure Defined:**
- What's not tested: Nothing — no test framework, test files, or testing patterns have been defined or planned.
- Files: No test files found anywhere in the repository.
- Risk: All ingestion jobs, advanced stats formulas, insight generation logic, and API routes will be written without any automated test coverage unless explicitly planned.
- Priority: High — especially for the advanced stats calculations (possessions, pace, ratings) where correctness must be validated against known values, as noted in `Docs/ROADMAP.md` Phase 5 verification.

**No Validation Tests for Advanced Stats Formulas:**
- What's not tested: The formulas for possessions, pace, offensive/defensive rating, eFG%, TS% are not specified in any document (only named). There is no reference implementation or known-value test cases to validate against.
- Files: `Docs/INGESTION_PLAN.md` Section 4.6, `Docs/ROADMAP.md` Phase 5
- Risk: Silently incorrect advanced stats that pass all data-existence checks but produce wrong numbers. These feed directly into insights and dashboard displays.
- Priority: High — add unit tests with known NBA box score inputs and expected output values before the advanced stats engine is considered complete.

**No Integration Tests for Job Chain Defined:**
- What's not tested: The full pipeline from `finalize_completed_games` → `compute_advanced_stats` → `compute_rolling_windows` → `generate_insights_batch` has no integration test plan.
- Files: `Docs/INGESTION_PLAN.md`
- Risk: Partial failures in the chain produce incomplete data silently. The healthcheck job (`healthcheck_data_freshness`) provides some observability but does not substitute for pipeline integration tests.
- Priority: Medium — add a staging run against a known historical game as a regression baseline.

---

*Concerns audit: 2026-03-05*
