# Phase 9: API Layer - Research

**Researched:** 2026-03-06
**Domain:** Next.js App Router API routes (route.ts) — DB-only REST endpoints
**Confidence:** HIGH

## Summary

Phase 9 creates `src/app/api/` from scratch. The Next.js app directory does not yet exist; the entire API surface is new. All data sources (postgres DB via `sql` template tag, `getLatestOdds()`, insight generators) are already built and imported-ready. The work is mechanical: read the locked API_SPEC.md shapes, wire the right SQL queries to the right endpoints, and wrap every response in the `meta` envelope.

The key architectural constraint is that `src/lib/odds.ts` currently imports from `scripts/lib/db.ts` — the first task of this phase must create `src/lib/db.ts` as a Next.js-safe DB singleton (no `process.exit`, throws on missing `DATABASE_URL`), and `src/lib/odds.ts` must be updated to import from it. All other DB queries in API routes will also import from `src/lib/db.ts`.

The API contract is fully locked in `Docs/API_SPEC.md` — field names, response shapes, error envelopes, and meta structure are not up for debate. The planner should treat each endpoint as a mechanical mapping exercise from spec shape to SQL queries.

**Primary recommendation:** Create `src/lib/db.ts` first, update `src/lib/odds.ts` import, then implement one route at a time matching the API_SPEC.md shapes exactly.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Live endpoint data source**
- Query `live_snapshots` table only — the poll-live daemon (Phase 7) keeps it fresh at ~12s cadence
- No CDN calls from the API route — `/api/live` is pure DB, ensuring the 200ms SLA is achievable
- If the latest snapshot is stale (poll daemon down), set `meta.stale = true` and `state = "DATA_DELAYED"` — serve the last snapshot as-is
- When no Clippers game is active: return `state: "NO_ACTIVE_GAME"`, `game: null`, `key_metrics: []`, `box_score: null`, `insights: []`, `other_games: []`

**Live key_metrics computation**
- Compute eFG%, TO margin, rebound margin, and pace on the fly from the raw box score data stored in the live snapshot
- Use the same formulas as the advanced stats engine (Phase 5)
- Do not query `advanced_stats` table during live games — it only has post-game rows

**team_snapshot data for /api/home**
- `conference_seed`: return `null` — no standings table exists; do not derive or fabricate
- `net_rating`, `off_rating`, `def_rating`: query `rolling_team_stats` for LAC's most recent window; return `null` if no rows exist
- `last_10`: compute from `games` table — query most recent 10 LAC games by `game_date`, count wins/losses from score columns

**Historical box score gaps**
- Phase 4 removed historical box score backfill — most historical games have no rows in `game_player_box_scores`
- `/api/history/games/{id}` returns: `box_score: { columns: [...], teams: [{players: [], totals: {}}, ...], available: false }`
- `available: false` flag lets the UI render "Box score not available" rather than an empty table
- For games finalized by the live pipeline (Phase 7 onwards), `available: true` and player rows populate normally

**Historical insights**
- Query `insights` table WHERE `game_id = {id}` — return whatever exists, empty array if nothing
- The 2 seeded games (LAC vs MIA, LAC vs PHX) will have insights; most historical games won't
- No special handling — query, return, done
- NOTE: CONTEXT.md refers to this table as `generated_insights`; the actual table name in DB_SCHEMA.sql and all scripts is `insights`

**Player selection for /api/home trends**
- "Top players" = highest average minutes in last 10 LAC games from `game_player_box_scores`
- Return top 8 players — automatically reflects the actual rotation
- If box score data is sparse (few finalized games), return fewer players rather than padding

**Player roster for /api/players**
- Filter by `team_id = LAC_TEAM_ID` from `players` table via `player_team_stints` (players table has no team_id — a Phase 6 decision)
- `active_only=true` default — filter by `is_active = true`

**Rolling averages when data is absent**
- `/api/players/{id}`: if no rows in `rolling_player_stats` for this player, return `trend_summary: null` and `charts: { rolling_pts: [], rolling_ts: [] }`
- Never return zeroes for missing data — null is honest, zero is misleading

