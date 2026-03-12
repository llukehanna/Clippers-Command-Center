# Phase 4: Historical Data Ingestion - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Populate the database with 3 full seasons of NBA data (all teams, including playoffs) using the BALLDONTLIE API. Delivers games, teams, players, and box scores into the DB so the stats and insight engines have real data to work with. Advanced stats computation, rolling windows, and insight generation are separate phases.

This phase also includes the Next.js project scaffold — it is the first code phase.

</domain>

<decisions>
## Implementation Decisions

### Project Scaffold
- Phase 4 creates the Next.js project from scratch (package.json, tsconfig, dependencies)
- Dependencies: Next.js (App Router), TypeScript, shadcn/ui, Recharts, Tailwind, `postgres` npm package (sql template tag)
- DB client: `postgres` — lightweight, TypeScript-native, works well with Neon's serverless driver
- Schema applied by running `Docs/DB_SCHEMA.sql` directly against Neon (no ORM migrations)
- Environment: `.env.local` with `DATABASE_URL` and `BALLDONTLIE_API_KEY` — fail fast with a clear message if missing

### Script Location and Invocation
- Ingestion scripts live in `scripts/` directory (e.g., `scripts/backfill.ts`)
- Invoked via npm script: `npm run backfill` (using `tsx` or similar)
- Keeps data pipeline code separate from the Next.js app layer
- The backfill is a one-time operation run manually from local machine pointing at Neon

### Season Scope
- Seasons: **2022-23, 2023-24, 2024-25** (3 most recent)
- Coverage: **All NBA teams** — needed for league comparisons and opponent context in the insight engine
- Playoffs: **Included** in all 3 seasons
- For the in-progress 2024-25 season: **completed games only** — skip games where status ≠ final during backfill; `finalize_completed_games` handles those once they complete

### Pipeline Scope
- Phase 4 = **raw ingestion only**: games, teams, players, and box scores into the DB
- Does NOT trigger advanced stats, rolling windows, or insights — those are phases 5 and 6
- This keeps the phase focused and its success criteria testable independently

### Progress Tracking
- **Season-level checkpoints** via `app_kv` table: track last completed season (e.g., `backfill:last_completed_season`)
- If interrupted, resume from the next unprocessed season
- Console progress output per season and per batch — log season start, game count, completions, errors
- Final summary lists total counts and any skipped game IDs

### Rate Limiting
- Fixed ~1 second delay between BALLDONTLIE API requests (stays comfortably under 60 req/min free tier)
- On 429 or temporary errors: exponential backoff with up to 3 retries, then log the failure and continue to next game
- Idempotency ensures re-running the script fills any gaps from failed requests
- BALLDONTLIE API key required — `BALLDONTLIE_API_KEY` env var must be set; script exits with clear error if missing

### Incomplete Data Handling
- If a game's box score is missing or clearly incomplete (null team scores), skip it and log the game ID
- Script summary at end lists all skipped games for manual review
- No partial inserts — if a game's box score can't be cleanly ingested, skip the whole game

### Idempotency
- All writes use upsert patterns — re-running the script does not create duplicate records
- Success criteria from roadmap: re-running ingestion must not create duplicates

### Claude's Discretion
- Exact delay timing (1s is the floor; could be slightly more between seasons/batches)
- Whether to add a `--dry-run` flag for the backfill script
- Internal batching strategy within a season (e.g., process month-by-month or game-by-game)
- Exact console output format (just needs to be readable progress + summary)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- None yet — this is the first code phase. Project is created from scratch.

### Established Patterns
- DB_SCHEMA.sql is the authoritative schema — apply directly to Neon, no ORM translation
- `app_kv` table (defined in schema) is the designated store for job checkpoints and runtime state
- All write operations must be idempotent (upsert patterns)

### Integration Points
- `scripts/backfill.ts` → Neon PostgreSQL (via `postgres` npm client)
- BALLDONTLIE REST API → scripts → `games`, `teams`, `players`, `player_team_stints`, `game_team_box_scores`, `game_player_box_scores` tables
- `app_kv` table tracks backfill progress checkpoints

</code_context>

<specifics>
## Specific Ideas

- `npm run backfill` as the entry point (not a raw tsx invocation)
- Season-by-season processing order: 2022-23 → 2023-24 → 2024-25
- The script should feel like a professional ETL tool: clear progress lines, informative summary, deterministic behavior

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-historical-data-ingestion*
*Context gathered: 2026-03-05*
