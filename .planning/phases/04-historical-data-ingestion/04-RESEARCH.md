# Phase 4: Historical Data Ingestion - Research

**Researched:** 2026-03-05
**Domain:** ETL pipeline — BALLDONTLIE REST API → PostgreSQL (Neon) via TypeScript scripts
**Confidence:** HIGH (architecture docs + live API verification)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Project Scaffold**
- Phase 4 creates the Next.js project from scratch (package.json, tsconfig, dependencies)
- Dependencies: Next.js (App Router), TypeScript, shadcn/ui, Recharts, Tailwind, `postgres` npm package (sql template tag)
- DB client: `postgres` — lightweight, TypeScript-native, works well with Neon's serverless driver
- Schema applied by running `Docs/DB_SCHEMA.sql` directly against Neon (no ORM migrations)
- Environment: `.env.local` with `DATABASE_URL` and `BALLDONTLIE_API_KEY` — fail fast with a clear message if missing

**Script Location and Invocation**
- Ingestion scripts live in `scripts/` directory (e.g., `scripts/backfill.ts`)
- Invoked via npm script: `npm run backfill` (using `tsx`)
- Keeps data pipeline code separate from the Next.js app layer
- The backfill is a one-time operation run manually from local machine pointing at Neon

**Season Scope**
- Seasons: 2022-23, 2023-24, 2024-25 (3 most recent)
- Coverage: All NBA teams — needed for league comparisons and opponent context
- Playoffs: Included in all 3 seasons
- For the in-progress 2024-25 season: completed games only — skip games where status ≠ final; `finalize_completed_games` handles those once they complete

**Pipeline Scope**
- Phase 4 = raw ingestion only: games, teams, players, and box scores into the DB
- Does NOT trigger advanced stats, rolling windows, or insights — those are phases 5 and 6

**Progress Tracking**
- Season-level checkpoints via `app_kv` table: track last completed season (e.g., `backfill:last_completed_season`)
- If interrupted, resume from the next unprocessed season
- Console progress output per season and per batch

**Rate Limiting**
- Fixed ~1 second delay between BALLDONTLIE API requests (stays comfortably under 60 req/min free tier)
- On 429 or temporary errors: exponential backoff with up to 3 retries, then log and continue
- BALLDONTLIE_API_KEY env var must be set; script exits with clear error if missing

**Incomplete Data Handling**
- If a game's box score is missing or clearly incomplete (null team scores), skip it and log the game ID
- Script summary at end lists all skipped games for manual review
- No partial inserts — if a game's box score can't be cleanly ingested, skip the whole game

**Idempotency**
- All writes use upsert patterns — re-running the script does not create duplicate records

### Claude's Discretion
- Exact delay timing (1s is the floor; could be slightly more between seasons/batches)
- Whether to add a `--dry-run` flag for the backfill script
- Internal batching strategy within a season (e.g., process month-by-month or game-by-game)
- Exact console output format (just needs to be readable progress + summary)

### Deferred Ideas (OUT OF SCOPE)
- None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DATA-01 | System ingests 3 full NBA seasons of historical data (all teams, players, games) | BDL `/v1/games?seasons[]=` + `/v1/stats?game_ids[]=` pattern; teams via `/v1/teams`; players discovered via stats responses |
| DATA-04 | Ingestion jobs are idempotent and resumable | `INSERT ... ON CONFLICT DO UPDATE` upsert via `postgres` sql tag; `app_kv` checkpoints for season-level resume |
| DATA-05 | Final box scores ingest correctly after games end | BDL `status` field signals finality; filter to `status = "Final"` before writing box scores; `finalize_completed_games` job pattern from INGESTION_PLAN.md |
</phase_requirements>

---

## Summary

Phase 4 is the project's first code phase. It creates the Next.js scaffold from scratch and runs a one-time backfill script that populates the Neon PostgreSQL database with 3 seasons of NBA data using the BALLDONTLIE API. The DB schema is already locked in `Docs/DB_SCHEMA.sql` and must be applied directly against Neon before the backfill runs.