**API spec authority**
- `Docs/API_SPEC.md` is the authoritative contract — treat all field names, shapes, and rules there as locked
- `meta.stale` for `/api/live` comes from `LiveGameState.is_stale` stored in the snapshot, not recomputed in the route
- Performance SLAs are hard constraints: `/api/live` < 200ms, `/api/home` < 300ms, `/api/history/*` < 400ms

### Claude's Discretion
- DB client pattern for Next.js routes (create `src/lib/db.ts` as a Next.js-safe singleton — no `process.exit`, throws instead)
- Exact SQL query organization (co-locate in route files or extract to `src/lib/queries/`)
- `meta.stale` staleness threshold for non-live endpoints (reasonable default: snapshot age > TTL)
- Pagination cursor encoding for `/api/history/games`
- Error envelope implementation details

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| API-01 | GET /api/live returns complete Live Dashboard payload | Live snapshot query + key_metrics computation + live insight generation + odds helper |
| API-02 | GET /api/home returns complete Between-Games Dashboard payload | rolling_team_stats + games last_10 + game_player_box_scores for top players + insights table + odds helper |
| API-03 | GET /api/players and GET /api/players/{id} return player data and trends | players table query via player_team_stints + rolling_player_stats + game_player_box_scores |
| API-04 | GET /api/schedule returns upcoming games with odds | games table WHERE game_date >= today + getLatestOdds per game |
| API-05 | GET /api/history/seasons, /games, /games/{id} return historical data | seasons table + games table with LAC filter + game_player_box_scores with available flag |
| API-06 | GET /api/insights returns eligible insights by scope with proof payloads | insights table with is_active=true filter + scope + importance DESC sort |
| API-07 | All endpoints include meta with generated_at, source, stale, stale_reason, ttl_seconds | Meta envelope pattern — defined once in src/lib/api-utils.ts, applied everywhere |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16.1.6 (installed) | App Router `route.ts` handlers | Already chosen; all API routes are `export async function GET()` in `src/app/api/*/route.ts` |
| postgres (pg) | ^3.4.8 (installed) | SQL template tag for DB queries | Already used in all scripts; same `sql\`...\`` pattern carries forward |
| TypeScript | ^5.9.3 (installed) | Type safety for request/response shapes | All existing code is TypeScript; API routes are `.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| src/lib/odds.ts | (project file) | `getLatestOdds(gameId)` | Every endpoint that embeds odds — live, home, schedule |
| src/lib/insights/live.ts | (project file) | `generateLiveInsights()` | `/api/live` when game is in_progress |
| src/lib/types/live.ts | (project file) | `LiveGameState`, `BoxscoreTeam`, `PlayerStatistics` | Typing snapshot payloads in /api/live |
| src/lib/types/odds.ts | (project file) | `OddsSnapshot` | Typing odds fields |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SQL in route files | `src/lib/queries/` extraction | Extraction is cleaner at scale; co-location is fine for 10 endpoints |
| Custom bigint cursor | Base64-encoded offset | Both work; base64 is more opaque (slightly more standard) |

**Installation:** No new packages needed. All dependencies already installed.

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── app/
│   └── api/
│       ├── live/
│       │   └── route.ts          # GET /api/live
│       ├── home/
│       │   └── route.ts          # GET /api/home
│       ├── players/
│       │   ├── route.ts          # GET /api/players
│       │   └── [player_id]/
│       │       └── route.ts      # GET /api/players/{player_id}
│       ├── schedule/
│       │   └── route.ts          # GET /api/schedule
│       ├── history/
│       │   ├── seasons/
│       │   │   └── route.ts      # GET /api/history/seasons
│       │   ├── games/
│       │   │   ├── route.ts      # GET /api/history/games
│       │   │   └── [game_id]/
│       │   │       └── route.ts  # GET /api/history/games/{game_id}
│       │   └── route.ts          # (not needed — no bare /history endpoint)
│       └── insights/
│           └── route.ts          # GET /api/insights
└── lib/
    ├── db.ts                     # NEW — Next.js-safe DB singleton
    ├── api-utils.ts              # NEW — buildMeta(), buildError(), type MetaEnvelope
    ├── odds.ts                   # UPDATE — change import from scripts/lib/db.ts to ./db
    ├── insights/
    │   └── live.ts               # existing — imported by /api/live
    └── types/
        ├── live.ts               # existing
        └── odds.ts               # existing
```

