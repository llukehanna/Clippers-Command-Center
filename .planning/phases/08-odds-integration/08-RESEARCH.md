# Phase 8: Odds Integration - Research

**Researched:** 2026-03-06
**Domain:** External odds API ingestion, TypeScript adapter pattern, GitHub Actions cron
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Provider:** The Odds API (theoddsapi.com) — free tier, 500 requests/month is sufficient at 6h cadence
- **API key:** `ODDS_API_KEY` in `.env` — never committed
- **Fetch strategy:** Pull all NBA game odds, filter to Clippers games in code by matching against `games` table
- **Adapter pattern:** TypeScript `OddsAdapter` interface in `src/lib/types/`, concrete `TheOddsApiAdapter` in `scripts/lib/`
- **Swappability:** Changing adapters = instantiating a different class in `sync-odds.ts`, no display logic changes
- **Stale threshold:** Odds older than 24 hours treated as unavailable — query returns `null`
- **No snapshot = `null`:** Query helper returns null when no snapshot exists
- **Query shape:** `{ spread_home, spread_away, moneyline_home, moneyline_away, total_points, captured_at } | null`
- **GitHub Actions:** Include `.github/workflows/sync-odds.yml` in this phase (cron `0 */6 * * *`)
- **No extra pre-game run:** Simple 6h cadence is sufficient
- **Script entry point:** `scripts/sync-odds.ts` invoked via `npm run sync-odds`
- **Logging:** One log line per game processed, summary at end (mirrors backfill/compute-stats style)
- **Provider failure:** Log warning, write nothing, keep existing snapshots — do NOT exit hard

### Claude's Discretion
- Exact The Odds API endpoint URL and response field mapping to `odds_snapshots` columns
- `OddsAdapter` interface method signature details
- `app_kv` key name for tracking `odds_sync:last_success_at`
- Error handling details within the adapter

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ODDS-01 | Odds data ingests from external provider into odds_snapshots (append-only) | The Odds API endpoint confirmed; INSERT pattern mirrors live_snapshots; UNIQUE constraint on (game_id, provider, captured_at) enables idempotency |
| ODDS-02 | System displays spread, moneyline, and over/under for Clippers games | Query helper returns typed `OddsSnapshot \| null`; spreads/h2h/totals markets all available from single API call |
| ODDS-03 | System hides odds sections when odds data is unavailable — never fabricates | 24h stale threshold enforced in query helper; null returned on no snapshot or stale data — downstream consumers check for null |
| ODDS-04 | Odds provider is swappable via adapter layer | `OddsAdapter` interface in `src/lib/types/`; concrete class in `scripts/lib/`; `sync-odds.ts` instantiates the class — one change point |
</phase_requirements>

---

## Summary

Phase 8 builds the `sync-odds` ingestion pipeline that fetches NBA betting odds from The Odds API and appends them to the `odds_snapshots` table. The phase is narrowly scoped: ingestion + storage + query helper. UI display is deferred to later phases (9, 12, 14).

The Odds API v4 endpoint `GET /v4/sports/basketball_nba/odds/` returns all NBA games in a single response with embedded bookmaker data. A single request with markets `h2h,spreads,totals` and `regions=us` costs 3 API credits. At 6-hour cadence (4 requests/day × 30 days = 120 requests/month), the free tier 500-request monthly quota is well within limits. No per-game requests are needed.

The adapter pattern is straightforward: the `OddsAdapter` interface abstracts provider-specific HTTP and parsing logic. The concrete `TheOddsApiAdapter` implements the interface. The `sync-odds.ts` entry point calls the adapter, matches results to Clippers games in the `games` table by date and team names, and inserts new snapshots. The existing `CONSTRAINT uq_odds_snapshot UNIQUE (game_id, provider, captured_at)` on the `odds_snapshots` table makes the INSERT idempotent — re-running produces no duplicates.