The core engineering challenge is the BALLDONTLIE API rate limit. The **free tier is 5 req/min** — not 60 req/min as the CONTEXT.md assumed. The ALL-STAR paid tier ($9.99/mo) provides 60 req/min. The backfill strategy must account for this: at 5 req/min with a ~12-second delay between requests, ingesting ~3,600+ games (≈3 seasons × 1,230 regular season games + playoffs) via one-game-at-a-time stats calls would take many hours. The recommended approach is to fetch games in bulk by season first, then fetch stats in bulk by `game_ids[]` batches (up to 100 per page), which dramatically reduces total API calls.

The `postgres` npm package (porsager) is the chosen DB client. It uses ES6 tagged template literals, supports transactions, and produces upsert SQL via `INSERT ... ON CONFLICT (unique_column) DO UPDATE SET ...` written directly in the template. No ORM magic is needed — raw SQL aligns with this project's philosophy of full control and the locked schema.

**Primary recommendation:** Use the two-phase fetch strategy — bulk-fetch all games for a season, then bulk-fetch stats by `game_ids[]` batches — to minimize API calls. If on the free tier (5 req/min), use ≥12-second delays; if the user upgrades to ALL-STAR (60 req/min), the 1-second delay in CONTEXT.md applies fine.

---

## CRITICAL FINDING: BALLDONTLIE Rate Limits

**This finding affects the delay strategy locked in CONTEXT.md.**

| Tier | Rate Limit | Monthly Cost |
|------|-----------|--------------|
| Free | **5 req/min** | $0 |
| ALL-STAR | 60 req/min | $9.99 |
| GOAT | 600 req/min | $39.99 |

The CONTEXT.md states "stays comfortably under 60 req/min free tier" — but the free tier is actually **5 req/min**, not 60. The 60 req/min is the ALL-STAR paid tier.

**Impact on planning:**
- If using the free tier: minimum 12-second delay between requests
- If using ALL-STAR tier: the 1-second delay in CONTEXT.md is correct
- Regardless, the bulk-fetch-by-season approach (fewer total requests) is essential on free tier
- Confidence: HIGH (verified from official docs.balldontlie.io)

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `postgres` (porsager) | ^3.4 | PostgreSQL client with sql template tag | Chosen in CONTEXT.md; lightweight, no ORM overhead, TypeScript native |
| `tsx` | ^4.x | TypeScript script runner (zero-config) | Runs `scripts/backfill.ts` directly without a build step |
| `dotenv` (or native) | built into Node 20+ | Load `.env.local` for script context | `--env-file=.env.local` flag in Node 20+, or `dotenv/config` import |
| `next` | 15.x | App Router framework (scaffold only in Phase 4) | Locked in CONTEXT.md |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `typescript` | ^5.x | Type safety for scripts and app | Required for tsx and Next.js TS |
| `shadcn/ui` | latest | UI components (scaffold only, not used in Phase 4) | Installed in scaffold; used in later UI phases |
| `tailwindcss` | ^3.x / ^4.x | Styling (scaffold only) | Installed in scaffold |
| `recharts` | ^2.x | Charts (scaffold only) | Installed in scaffold |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `postgres` | `@neondatabase/serverless` | Neon serverless driver has `neon()` sql tag too — nearly identical API. `postgres` works for scripts (not edge); either would work for this use case |
| `tsx` | `ts-node` | tsx uses esbuild (faster, no type-checking); ts-node uses tsc. For scripts, tsx is simpler |
| Raw API calls with `fetch` | `@balldontlie/api` SDK | CONTEXT.md implies raw fetch — SDK exists but adds dependency; raw fetch is more transparent |

**Installation:**
```bash
# Scaffold
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*"

# DB client + script runner
npm install postgres
npm install -D tsx typescript @types/node

# shadcn/ui (post-scaffold)
npx shadcn@latest init

# Recharts
npm install recharts
```

---

## Architecture Patterns