### Pattern 1: Next.js App Router Route Handler
**What:** Export `async function GET(request: Request)` from `route.ts`. Return `Response.json(payload)`.
**When to use:** Every API route in this phase.
**Example:**
```typescript
// src/app/api/live/route.ts
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    // ... query logic ...
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error', details: {} } },
      { status: 500 }
    );
  }
}
```

### Pattern 2: Next.js-Safe DB Singleton
**What:** Create `src/lib/db.ts` that mirrors `scripts/lib/db.ts` but throws instead of `process.exit(1)`.
**When to use:** All API route DB imports go here, not `scripts/lib/db.ts`.
```typescript
// src/lib/db.ts
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Add it to .env.local.');
}

export const sql = postgres(DATABASE_URL, {
  max: 10,           // connection pool sized for concurrent Next.js requests
  idle_timeout: 30,
  connect_timeout: 10,
});
```

### Pattern 3: Meta Envelope Builder
**What:** Centralized `buildMeta()` function so every route produces consistent `meta` without duplication.
**When to use:** Every route response.
```typescript
// src/lib/api-utils.ts
export interface MetaEnvelope {
  generated_at: string;
  source: 'nba_live' | 'balldontlie' | 'db' | 'odds_provider' | 'mixed';
  stale: boolean;
  stale_reason: string | null;
  ttl_seconds: number | null;
}

export function buildMeta(
  source: MetaEnvelope['source'],
  ttl_seconds: number | null,
  stale = false,
  stale_reason: string | null = null
): MetaEnvelope {
  return {
    generated_at: new Date().toISOString(),
    source,
    stale,
    stale_reason,
    ttl_seconds,
  };
}

export function buildError(code: string, message: string, details?: Record<string, unknown>) {
  return { error: { code, message, details: details ?? {} } };
}
```

### Pattern 4: Established SQL Conventions
**What:** Carry forward all Phase 4–8 SQL conventions.
**Rules (locked from prior decisions):**
- `bigint` PK/FK columns: always `id::text` in SELECT, cast back with `::bigint` in WHERE
- `NUMERIC` / `REAL` columns: always `col::float8` in SELECT for JS number compatibility
- `TIMESTAMPTZ` columns: `col::text` returns ISO string; avoids JS Date serialization issues
- Template tag usage: `sql\`SELECT ... WHERE id = ${variable}::bigint\`` — parameterized, not string-concatenated

### Pattern 5: Active-Game Detection from live_snapshots
**What:** Query most recent snapshot; check staleness via `is_stale` field stored in payload JSONB.
```typescript
// Detect active Clippers game from live_snapshots
const snapshots = await sql<SnapshotRow[]>`
  SELECT
    game_id::text,
    period,
    clock,
    home_score,
    away_score,
    captured_at::text,
    payload
  FROM live_snapshots
  ORDER BY captured_at DESC
  LIMIT 1
`;
const snap = snapshots[0] ?? null;
// No snapshot = no active game ever polled
// snap.payload.is_stale = true means poll daemon is down
```

### Pattern 6: Pagination Cursor for /api/history/games
**What:** Cursor encodes the `game_date` and `game_id` of the last row. Base64-encode JSON for opacity.
```typescript
// Encode cursor
const cursor = Buffer.from(JSON.stringify({ game_date: lastRow.game_date, game_id: lastRow.game_id })).toString('base64');

// Decode cursor in WHERE clause
const { game_date, game_id } = JSON.parse(Buffer.from(cursorParam, 'base64').toString('utf8'));
// WHERE (game_date, game_id) < (cursor_date, cursor_id)  -- for DESC ordering
```

### Pattern 7: LAC Team ID
**What:** `LAC_TEAM_ID = 1610612746` is the NBA's canonical team ID for the Clippers. Already exported from `scripts/lib/poll-live-logic.ts`. Re-declare or import in API layer (cannot import from scripts/ in Next.js routes without bundling concerns).
```typescript
// src/lib/db.ts or a constants file
export const LAC_TEAM_ID = 1610612746;
```