**Primary recommendation:** Follow the `nba-live-client.ts` pattern exactly for the HTTP client layer (AbortController timeout, typed generic fetch function), and the `poll-live.ts` / `sync-schedule.ts` pattern for the script entry point structure. The adapter interface should expose a single async method returning a typed array; all provider-specific logic stays inside the adapter class.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `postgres` (npm) | ^3.4.8 | DB inserts into odds_snapshots | Already in use across all data scripts; sql template tag is the project standard |
| `tsx` | ^4.21.0 | Script runner for sync-odds.ts | Already in use; all data scripts invoked via `node --env-file=.env.local tsx scripts/...` |
| Node built-in `fetch` | Node 18+ | HTTP call to The Odds API | Already used in nba-live-client.ts; no extra dep |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `AbortController` | Built-in | Request timeout enforcement | Use for every external HTTP call — matches nba-live-client.ts pattern |
| Vitest | ^4.0.18 | Unit tests for adapter/query helper | Use for the query helper function — pure logic, easily testable |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Node fetch | `axios`, `node-fetch` | No benefit here; native fetch already used for NBA CDN client |
| Single bookmaker | Multiple bookmakers aggregated | More complex averaging; overkill for personal tool — pick one bookmaker |

**No new npm packages needed.** The entire phase uses existing project dependencies.

---

## Architecture Patterns

### Recommended File Structure
```
scripts/
├── sync-odds.ts               # Entry point — npm run sync-odds
└── lib/
    └── odds-client.ts         # TheOddsApiAdapter concrete class + HTTP client

src/lib/
└── types/
    └── odds.ts                # OddsAdapter interface + OddsSnapshot type

.github/
└── workflows/
    └── sync-odds.yml          # Cron: 0 */6 * * *
```

### Pattern 1: HTTP Client (mirrors nba-live-client.ts)

**What:** Typed generic fetch with AbortController timeout; single exported class.
**When to use:** All external HTTP in this project.

```typescript
// scripts/lib/odds-client.ts
// Source: mirrors scripts/lib/nba-live-client.ts pattern

const ODDS_API_BASE = 'https://api.the-odds-api.com';
const REQUEST_TIMEOUT_MS = 30_000;

async function oddsGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${ODDS_API_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) throw new Error(`OddsAPI ${res.status}: ${path}`);
    return res.json() as Promise<T>;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`TIMEOUT after ${REQUEST_TIMEOUT_MS}ms: ${path}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
```

### Pattern 2: OddsAdapter Interface (in src/lib/types/)

**What:** Interface lives in `src/lib/types/` alongside `live.ts` — zero runtime imports, pure types. Mirrors how `LiveSnapshot` type is defined for both scripts and app consumption.
**When to use:** Define interface + types here; concrete adapter in scripts/lib/.

```typescript
// src/lib/types/odds.ts
// Zero runtime imports — pure type declarations only.
// Safe to import from both scripts/ and src/ (Phase 9 API routes).

export interface OddsSnapshot {
  spread_home:    number | null;
  spread_away:    number | null;
  moneyline_home: number | null;
  moneyline_away: number | null;
  total_points:   number | null;
  captured_at:    string;  // ISO string — downstream can check for staleness
}

export interface OddsEvent {
  provider_event_id: string;
  commence_time:     string;  // ISO 8601
  home_team:         string;  // provider team name (must match against games table)
  away_team:         string;
  snapshot:          Omit<OddsSnapshot, 'captured_at'>;
}

export interface OddsAdapter {
  /**
   * Fetch all NBA game odds from the provider.
   * Returns an array of OddsEvent objects — one per game.
   * Throws on network failure so the caller can decide to abort or skip.
   */
  fetchNBAOdds(): Promise<OddsEvent[]>;

  /** Identifier string written to odds_snapshots.provider column. */
  readonly providerKey: string;
}
```

### Pattern 3: Concrete Adapter — Field Mapping

**What:** The Odds API returns an array of events, each with a `bookmakers` array. Pick the first bookmaker with all three markets present (or the most common bookmaker like DraftKings). Extract spread, moneyline, and total from `outcomes`.
**When to use:** Inside `TheOddsApiAdapter.fetchNBAOdds()`.

```typescript
// Response shape from GET /v4/sports/basketball_nba/odds/
// Source: https://the-odds-api.com/liveapi/guides/v4/
// markets=h2h,spreads,totals&regions=us&oddsFormat=american

// Each event in the response array:
// {
//   id:            string,            // provider event ID
//   commence_time: string,            // ISO 8601
//   home_team:     string,            // e.g. "Los Angeles Clippers"
//   away_team:     string,
//   bookmakers: [{
//     key:    string,                 // e.g. "draftkings"
//     markets: [
//       { key: "h2h",     outcomes: [{ name: "Team", price: -150 }, ...] },
//       { key: "spreads", outcomes: [{ name: "Team", price: -110, point: 6.5 }, ...] },
//       { key: "totals",  outcomes: [{ name: "Over", price: -110, point: 210.5 }, ...] }
//     ]
//   }]
// }