### Recommended Project Structure
```
/                          # repo root
├── Docs/                  # locked — existing documentation
│   └── DB_SCHEMA.sql      # apply to Neon before backfill
├── scripts/
│   ├── backfill.ts        # main backfill entry point (npm run backfill)
│   ├── lib/
│   │   ├── db.ts          # postgres client singleton
│   │   ├── bdl-client.ts  # BALLDONTLIE API fetch wrapper
│   │   └── upserts.ts     # typed upsert functions per table
│   └── types/
│       └── bdl.ts         # BDL API response shape types
├── app/                   # Next.js App Router (scaffold only in Phase 4)
│   └── layout.tsx
├── .env.local             # DATABASE_URL, BALLDONTLIE_API_KEY (never committed)
├── .env.example           # safe template committed to repo
├── package.json
└── tsconfig.json
```

### Pattern 1: Two-Phase Bulk Fetch Strategy

**What:** Fetch all games for a season first (bulk, paginated), then fetch player stats in batches by `game_ids[]` (up to 100 per call). Never fetch stats one game at a time.

**When to use:** Always for the historical backfill — minimizes total API calls dramatically.

**Why it matters:** With 3 seasons of ~1,300 games each, fetching stats one game at a time = ~3,900 API calls. Batching 100 games per stats call = ~39 API calls for player stats. On the free tier (5 req/min), this is the difference between 13+ hours and ~15 minutes.

```typescript
// Phase 1: fetch all final game IDs for a season
const games = await fetchAllGamesForSeason(2022); // paginated GET /v1/games?seasons[]=2022

// Phase 2: fetch stats in batches of 100 game IDs
for (const batch of chunk(finalGameIds, 100)) {
  const stats = await fetchStatsBatch(batch); // GET /v1/stats?game_ids[]=...
  await upsertPlayerBoxScores(stats);
  await sleep(DELAY_MS);
}
```

### Pattern 2: postgres sql Template Upsert

**What:** Direct SQL upsert using `INSERT ... ON CONFLICT ... DO UPDATE SET` via the `postgres` sql tag.

**When to use:** Every write to the DB — enforces idempotency.

```typescript
// Source: porsager/postgres GitHub README + PostgreSQL docs
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL!);

// Team upsert
await sql`
  INSERT INTO teams (nba_team_id, abbreviation, name, city, conference, division)
  VALUES (${t.id}, ${t.abbreviation}, ${t.name}, ${t.city}, ${t.conference}, ${t.division})
  ON CONFLICT (nba_team_id) DO UPDATE SET
    abbreviation = EXCLUDED.abbreviation,
    name = EXCLUDED.name,
    city = EXCLUDED.city,
    conference = EXCLUDED.conference,
    division = EXCLUDED.division,
    updated_at = now()
`;
```

### Pattern 3: app_kv Checkpoint Pattern

**What:** Store season-level progress in the `app_kv` table. On restart, check the last completed season and skip already-processed seasons.

**When to use:** Wrapping each season's full ingestion (games + box scores for that season).