### Pattern 8: Key Metrics Computation for /api/live
**What:** Compute eFG%, TO margin, rebound margin, pace on the fly from live snapshot box score data. Same formulas as Phase 5 advanced stats engine.
```
eFG% = (FGM + 0.5 * FG3M) / FGA
TO margin = LAC_TOV - OPP_TOV
Reb margin = LAC_REB - OPP_REB
Pace = 48 * ((LAC_POSS + OPP_POSS) / 2) / (minutes_played / 5)
  where POSS ≈ FGA - OREB + TOV + 0.44 * FTA
```
Source: Phase 5 formula library at `scripts/lib/advanced-stats.ts`.

### Anti-Patterns to Avoid
- **Importing `scripts/lib/db.ts` from `src/app/api/`:** Next.js bundles server components differently from CLI scripts; the `process.exit(1)` in the script DB client will crash the Next.js server. Always use `src/lib/db.ts`.
- **Calling CDN from `/api/live`:** Locked decision — pure DB only. CDN latency kills the 200ms SLA.
- **Querying `advanced_stats` for live key_metrics:** The table only has post-game rows. Compute from snapshot box score data.
- **Fabricating values for null data:** Return `null`, never `0` for missing stats. Return `"conference_seed": null`, never a computed guess.
- **String-concatenating SQL:** Always use parameterized `sql\`...\`` template tag.
- **Returning stale zeroes as data:** When `rolling_player_stats` has no rows, return `trend_summary: null`, not `{ pts_avg: 0 }`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Odds fetching + staleness | Custom odds query | `getLatestOdds(gameId)` from `src/lib/odds.ts` | Already handles 24h freshness, float8 casts, ISO timestamp |
| Live insight generation | Custom run/clutch detection | `generateLiveInsights()` from `src/lib/insights/live.ts` | Already implements 8-0 run detection and clutch situation logic |
| Bigint serialization | Custom BigInt-to-string | `::text` cast in SELECT | Established pattern from Phase 4 — avoid postgres.js SerializableParameter gap |
| DB connection management | Custom pool | `postgres()` singleton in `src/lib/db.ts` | postgres.js handles pooling; singleton avoids connection explosion in Next.js dev mode |
| Type definitions for live data | Redefine types | `LiveGameState`, `BoxscoreTeam`, `PlayerStatistics` from `src/lib/types/live.ts` | Zero-import pure type file; already importable from Next.js |

**Key insight:** All complex domain logic (insights, odds, live state) is already encapsulated. This phase is a wiring exercise, not a logic-building exercise.

---

## Common Pitfalls

### Pitfall 1: DB Singleton Explosion in Next.js Dev Mode
**What goes wrong:** Next.js hot reloads modules in dev mode, creating a new `postgres()` connection pool on every reload. After 10–20 reloads, the pool exhausts Neon's connection limit.
**Why it happens:** Module-level `postgres()` calls are re-executed on each hot reload.
**How to avoid:** Use the `global` object to cache the singleton in dev mode:
```typescript
// src/lib/db.ts
const globalForDb = globalThis as unknown as { db: ReturnType<typeof postgres> | undefined };
export const sql = globalForDb.db ?? postgres(DATABASE_URL, { max: 10, ... });
if (process.env.NODE_ENV !== 'production') globalForDb.db = sql;
```
**Warning signs:** `too many connections` errors after rapid file saves during development.

### Pitfall 2: `src/lib/odds.ts` Imports from `scripts/lib/db.ts`
**What goes wrong:** The existing `src/lib/odds.ts` has `import { sql } from '../../scripts/lib/db.js'` — when Next.js bundles this for the API routes, it pulls in the `process.exit(1)` call which crashes the server on cold start if DATABASE_URL is missing.
**Why it happens:** The file was written before `src/lib/db.ts` existed.
**How to avoid:** The first task of this phase must update `src/lib/odds.ts` to import from `./db.js` (the new Next.js-safe singleton). This is a one-line change but it's blocking.
**Warning signs:** The import path `../../scripts/lib/db.js` in any `src/` file is a red flag.