// Field mapping to odds_snapshots:
// h2h outcomes: find home_team name → price = moneyline_home
//               find away_team name → price = moneyline_away
// spreads outcomes: find home_team name → point = spread_home, away → spread_away
// totals outcomes: find "Over" → point = total_points
```

### Pattern 4: Game Matching (Clippers filter)

**What:** Fetch all NBA events; filter to LAC games by matching `home_team` or `away_team` contains "Clippers". Then match against `games` table by date (from `commence_time`) to get the internal `game_id`.
**When to use:** In `sync-odds.ts` main function.

```typescript
// Filter strategy: provider uses full team names ("Los Angeles Clippers")
// Match against games table using commence_time date + team name
// Query games table for upcoming games (status = 'scheduled') with LAC team_id
// Match by game_date == commence_time date
// On match: INSERT into odds_snapshots with internal game_id

// WARNING: provider team names must be matched to DB records
// Use contains check: event.home_team.includes('Clippers') || event.away_team.includes('Clippers')
// If no match found, log warning and skip — do not throw
```

### Pattern 5: Append-Only INSERT (no ON CONFLICT update)

**What:** Unlike other tables that use upserts, `odds_snapshots` is append-only per the established pattern (same as `live_snapshots`). The UNIQUE constraint on `(game_id, provider, captured_at)` handles duplicate-run safety via `ON CONFLICT DO NOTHING`.
**When to use:** Every odds write.

```typescript
// Source: mirrors live_snapshots append-only pattern from Phase 7

await sql`
  INSERT INTO odds_snapshots (
    game_id, provider, captured_at,
    spread_home, spread_away,
    moneyline_home, moneyline_away,
    total_points, raw_payload
  ) VALUES (
    ${gameId}::bigint, ${providerKey}, now(),
    ${spreadHome}, ${spreadAway},
    ${moneylineHome}, ${moneylineAway},
    ${totalPoints}, ${sql.json(rawPayload)}
  )
  ON CONFLICT (game_id, provider, captured_at) DO NOTHING
`;
```

### Pattern 6: Query Helper for Downstream Consumers

**What:** Pure DB query function in `scripts/lib/` (or `src/lib/`) that retrieves the most recent odds snapshot for a game within the 24h staleness window. Returns typed result or `null`. Phase 9 imports this.
**When to use:** Phase 9 API routes call this to get odds data for schedule/home endpoints.

```typescript
// Returns null if: no snapshot exists, OR most recent snapshot is > 24h old
export async function getLatestOdds(gameId: string): Promise<OddsSnapshot | null> {
  const [row] = await sql<OddsSnapshot[]>`
    SELECT
      spread_home, spread_away,
      moneyline_home, moneyline_away,
      total_points,
      captured_at::text
    FROM odds_snapshots
    WHERE game_id = ${gameId}::bigint
      AND captured_at > now() - INTERVAL '24 hours'
    ORDER BY captured_at DESC
    LIMIT 1
  `;
  return row ?? null;
}
```

### Pattern 7: GitHub Actions Cron Workflow

**What:** Cron-triggered workflow that runs `npm run sync-odds` every 6 hours. Follows same shape as any GitHub Actions data sync workflow.

```yaml
# .github/workflows/sync-odds.yml
name: Sync Odds

on:
  schedule:
    - cron: '0 */6 * * *'
  workflow_dispatch:  # manual trigger for testing

