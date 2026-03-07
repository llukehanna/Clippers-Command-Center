# Phase 9: API Layer - Context

**Gathered:** 2026-03-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the 10 Next.js App Router API route handlers that expose backend data to the frontend. All endpoints are GET-only, Clippers-centric, and must include a `meta` envelope. No UI work. Display logic lives in Phases 10–14. Data sources (DB, odds, insight engine) are all built — this phase wires them to HTTP.

</domain>

<decisions>
## Implementation Decisions

### Live endpoint data source
- Query `live_snapshots` table only — the poll-live daemon (Phase 7) keeps it fresh at ~12s cadence
- No CDN calls from the API route — `/api/live` is pure DB, ensuring the 200ms SLA is achievable
- If the latest snapshot is stale (poll daemon down), set `meta.stale = true` and `state = "DATA_DELAYED"` — serve the last snapshot as-is
- When no Clippers game is active: return `state: "NO_ACTIVE_GAME"`, `game: null`, `key_metrics: []`, `box_score: null`, `insights: []`, `other_games: []`

### Live key_metrics computation
- Compute eFG%, TO margin, rebound margin, and pace on the fly from the raw box score data stored in the live snapshot
- Use the same formulas as the advanced stats engine (Phase 5)
- Do not query `advanced_stats` table during live games — it only has post-game rows

### team_snapshot data for /api/home
- `conference_seed`: return `null` — no standings table exists; do not derive or fabricate
- `net_rating`, `off_rating`, `def_rating`: query `rolling_team_stats` for LAC's most recent window; return `null` if no rows exist (data is sparse until Phase 7 finalizes more games)
- `last_10`: compute from `games` table — query most recent 10 LAC games by `game_date`, count wins/losses from score columns; this is real data we have

### Historical box score gaps
- Phase 4 removed historical box score backfill — most historical games have no rows in `game_player_box_scores`
- `/api/history/games/{id}` returns: `box_score: { columns: [...], teams: [{players: [], totals: {}}, ...], available: false }`
- `available: false` flag lets the UI render "Box score not available" rather than an empty table
- For games finalized by the live pipeline (Phase 7 onwards), `available: true` and player rows populate normally

### Historical insights
- Query `generated_insights` WHERE `game_id = {id}` — return whatever exists, empty array if nothing
- The 2 seeded games (LAC vs MIA, LAC vs PHX) will have insights; most historical games won't
- No special handling — query, return, done

### Player selection for /api/home trends
- "Top players" = highest average minutes in last 10 LAC games from `game_player_box_scores`
- Return top 8 players — automatically reflects the actual rotation; injured/DNP players drop out naturally
- If box score data is sparse (few finalized games), return fewer players rather than padding

### Player roster for /api/players
- Filter by `team_id = LAC_TEAM_ID` from `players` table (populated by Phase 4 BDL ingestion)
- `active_only=true` default — filter by `is_active = true`
- Straightforward DB query; does not rely on game appearance history

### Rolling averages when data is absent
- `/api/players/{id}`: if no rows in `rolling_player_stats` for this player, return `trend_summary: null` and `charts: { rolling_pts: [], rolling_ts: [] }`
- Never return zeroes for missing data — null is honest, zero is misleading

### Claude's Discretion
- DB client pattern for Next.js routes (create `src/lib/db.ts` as a Next.js-safe singleton — no `process.exit`, throws instead)
- Exact SQL query organization (co-locate in route files or extract to `src/lib/queries/`)
- `meta.stale` staleness threshold for non-live endpoints (reasonable default: snapshot age > TTL)
- Pagination cursor encoding for `/api/history/games`
- Error envelope implementation details

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/odds.ts` → `getLatestOdds(gameId: string)`: ready to call from `/api/live`, `/api/home`, `/api/schedule`; returns `captured_at` for `meta.stale` computation without extra query
- `src/lib/insights/live.ts`: live insight generators — call on-demand from `/api/live` when game is active
- `src/lib/types/live.ts`: `LiveGameState`, all NBA live JSON types, `BoxscoreTeam`, `PlayerStatistics` — use for typing snapshot payloads
- `src/lib/types/odds.ts`: `OddsSnapshot` type — already typed for API route responses
- `scripts/lib/db.ts`: `sql` template tag pattern to replicate in `src/lib/db.ts` (Next.js-safe version without `process.exit`)
- `scripts/lib/poll-live-logic.ts`: exports `LAC_TEAM_ID` — import or re-declare in API layer

### Established Patterns
- All prior scripts use `sql` template tag from `scripts/lib/db.ts` — same pattern for API routes, different client file
- `bigint` FK values fetched as `::text` and cast back — carry forward for all game_id/player_id queries (Phase 04-02 decision)
- `NUMERIC` columns cast to `float8` in SELECT for JS number compatibility — carry forward for advanced stats fields (Phase 08 decision)
- `captured_at::text` returned as ISO string — carry forward from odds helper

### Integration Points
- `live_snapshots` table: source for `/api/live` — latest snapshot for active game detection and data
- `games` table: source for schedule, last_10 win/loss computation, upcoming game detection
- `game_player_box_scores` / `game_team_box_scores`: source for historical box scores and player minute-ranking
- `generated_insights`: source for all insight endpoints (live, home, historical game detail)
- `rolling_team_stats` / `rolling_player_stats`: source for trend data in home + player endpoints
- `odds_snapshots`: accessed via `getLatestOdds()` — already abstracted
- No `src/app/api/` directory exists yet — Phase 9 creates it from scratch

</code_context>

<specifics>
## Specific Ideas

- The API spec (Docs/API_SPEC.md) is the authoritative contract — treat all field names, shapes, and rules there as locked
- `meta.stale` for `/api/live` comes from `LiveGameState.is_stale` stored in the snapshot, not recomputed in the route
- Performance SLAs are hard constraints: `/api/live` < 200ms, `/api/home` < 300ms, `/api/history/*` < 400ms — all achievable with DB-only queries

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 09-api-layer*
*Context gathered: 2026-03-06*