### Pitfall 3: Table Name Mismatch — `insights` vs `generated_insights`
**What goes wrong:** CONTEXT.md and some planning docs refer to `generated_insights` as the insight table. The actual DB schema and all scripts use `insights`. Querying `generated_insights` will throw a "relation does not exist" error.
**Why it happens:** Early planning documents used a different name that was later changed.
**How to avoid:** Always use `insights` in SQL queries. The DB_SCHEMA.sql is authoritative.
**Warning signs:** `ERROR: relation "generated_insights" does not exist` at runtime.

### Pitfall 4: `players` Table Has No `team_id` Column
**What goes wrong:** The schema shows `players` has no `team_id`. Filtering Clippers players by `WHERE team_id = LAC_DB_TEAM_ID` on the players table fails.
**Why it happens:** Phase 6 documented this: "players table has no team_id — Clippers player filter uses EXISTS on game_player_box_scores.team_id"
**How to avoid:** Use `player_team_stints` table (which has `team_id`) to find LAC players. For `/api/players`, join or EXISTS-filter via `player_team_stints`. For player minute-ranking in `/api/home`, query `game_player_box_scores WHERE team_id = LAC_DB_TEAM_ID`.
```sql
-- Find LAC players via player_team_stints
SELECT p.player_id::text, p.display_name, p.position, p.is_active
FROM players p
WHERE EXISTS (
  SELECT 1 FROM player_team_stints pts
  JOIN teams t ON pts.team_id = t.team_id
  WHERE pts.player_id = p.player_id
    AND t.nba_team_id = 1610612746
)
AND p.is_active = true
```

### Pitfall 5: `rolling_team_stats` Column Names
**What goes wrong:** Phase 6 documented that `rolling_team_stats` uses `window_games` (not `window_size`) and column names `off_rating`, `def_rating`, `net_rating` (no `avg_` prefix). Using wrong column names causes "column does not exist" errors.
**How to avoid:** Always reference DB_SCHEMA.sql for exact column names. For rolling_team_stats: `window_games`, `off_rating`, `def_rating`, `net_rating`, `as_of_game_date`.

### Pitfall 6: NUMERIC Columns Return Strings Without float8 Cast
**What goes wrong:** PostgreSQL `NUMERIC`/`REAL` columns come back as strings (`"3.200"`) in JavaScript without an explicit cast, breaking JSON number semantics.
**How to avoid:** Always add `::float8` cast: `off_rating::float8 AS off_rating`. This is an established Phase 8 pattern.

### Pitfall 7: Response Cache Headers
**What goes wrong:** Not setting `Cache-Control` headers means Next.js may apply default caching, causing stale data to be served to the UI. Live data especially must not be cached.
**How to avoid:** Set headers explicitly per endpoint:
```typescript
// For live endpoint
return NextResponse.json(payload, {
  headers: { 'Cache-Control': 'no-store' }
});
// For static-ish endpoints (seasons, history)
return NextResponse.json(payload, {
  headers: { 'Cache-Control': 'public, max-age=86400' }
});
```

---

## Code Examples

Verified patterns from existing codebase:

### DB Singleton (Next.js-Safe Version)
```typescript
// src/lib/db.ts — to be created in Wave 0 / Task 1
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Configure .env.local.');
}

// Prevent connection pool explosion during Next.js hot reload in dev
const globalForDb = globalThis as unknown as { _sql: ReturnType<typeof postgres> | undefined };

export const sql = globalForDb._sql ?? postgres(DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
});

if (process.env.NODE_ENV !== 'production') {
  globalForDb._sql = sql;
}
```

### Meta Envelope (API Spec Shape)
```typescript
// From Docs/API_SPEC.md — exact field names required
{
  "meta": {
    "generated_at": "2026-03-06T01:23:45Z",  // new Date().toISOString()
    "source": "db",                            // "nba_live" | "balldontlie" | "db" | "odds_provider" | "mixed"
    "stale": false,                            // boolean
    "stale_reason": null,                      // string | null
    "ttl_seconds": 300                         // number | null
  }
}
```