jobs:
  sync-odds:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run sync-odds
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          ODDS_API_KEY: ${{ secrets.ODDS_API_KEY }}
```

### Anti-Patterns to Avoid

- **Per-game API requests:** Do NOT call `/v4/sports/basketball_nba/events/{id}/odds/` per game. One bulk request for all NBA games is cheaper and simpler.
- **Throwing on provider failure:** The script MUST catch provider errors, log a warning, and exit cleanly — never crash and leave the workflow in a failure state that blocks other crons.
- **Averaging across bookmakers:** Pick a single consistent bookmaker (e.g., DraftKings) per request. Averaging is complex and unnecessary for a personal tool.
- **Updating existing snapshots:** Never UPDATE existing `odds_snapshots` rows. Append-only is the established pattern for time-series data in this codebase.
- **Storing env var in code:** ODDS_API_KEY comes from `process.env.ODDS_API_KEY` loaded via `--env-file=.env.local` — never hardcode.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Request timeout | Custom timer logic | AbortController pattern (already in nba-live-client.ts) | Browser-compatible, matches existing code |
| Idempotency | Custom dedup logic | `ON CONFLICT DO NOTHING` on existing UNIQUE constraint | Constraint already exists in schema |
| Stale detection | Complex cache logic | Simple `WHERE captured_at > now() - INTERVAL '24 hours'` in query | Postgres handles it; one line |
| Rate limit handling | Sleep/retry machinery | Not needed — 500 req/month free tier, one request per cron run | Unnecessary complexity |

---

## Common Pitfalls

### Pitfall 1: Team Name Mismatch
**What goes wrong:** The Odds API uses full team names ("Los Angeles Clippers", "LA Clippers") which may not match the `teams` table values. Strict equality match fails silently.
**Why it happens:** Different data providers use different canonical team names.
**How to avoid:** Use `.includes('Clippers')` substring match on the event's `home_team`/`away_team` fields. Log unmatched games.
**Warning signs:** `sync-odds` runs without errors but inserts zero rows.

### Pitfall 2: Missing Markets in Response
**What goes wrong:** Not all bookmakers offer all three markets (h2h/spreads/totals) for every game. Accessing missing market yields undefined, crashes on `.outcomes` access.
**Why it happens:** Some games may only have moneyline available, not spreads.
**How to avoid:** Use optional chaining and null-safe extraction. If any market is missing, store `null` for those fields — the schema allows nullable columns.
**Warning signs:** TypeError accessing `.outcomes` on undefined.

### Pitfall 3: Free Tier Credit Cost
**What goes wrong:** Requesting multiple markets in one call costs 3 credits per call (1 per market per region). At 6h cadence = 4 calls/day × 3 credits = 12 credits/day × 30 = 360/month. This is within the 500 credit free tier limit.
**Why it happens:** The cost formula is `markets × regions`.
**How to avoid:** Use a single region (`us`) — do not add `eu`, `uk`, or `au`. Keep market count at 3 (h2h, spreads, totals).
**Warning signs:** API returning 401/402 response codes mid-month.

### Pitfall 4: process.exit(1) on Provider Failure
**What goes wrong:** If the adapter throws and sync-odds calls `process.exit(1)`, the GitHub Actions workflow marks the run as failed. This creates noise and doesn't provide any benefit — existing snapshots remain valid.
**Why it happens:** The BDL client calls `process.exit(1)` on missing API key — this pattern should NOT be copied for provider runtime failures.
**How to avoid:** Only exit hard if `ODDS_API_KEY` is missing at startup. Catch network errors at runtime, log warning, exit 0.
**Warning signs:** GitHub Actions showing failed runs on API outages.

### Pitfall 5: game_id Type Mismatch
**What goes wrong:** `game_id` in the `games` table is a `BIGINT`. postgres.js may return it as a string or number. The existing codebase pattern (Phase 4) casts via `::text` on SELECT and `::bigint` on INSERT.
**Why it happens:** Node.js cannot safely represent 64-bit integers; postgres.js serializes bigints as strings.
**How to avoid:** Follow established pattern: `game_id::text` on SELECT, `${gameId}::bigint` on INSERT. This is already documented in STATE.md accumulated context.

---

## Code Examples

### Verified: The Odds API request parameters
```
// Source: https://the-odds-api.com/liveapi/guides/v4/
GET https://api.the-odds-api.com/v4/sports/basketball_nba/odds/
  ?apiKey=YOUR_KEY
  &regions=us
  &markets=h2h,spreads,totals
  &oddsFormat=american
