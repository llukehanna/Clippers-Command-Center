# Phase 8: Odds Integration - Context

**Gathered:** 2026-03-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the `sync-odds` ingestion job and provider adapter layer. Odds data writes append-only to `odds_snapshots`. Also includes the query helper that future API/UI phases consume. Display of odds in the UI is handled by later phases (9, 12, 14).

</domain>

<decisions>
## Implementation Decisions

### Provider selection
- **The Odds API** (theoddsapi.com) — free tier (500 requests/month is sufficient at 6h cadence)
- API key stored as `ODDS_API_KEY` in `.env` (never committed)
- Fetch all NBA game odds from The Odds API, then filter to Clippers games in code by matching against `games` table
- Adapter pattern: TypeScript `OddsAdapter` interface defined in `src/lib/types/`, with `TheOddsApiAdapter` as the concrete implementation in `scripts/lib/`
- Swapping providers = instantiating a different adapter class in `sync-odds.ts`, no other changes needed

### Stale data threshold
- Odds older than **24 hours** are treated as unavailable — query returns `null` instead of stale data
- If no snapshot exists at all, return `null`
- Query helper shape: `{ spread_home, spread_away, moneyline_home, moneyline_away, total_points, captured_at } | null`
- `captured_at` is included so downstream API phases can populate `meta.stale` without re-querying

### GitHub Actions wiring
- Include `.github/workflows/sync-odds.yml` in this phase (workflow file ready; won't execute until GitHub secrets are configured)
- Cron: every 6 hours (`0 */6 * * *`) — matches INGESTION_PLAN.md spec
- No extra pre-game run — simple is sufficient for a personal tool

### Script entry point
- Follows established pattern: `scripts/sync-odds.ts`, invoked via `npm run sync-odds`
- One log line per game processed, summary at end (mirrors backfill/compute-stats style)
- On provider failure: log warning, write nothing, keep existing snapshots — do NOT exit hard

### Claude's Discretion
- Exact The Odds API endpoint URL and response field mapping to `odds_snapshots` columns
- `OddsAdapter` interface method signature details
- `app_kv` key name for tracking `odds_sync:last_success_at`
- Error handling details within the adapter

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/lib/db.ts`: `sql` template tag — use for all DB queries in sync-odds
- `scripts/lib/bdl-client.ts` / `scripts/lib/nba-live-client.ts`: Pattern to mirror for `scripts/lib/odds-client.ts` (typed HTTP client)
- `scripts/lib/upserts.ts`: Upsert helper pattern — odds uses INSERT (append-only), not upsert
- `app_kv` table: checkpoint pattern for recording `odds_sync:last_success_at`

### Established Patterns
- `scripts/` directory with `npm run` entry points — all Phase 4–7 jobs follow this
- One log line per operation + summary at end
- Never overwrite historical rows — append-only (same as `live_snapshots`)
- Idempotency: `CONSTRAINT uq_odds_snapshot UNIQUE (game_id, provider, captured_at)` already on the table

### Integration Points
- `odds_snapshots` table: already in `Docs/DB_SCHEMA.sql` — columns `game_id`, `provider`, `captured_at`, `spread_home`, `spread_away`, `moneyline_home`, `moneyline_away`, `total_points`, `raw_payload`
- `games` table: query upcoming Clippers games to know which game IDs to fetch odds for
- `src/lib/types/`: add `OddsAdapter` interface and `OddsSnapshot` type here (mirrors `LiveSnapshot` pattern from Phase 7)
- `.github/workflows/`: add `sync-odds.yml` alongside existing workflow files

</code_context>

<specifics>
## Specific Ideas

- "Fetch all NBA games, filter to LAC in code" — don't try to query The Odds API per-game; pull the full NBA slate and match against our `games` table by date/teams
- The free tier (500 req/month) at 6-hour cadence for a handful of upcoming games is well within limits — no need to optimize request count
- Query helper returns `captured_at` alongside odds values so Phase 9 API routes can compute `meta.stale` without an extra query

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 08-odds-integration*
*Context gathered: 2026-03-06*