### Bigint-as-Text Pattern (Established Phase 4 Convention)
```typescript
// Source: Phase 04-02 decision — bigint FK values fetched as ::text
const rows = await sql`
  SELECT
    g.game_id::text AS game_id,
    g.nba_game_id::text AS nba_game_id,
    g.game_date::text AS game_date,
    ...
  FROM games g
  WHERE g.game_id = ${gameId}::bigint
`;
```

### Live Snapshot Query
```typescript
// Query latest snapshot for active game detection
const [snap] = await sql`
  SELECT
    ls.snapshot_id,
    ls.game_id::text,
    ls.period,
    ls.clock,
    ls.home_score,
    ls.away_score,
    ls.captured_at::text,
    ls.payload
  FROM live_snapshots ls
  ORDER BY ls.captured_at DESC
  LIMIT 1
`;
```

### Insights Query (API-06 pattern)
```typescript
// Source: DB_SCHEMA.sql — table name is "insights" (not "generated_insights")
const insights = await sql`
  SELECT
    insight_id::text,
    scope,
    category,
    headline,
    detail,
    importance,
    proof_sql,
    proof_params,
    proof_result
  FROM insights
  WHERE is_active = true
    AND scope = ${scopeParam}
  ORDER BY importance DESC, created_at DESC
  LIMIT ${limitParam}
`;
```

### Error Envelope (API Spec Shape)
```typescript
// Source: Docs/API_SPEC.md
return NextResponse.json(
  { error: { code: 'NOT_FOUND', message: 'Player not found', details: {} } },
  { status: 404 }
);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Next.js Pages Router (`/pages/api/`) | App Router (`/app/api/*/route.ts`) | Next.js 13+ | Route files export named HTTP method functions (`GET`, `POST`); `NextRequest`/`NextResponse` available |
| ORM (Prisma/Drizzle) | Raw SQL via `postgres` npm package | Phase 4-01 decision | Lighter weight, Neon-compatible, TypeScript-native, no migration overhead |

**Note on Next.js 16:** The project uses Next.js 16.1.6. App Router API routes work identically to Next.js 13–15 for simple GET handlers: `export async function GET(request: Request)` returns a `Response` object. `NextResponse.json()` is the idiomatic wrapper. No behavior changes relevant to this phase.

---

## Validation Architecture

nyquist_validation is enabled (config.json has `"nyquist_validation": true`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.x |
| Config file | `vitest.config.ts` (exists, includes `src/lib/**/*.test.ts`) |
| Quick run command | `npm test -- --reporter=verbose` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| API-01 | /api/live returns correct state (NO_ACTIVE_GAME, LIVE, DATA_DELAYED) | unit (mock DB) | `npm test -- src/lib/api-live.test.ts` | ❌ Wave 0 |
| API-02 | /api/home returns team_snapshot with null conference_seed, correct last_10 | unit (mock DB) | `npm test -- src/lib/api-home.test.ts` | ❌ Wave 0 |
| API-03 | /api/players returns LAC roster; /api/players/{id} returns null trend_summary when no rolling data | unit (mock DB) | `npm test -- src/lib/api-players.test.ts` | ❌ Wave 0 |
| API-04 | /api/schedule returns games with odds: null when no snapshot | unit (mock DB) | `npm test -- src/lib/api-schedule.test.ts` | ❌ Wave 0 |
| API-05 | /api/history/games/{id} returns available:false for games without box scores | unit (mock DB) | `npm test -- src/lib/api-history.test.ts` | ❌ Wave 0 |
| API-06 | /api/insights returns only is_active=true insights sorted by importance DESC | unit (mock DB) | `npm test -- src/lib/api-insights.test.ts` | ❌ Wave 0 |
| API-07 | meta envelope has all required fields on every response | unit | Covered in all above tests | ❌ Wave 0 |

**Test strategy note:** Because `route.ts` handlers are not independently importable (they're bound to the Next.js runtime), the recommended pattern is to extract query logic into pure functions in `src/lib/queries/` or co-located helpers, then unit test those functions with mocked `sql` (same pattern as `src/lib/odds.test.ts`). The route files themselves become thin adapters.

Alternatively, the planner may choose to test route handlers directly using the mock-DB pattern from `odds.test.ts`, where `sql` is mocked with `vi.mock`. Either approach is valid — the planner chooses.

### Sampling Rate
- **Per task commit:** `npm test` (full suite is fast — only unit tests, no DB)
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/db.ts` — Next.js-safe DB singleton (prerequisite for all routes)
- [ ] `src/lib/api-utils.ts` — `buildMeta()`, `buildError()` helpers
- [ ] `src/lib/api-live.test.ts` — covers API-01, API-07
- [ ] `src/lib/api-home.test.ts` — covers API-02, API-07
- [ ] `src/lib/api-players.test.ts` — covers API-03, API-07
- [ ] `src/lib/api-schedule.test.ts` — covers API-04, API-07
- [ ] `src/lib/api-history.test.ts` — covers API-05, API-07
- [ ] `src/lib/api-insights.test.ts` — covers API-06, API-07
- [ ] Update `src/lib/odds.ts` import from `../../scripts/lib/db.js` to `./db.js`