```
Cost: 3 credits per call (3 markets × 1 region).

### Verified: Response structure
```typescript
// Source: https://the-odds-api.com/liveapi/guides/v4/
interface OddsApiEvent {
  id:            string;
  sport_key:     string;   // "basketball_nba"
  commence_time: string;   // ISO 8601
  home_team:     string;   // "Los Angeles Clippers"
  away_team:     string;
  bookmakers: Array<{
    key:   string;          // "draftkings"
    title: string;
    last_update: string;
    markets: Array<{
      key:      string;    // "h2h" | "spreads" | "totals"
      outcomes: Array<{
        name:   string;    // team name or "Over"/"Under"
        price:  number;    // american odds integer e.g. -110, 240
        point?: number;    // spread value (spreads) or total (totals)
      }>;
    }>;
  }>;
}
```

### Verified: setCheckpoint (from upserts.ts — use for last_success_at)
```typescript
// Source: scripts/lib/upserts.ts (already in codebase)
await setCheckpoint('odds_sync:last_success_at', Date.now());
```

### Verified: npm run entry point pattern
```json
// Source: package.json — mirrors existing sync-schedule pattern
"sync-odds": "node --env-file=.env.local node_modules/.bin/tsx scripts/sync-odds.ts"
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Poll per-game endpoint | Single bulk NBA odds endpoint | One request instead of N; simpler quota management |
| `ODDS_API_KEY` guard in bdl-client.ts style (process.exit at top) | Guard at startup, catch at runtime | Provider failure is non-fatal; script exits 0 on outage |

---

## Open Questions

1. **Which bookmaker to prefer**
   - What we know: The Odds API returns multiple bookmakers (DraftKings, FanDuel, BetMGM, etc.). The first bookmaker in the array may vary by game.
   - What's unclear: Whether a specific bookmaker is consistently present for all NBA games.
   - Recommendation: Default to the first bookmaker that has all three markets (h2h, spreads, totals). Log which bookmaker was used per game. This is Claude's discretion to decide in the implementation.

2. **`captured_at` value: `now()` vs. provider `last_update`**
   - What we know: Each bookmaker object includes a `last_update` timestamp.
   - What's unclear: Whether `last_update` or ingestion time is more useful for the 24h staleness check.
   - Recommendation: Use `now()` (ingestion time) for `captured_at` — this is what the UNIQUE constraint and staleness threshold are designed around. Store provider `last_update` in `raw_payload` if needed later.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.0.18 |
| Config file | `vitest.config.ts` (includes `scripts/lib/**/*.test.ts` and `src/lib/**/*.test.ts`) |
| Quick run command | `npx vitest run scripts/lib/odds-client.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ODDS-01 | INSERT into odds_snapshots writes correct values | integration (manual DB check) | manual-only — requires live DB + API key | ❌ Wave 0 |
| ODDS-02 | `getLatestOdds()` returns typed snapshot with all three markets | unit | `npx vitest run src/lib/odds.test.ts` | ❌ Wave 0 |
| ODDS-03 | `getLatestOdds()` returns null when no snapshot exists or snapshot is > 24h old | unit | `npx vitest run src/lib/odds.test.ts` | ❌ Wave 0 |
| ODDS-04 | `OddsAdapter` interface is implemented by `TheOddsApiAdapter` (TypeScript compile check) | type check | `npx tsc --noEmit` | ❌ Wave 0 |

> ODDS-01 ingestion correctness is best verified via `npm run sync-odds` dry-run against real DB after API key is configured. Unit tests cover the query helper logic (ODDS-02, ODDS-03).

### Sampling Rate
- **Per task commit:** `npx vitest run src/lib/odds.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/odds.test.ts` — covers ODDS-02, ODDS-03 (null return logic for getLatestOdds)
- [ ] No framework changes needed — vitest.config.ts already includes `src/lib/**/*.test.ts`

---

## Sources

### Primary (HIGH confidence)
- The Odds API v4 docs (https://the-odds-api.com/liveapi/guides/v4/) — endpoint URL, request params, response schema, credit cost formula
- `Docs/DB_SCHEMA.sql` — odds_snapshots table definition and constraints (verified directly)
- `scripts/lib/nba-live-client.ts` — HTTP client pattern (verified directly)
- `scripts/lib/upserts.ts` — setCheckpoint pattern, sql template tag usage (verified directly)
- `scripts/lib/db.ts` — postgres client singleton (verified directly)
- `package.json` — script entry point pattern, existing deps (verified directly)

### Secondary (MEDIUM confidence)
- `scripts/sync-schedule.ts` — script structure pattern for sync-odds entry point
- `scripts/poll-live.ts` — append-only INSERT pattern for time-series tables

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all deps verified in package.json; no new packages needed
- Architecture: HIGH — API endpoint and response schema verified from official docs; patterns verified from codebase
- Pitfalls: HIGH — game_id bigint issue documented in STATE.md; team name mismatch is a known external API integration issue; credit cost formula verified from official docs

**Research date:** 2026-03-06
**Valid until:** 2026-06-06 (The Odds API v4 is stable; 90-day validity estimate)