```typescript
// Read checkpoint
const [row] = await sql`SELECT value FROM app_kv WHERE key = 'backfill:last_completed_season'`;
const lastCompleted: number = row?.value ?? 0;

// After completing a season:
await sql`
  INSERT INTO app_kv (key, value, updated_at)
  VALUES ('backfill:last_completed_season', ${sql.json(seasonId)}, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
`;
```

### Pattern 4: Fail-Fast Env Check

**What:** Validate required environment variables at script startup before any API calls.

```typescript
// scripts/backfill.ts top of file
const DATABASE_URL = process.env.DATABASE_URL;
const BDL_API_KEY = process.env.BALLDONTLIE_API_KEY;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set. Add it to .env.local');
  process.exit(1);
}
if (!BDL_API_KEY) {
  console.error('ERROR: BALLDONTLIE_API_KEY is not set. Add it to .env.local');
  process.exit(1);
}
```

### Pattern 5: Transaction Per Game (for finalize_completed_games)

**What:** Wrap team + player box score inserts for a single game in a transaction. If player box scores fail, the team box score is rolled back too — preventing partial writes.

```typescript
// Source: porsager/postgres README (transactions)
await sql.begin(async (sql) => {
  await sql`INSERT INTO game_team_box_scores ...`;
  await sql`INSERT INTO game_player_box_scores ...`; // multiple rows
});
```

### Anti-Patterns to Avoid

- **Fetching stats one game at a time:** Use `game_ids[]` batch parameter instead. One-at-a-time makes the backfill take 10x longer on free tier.
- **Using `/v1/box_scores?date=YYYY-MM-DD` for historical backfill:** This endpoint only filters by a single date and is meant for live/daily use. Use `/v1/stats?game_ids[]=` for bulk historical player stats.
- **Inserting without ON CONFLICT:** Breaks idempotency. Every insert must be an upsert.
- **Loading `.env.local` with `dotenv`:** Next.js loads `.env.local` automatically in app context but not in `scripts/`. Use `node --env-file=.env.local` in the npm script, or explicitly load dotenv in the script.
- **Querying players/teams after every game:** Upsert teams and players once during reference sync, then use `nba_team_id`/`nba_player_id` lookups to get internal IDs.

---

## BALLDONTLIE API Reference

### Endpoint Map for Phase 4
| Purpose | Endpoint | Key Params | Notes |
|---------|----------|-----------|-------|
| All teams | `GET /v1/teams` | — | One-time, ~30 teams, no pagination needed |
| All players | `GET /v1/players` | `cursor`, `per_page=100` | Cursor-paginated; upsert all |
| Games by season | `GET /v1/games` | `seasons[]=2022`, `per_page=100`, `cursor` | Supports `postseason` bool filter |
| Player stats by game batch | `GET /v1/stats` | `game_ids[]=`, `per_page=100`, `cursor` | Up to 100 game IDs per call |
| Box scores (avoid for backfill) | `GET /v1/box_scores` | `date=YYYY-MM-DD` | Date-only filter — do not use for bulk historical |

### Pagination Pattern
All list endpoints use cursor-based pagination:
```
GET /v1/games?seasons[]=2022&per_page=100
→ { data: [...], meta: { next_cursor: 12345, per_page: 100 } }

GET /v1/games?seasons[]=2022&per_page=100&cursor=12345
→ { data: [...], meta: { next_cursor: null, per_page: 100 } }
# null next_cursor = last page
```

### Status Field Values (games)
The BDL API status field is a string. Historical games will show `"Final"` (capital F). In-progress 2024-25 games may show other values. Filter: only ingest box scores for games where `status === "Final"`.

### Season Year Convention
BDL uses the **start year** of a season. `seasons[]=2022` = 2022-23 season. Map to the schema's `season_id` (which also uses start year per DATA_DICTIONARY.md).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQL injection-safe parameterization | String interpolation in queries | `postgres` sql template tag | Template tag auto-parameterizes values |
| Cursor pagination iteration | Custom page iterator | Simple `while (cursor !== null)` loop | BDL returns `meta.next_cursor` = null on last page |
| Exponential backoff | Custom retry logic | Simple loop with `Math.pow(2, attempt) * 1000` ms sleep | 3 retries is all we need; no library required |
| DB connection pooling | Manual pool management | `postgres()` singleton | porsager/postgres handles pooling internally |
| Schema migration | ORM migration system | `psql -f Docs/DB_SCHEMA.sql` | Schema is locked, applied once |

**Key insight:** This is a one-time ETL script, not a production service. Simple, readable code with explicit loops, retries, and console.log is better than abstraction layers.

---

## Common Pitfalls

### Pitfall 1: Rate Limit Misunderstanding
**What goes wrong:** Script hits 429 errors immediately if delay is 1 second on free tier (5 req/min = 12 seconds minimum).
**Why it happens:** CONTEXT.md references "60 req/min free tier" but the actual free tier is 5 req/min. 60 req/min is the ALL-STAR paid tier ($9.99/mo).
**How to avoid:** Use ≥12-second delays on free tier, OR upgrade to ALL-STAR tier. Make delay configurable via env var or CLI flag.
**Warning signs:** Immediate 429 responses at startup.

### Pitfall 2: Schema Not Applied Before Backfill
**What goes wrong:** Script fails with "relation does not exist" errors.
**Why it happens:** Phase 4 creates the project from scratch — Neon DB is empty until `DB_SCHEMA.sql` is applied.
**How to avoid:** Wave 0 task must apply schema first: `psql $DATABASE_URL -f Docs/DB_SCHEMA.sql`. Script can also verify table existence and fail with a helpful error.
**Warning signs:** `relation "games" does not exist` on first DB query.

### Pitfall 3: `.env.local` Not Loaded in `scripts/`
**What goes wrong:** `process.env.DATABASE_URL` is undefined when running `tsx scripts/backfill.ts`.
**Why it happens:** Next.js auto-loads `.env.local` for the app, but plain Node.js (via tsx) does not.
**How to avoid:** Set the npm script as `"backfill": "node --env-file=.env.local node_modules/.bin/tsx scripts/backfill.ts"` — this is the Node 20+ approach. Alternatively, add `import 'dotenv/config'` at the top of the script with `dotenv` installed.
**Warning signs:** "DATABASE_URL is not set" error from fail-fast check even when `.env.local` exists.

### Pitfall 4: Player IDs Not Present Before Box Score Insert
**What goes wrong:** Foreign key violation on `game_player_box_scores.player_id`.
**Why it happens:** Player rows in `players` table must exist before box score rows reference them.
**How to avoid:** Upsert all players (from stats response) before inserting their box score rows. The stats response includes full player objects — upsert them inline.
**Warning signs:** `insert or update on table "game_player_box_scores" violates foreign key constraint`.

### Pitfall 5: Partial Writes on Interruption
**What goes wrong:** Resuming the backfill after a crash may leave some games partially written (team box score written, player box scores missing).
**Why it happens:** Season-level checkpointing only tracks completed seasons. Interrupted mid-season leaves a gap.
**How to avoid:** Use `ON CONFLICT DO UPDATE` everywhere. Games and box scores already written will upsert cleanly. The season checkpoint only advances when the full season is confirmed complete. Gaps within a season fill in on re-run.
**Warning signs:** Missing `game_player_box_scores` rows for games that have `game_team_box_scores`.

### Pitfall 6: 2024-25 Season Includes Unfinished Games
**What goes wrong:** Box scores for in-progress or future games get inserted as if final.
**Why it happens:** Fetching the 2024-25 season returns scheduled and in-progress games alongside completed ones.
**How to avoid:** Filter strictly: only process games where `status === "Final"` before attempting box score ingestion. Log skipped game IDs.
**Warning signs:** Box scores with null scores in the DB for games that haven't been played.

---

## Code Examples

### DB Client Singleton
```typescript
// scripts/lib/db.ts
import postgres from 'postgres';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

export const sql = postgres(process.env.DATABASE_URL, {
  max: 3,         // small pool for a CLI script
  idle_timeout: 30,
});
```

### BDL API Fetch Helper
```typescript
// scripts/lib/bdl-client.ts
const BASE = 'https://api.balldontlie.io/v1';
const KEY = process.env.BALLDONTLIE_API_KEY!;

async function bdlGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: KEY },
  });
  if (res.status === 429) throw new Error('RATE_LIMITED');
  if (!res.ok) throw new Error(`BDL error ${res.status}: ${path}`);
  return res.json() as T;
}

// Paginated fetcher — collects all pages
export async function fetchAll<T>(path: string, params: Record<string, string> = {}): Promise<T[]> {
  const results: T[] = [];
  let cursor: number | null = null;
  do {
    const p = { ...params, per_page: '100', ...(cursor ? { cursor: String(cursor) } : {}) };
    const resp: { data: T[]; meta: { next_cursor: number | null } } = await bdlGet(path, p);
    results.push(...resp.data);
    cursor = resp.meta.next_cursor;
    if (cursor) await sleep(DELAY_MS);
  } while (cursor !== null);
  return results;
}
```

### Retry Wrapper
```typescript
// scripts/lib/bdl-client.ts
const MAX_RETRIES = 3;

export async function withRetry<T>(fn: () => Promise<T>): Promise<T | null> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const wait = Math.pow(2, attempt) * 1000;
      console.warn(`  Attempt ${attempt + 1} failed (${(err as Error).message}). Retrying in ${wait}ms...`);
      await sleep(wait);
    }
  }
  console.error(`  All ${MAX_RETRIES} retries failed — skipping this request.`);
  return null;
}
```

### Season Ingestion Flow (high level)
```typescript
// scripts/backfill.ts
const SEASONS = [2022, 2023, 2024]; // 2022-23, 2023-24, 2024-25

for (const seasonId of SEASONS) {
  const lastCompleted = await getCheckpoint('backfill:last_completed_season');
  if (lastCompleted >= seasonId) {
    console.log(`Season ${seasonId}: already complete, skipping.`);
    continue;
  }

  console.log(`\nSeason ${seasonId}: starting...`);

  // 1. Sync reference data (teams + players) - these upsert safely
  await syncTeams();
  await syncPlayers();

  // 2. Fetch all final games for this season
  const games = await fetchAll('/games', { 'seasons[]': String(seasonId) });
  const finalGames = games.filter(g => g.status === 'Final');
  console.log(`  ${finalGames.length} final games found (${games.length - finalGames.length} skipped)`);
  await upsertGames(finalGames, seasonId);

  // 3. Fetch stats in batches of 100 game IDs
  const gameIds = finalGames.map(g => g.id);
  for (const batch of chunk(gameIds, 100)) {
    const stats = await withRetry(() =>
      fetchAll('/stats', { 'game_ids[]': batch.join('&game_ids[]=') })
    );
    if (stats) await upsertBoxScores(stats);
    await sleep(DELAY_MS);
  }

  await setCheckpoint('backfill:last_completed_season', seasonId);
  console.log(`Season ${seasonId}: COMPLETE`);
}

console.log('\nBackfill complete. Summary:');
await printSummary();
await sql.end();
```

### package.json scripts
```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "backfill": "node --env-file=.env.local node_modules/.bin/tsx scripts/backfill.ts"
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ts-node for TypeScript scripts | tsx (esbuild-based) | 2022–2023 | Zero config, much faster startup, no tsconfig required |
| dotenv package for env files | `node --env-file=.env.local` | Node 20 (2023) | Built-in; one fewer dependency |
| Page-based pagination | Cursor-based pagination | BDL v1 API | Must follow `meta.next_cursor`, not page numbers |
| `pg` (node-postgres) | `postgres` (porsager) | Growing adoption 2022+ | sql tag syntax, better TypeScript ergonomics |

**Deprecated/outdated:**
- `ts-node`: still works but tsx is simpler and faster for scripts
- Page-number pagination: BDL uses cursors exclusively in v1

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None pre-existing — this is the first code phase |
| Config file | Wave 0 creates `scripts/__tests__/` or lightweight integration test |
| Quick run command | `npx tsx scripts/__tests__/smoke.ts` (manual script, not jest) |
| Full suite command | Same — no automated test runner configured in Phase 4 |

**Note:** Phase 4 is a one-time ETL script. Formal test framework (jest/vitest) is not worth setting up for a backfill script. Validation is done via direct DB verification queries after the backfill runs.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DATA-01 | 3 seasons of games/teams/players/box scores present | Manual DB verification | `psql $DATABASE_URL -c "SELECT count(*) FROM games"` | ❌ Wave 0 SQL queries |
| DATA-04 | Idempotent re-run doesn't create duplicates | Manual re-run test | `npm run backfill` twice; `SELECT count(*)` should be identical | ❌ document in Wave 0 |
| DATA-05 | Final box scores ingest correctly | Manual DB spot check | `psql $DATABASE_URL -c "SELECT * FROM game_player_box_scores LIMIT 5"` | ❌ Wave 0 verification queries |

### Sampling Rate
- **Per task commit:** Run `psql $DATABASE_URL -c "SELECT count(*) FROM games, teams, players"` to verify counts grow
- **Per wave merge:** Full verification — count all 6 tables, spot-check a known game against source data
- **Phase gate:** All verification queries pass before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `Docs/DB_SCHEMA.sql` applied to Neon — run `psql $DATABASE_URL -f Docs/DB_SCHEMA.sql`
- [ ] `.env.local` created with real `DATABASE_URL` and `BALLDONTLIE_API_KEY` values
- [ ] `.env.example` committed with placeholder values
- [ ] `scripts/verification.sql` — SQL queries to verify backfill success (counts, spot checks)

---

## Open Questions

1. **Free vs. ALL-STAR BALLDONTLIE tier**
   - What we know: Free tier is 5 req/min; ALL-STAR is 60 req/min ($9.99/mo)
   - What's unclear: Which tier the user has or plans to use
   - Recommendation: Make `DELAY_MS` configurable via env var (default: 12000ms for free tier safety). If the user has ALL-STAR, they can set `DELAY_MS=1000`. Document this in the script's output.

2. **player_team_stints population strategy**
   - What we know: The schema has `player_team_stints` to track roster changes. The stats response includes team info per player per game.
   - What's unclear: Whether Phase 4 should populate `player_team_stints` or defer to Phase 5+
   - Recommendation: Populate stints in Phase 4 using the team assignment visible in each game's stats response. Season-level stints (one row per player per season per team) are sufficient for MVP.

3. **`finalize_completed_games` job — Phase 4 or 7?**
   - What we know: INGESTION_PLAN.md defines `finalize_completed_games` as a recurring job. Phase 4 success criteria includes "final box scores ingest correctly after games end" (DATA-05).
   - What's unclear: Whether Phase 4 should implement the `finalize_completed_games` script or just demonstrate DATA-05 via the backfill
   - Recommendation: The backfill script already covers DATA-05 for historical games. A stub or note documenting the `finalize_completed_games` job pattern satisfies the requirement. Full implementation belongs in Phase 7 (Live Data Pipeline).

---

## Sources

### Primary (HIGH confidence)
- `Docs/DB_SCHEMA.sql` — authoritative schema; all table and column names verified directly
- `Docs/INGESTION_PLAN.md` — job specifications for backfill, retry logic, app_kv checkpoints
- `Docs/ARCHITECTURE.md` — stack and data source decisions
- [docs.balldontlie.io](https://docs.balldontlie.io/) — rate limits (5/60/600 req/min by tier), endpoint parameters, pagination format, box_scores date-only constraint

### Secondary (MEDIUM confidence)
- [github.com/porsager/postgres](https://github.com/porsager/postgres) — sql template tag syntax, upsert patterns, connection options
- [npmjs.com/package/tsx](https://www.npmjs.com/package/tsx) — version 4.x, zero-config TypeScript execution

### Tertiary (LOW confidence)
- `GET /v1/box_scores` date-only limitation: confirmed from official docs fetch, but not tested live — verify actual response includes player stats nested in the teams response if the `/v1/stats` batch approach encounters issues

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all from locked CONTEXT.md decisions + verified npm packages
- Architecture patterns: HIGH — derived from authoritative project docs (INGESTION_PLAN.md, DB_SCHEMA.sql)
- BALLDONTLIE API specifics: HIGH — verified from official docs.balldontlie.io
- Rate limits: HIGH — verified from official docs; contradicts CONTEXT.md assumption (see CRITICAL FINDING)
- Pitfalls: MEDIUM — based on standard ETL patterns + API characteristics

**Research date:** 2026-03-05
**Valid until:** 2026-06-05 (90 days — BDL API is stable; postgres package major version unlikely to change)