---

## Open Questions

1. **`src/lib/odds.ts` currently imports `scripts/lib/db.ts`**
   - What we know: The file has `import { sql } from '../../scripts/lib/db.js'` — this will pull in `process.exit(1)` into the Next.js bundle.
   - What's unclear: Whether Next.js tree-shaking eliminates the dead branch or executes it.
   - Recommendation: Fix unconditionally in Wave 0 — change to `./db.js`. No risk, one-line change.

2. **LAC internal `team_id` (bigint) vs NBA `nba_team_id` (1610612746)**
   - What we know: The `teams` table has both. API routes need the internal `team_id` for foreign key joins (`game_player_box_scores.team_id`, `rolling_team_stats.team_id`), but the NBA team ID (1610612746) is needed to look it up.
   - What's unclear: Whether a constant for the LAC internal `team_id` exists or must be queried at runtime.
   - Recommendation: At route startup, do a one-time lookup: `SELECT team_id FROM teams WHERE nba_team_id = 1610612746`. Cache the result in module scope. This is safe because the teams table never changes in MVP.

3. **Query organization: co-locate vs `src/lib/queries/`**
   - What we know: Left to Claude's discretion.
   - Recommendation: Co-locate SQL in route files for the first implementation (simpler). Extract to `src/lib/queries/` only if queries are shared across multiple routes (e.g., `getLatestOdds` is already extracted because it's shared).

---

## Sources

### Primary (HIGH confidence)
- `Docs/API_SPEC.md` — complete endpoint contract, response shapes, error envelopes, meta structure
- `Docs/DB_SCHEMA.sql` — authoritative table/column definitions; confirms table name is `insights` not `generated_insights`
- `src/lib/types/live.ts` — `LiveGameState`, `BoxscoreTeam`, `PlayerStatistics` type definitions
- `src/lib/types/odds.ts` — `OddsSnapshot` type definition
- `src/lib/odds.ts` — `getLatestOdds()` implementation and import path issue
- `src/lib/insights/live.ts` — `generateLiveInsights()` signature and return type
- `scripts/lib/db.ts` — pattern to replicate in `src/lib/db.ts` (minus `process.exit`)
- `scripts/lib/poll-live-logic.ts` — `LAC_TEAM_ID = 1610612746`
- `package.json` — confirms Next.js 16.1.6, postgres ^3.4.8, vitest ^4.0.18, no ORM
- `vitest.config.ts` — confirms `src/lib/**/*.test.ts` already in test include paths
- `.planning/STATE.md` — accumulated decisions from Phases 4–8

### Secondary (MEDIUM confidence)
- Next.js App Router route handler conventions — confirmed from package.json (Next.js 16.1.6) + established pattern from next.config.ts and project structure

### Tertiary (LOW confidence)
- Global singleton pattern for postgres in Next.js dev mode — based on common Next.js pattern; not verified against Next.js 16 specifics, but risk is low

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries installed, patterns established in prior phases
- Architecture: HIGH — API_SPEC.md is locked; DB schema is verified; file structure follows Next.js conventions
- Pitfalls: HIGH — most identified from actual codebase inspection (import path bug, table name mismatch, column name discrepancies from STATE.md)
- SQL patterns: HIGH — extracted from existing codebase, not assumed

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (stable stack; no fast-moving dependencies)
