# Phase 6: Insight Engine - Research

**Researched:** 2026-03-06
**Domain:** TypeScript data pipeline — algorithmic insight generation, proof storage, PostgreSQL upserts, pure function detection logic
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Phase Boundary:**
- Generate and store provable insights from stored data into the `insights` table
- Two modes: Batch (`between_games`/`historical` scopes) via `npm run generate-insights` and Live (`live` scope) via exported `generateLiveInsights()` function
- Phase 6 does NOT build the live polling pipeline (Phase 7), the API layer (Phase 9), or the UI (Phases 11–14)

**Insight Category Split:**
- Batch categories stored in DB: player streaks (2–3 types), milestones (2–3 types), rare statistical events (2–3 types), opponent context (2–3 types), league comparisons (2–3 types)
- Live categories (transient, never stored): scoring runs (8-0 or greater), clutch alerts (last 5 min Q4/OT, margin ≤ 8)

**Rare event threshold:** Top 5% percentile rank across all games in the 3-season DB

**Batch Generation Model:**
- Entry point: `npm run generate-insights` → `scripts/generate-insights.ts`
- Internal modules: `scripts/lib/insights/` — one file per category (streaks.ts, milestones.ts, rare-events.ts, opponent-context.ts, league-comparisons.ts)
- Mirrors `compute-stats.ts` pattern: imports lib modules, runs in sequence, logs progress + summary
- Full recompute every run — no incremental tracking
- Idempotent upserts handle re-runs

**Deduplication Strategy:**
- `proof_hash` = deterministic SHA fingerprint of `(category, team_id, player_id, game_id, season_id, metric_key)`
- ON CONFLICT on `proof_hash` → UPDATE existing row

**Importance Scoring:** `base + rarity_boost + recency_boost` capped at 100
- Base: milestone=80, rare_event=78, streak=72, league_comparison=65, opponent_context=60
- Rarity boost: top 1%=+15, top 5%=+5
- Recency boost: last 7 days=+10, last 30 days=+5

**Live Insight Architecture:**
- Lives in `scripts/lib/insights/live.ts` (or `src/lib/insights/live.ts` — at discretion)
- Signature: `generateLiveInsights(snapshot: LiveSnapshot, rollingData: RollingContext): InsightCandidate[]`
- No DB dependency in the function itself
- Proven by unit tests with constructed snapshots
- Transient: generated on each `/api/live` call, never written to DB

### Claude's Discretion

- Exact SHA hashing implementation for proof_hash
- Console output format for generate-insights (mirror backfill/compute-stats style)
- Specific SQL queries per insight type (within the category + threshold decisions above)
- Whether to add --dry-run flag
- File location for live.ts (scripts/lib vs src/lib — whichever integrates better with Phase 9 API layer)

### Deferred Ideas (OUT OF SCOPE)

- None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INSIGHT-01 | System generates algorithmic insights from stored data | Batch script pattern mirrors compute-stats.ts; lib module structure per category |
| INSIGHT-02 | Insight engine supports: scoring runs, clutch alerts, player streaks, milestones, rare statistical events, opponent context, league comparisons | Category split locked in CONTEXT.md; detection logic patterns documented in Code Examples |
| INSIGHT-03 | Every insight stores proof_sql, proof_params, and proof_result | `insights` table schema confirmed: proof_sql TEXT NOT NULL, proof_params JSONB, proof_result JSONB NOT NULL; upsert pattern documented |
| INSIGHT-04 | Insights without valid proof are never displayed | DB NOT NULL constraint on proof_sql + proof_result enforces this at storage layer; application layer must only insert when proof query confirms the claim |
| INSIGHT-05 | Live insights generated on-demand from current snapshot + rolling windows | Pure `generateLiveInsights()` function with no DB dependency; Phase 7 wires into polling |
</phase_requirements>

---

## Summary

Phase 6 builds the insight generation pipeline on top of the advanced stats and rolling windows already computed in Phase 5. The work divides cleanly into two tracks: a batch script (`scripts/generate-insights.ts`) that reads historical and rolling data tables and upserts rows into the `insights` table, and a pure exported function (`generateLiveInsights`) that takes typed snapshot inputs and returns transient insight candidates without touching the DB.

The `insights` table schema is already defined in `Docs/DB_SCHEMA.sql` and deployed. Every row requires `proof_sql` (NOT NULL TEXT) and `proof_result` (NOT NULL JSONB), making the DB itself enforce the provability contract. The deduplication key is `proof_hash` — a deterministic SHA-256 fingerprint of the logical identity tuple, hashed in TypeScript before upsert. The ON CONFLICT clause on `proof_hash` updates the existing row rather than inserting a duplicate.

The live detection functions (scoring run detection and clutch alert) operate purely on in-memory data structures, making them straightforwardly testable with constructed snapshots. No live data source or DB connection is required to validate their logic.

**Primary recommendation:** Build generate-insights.ts mirroring compute-stats.ts exactly — same banner, same step logging, same error/exit pattern. Each category lib module returns an array of pre-validated `InsightRow` objects with proof fields populated; the orchestrator upserts them all.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `postgres` | ^3.4.8 | DB client — `sql` template tag | Already in use; all prior scripts use it |
| `tsx` | ^4.21.0 | Script runner | Already configured in `npm run compute-stats`; handles TS + ESM |
| Node.js `crypto` | built-in | SHA-256 for proof_hash | No install needed; `crypto.createHash('sha256')` is stable |
| TypeScript | ^5.9.3 | Type safety | Project-wide |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js `crypto` | built-in | `createHash('sha256').update(str).digest('hex')` | proof_hash computation |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Node.js built-in `crypto` | `npm install sha.js` | Built-in is zero-install, same API, no reason to add a dep |
| Full recompute per run | Incremental checkpoint in `app_kv` | Full recompute is the established pattern (matches compute-stats); simpler, consistent |

**Installation:**
```bash
# No new packages needed — crypto is Node built-in, postgres + tsx already installed
```

---

## Architecture Patterns

### Recommended Project Structure

```
scripts/
├── generate-insights.ts          # Orchestrator — mirrors compute-stats.ts
└── lib/
    └── insights/
        ├── streaks.ts            # Player streak detection (scoring streak, hot shooting)
        ├── milestones.ts         # Season/career milestone detection
        ├── rare-events.ts        # Top 5% percentile detection across 3-season DB
        ├── opponent-context.ts   # Opponent off/def rating, H2H record
        ├── league-comparisons.ts # Clippers rank top-N in league stat last-10
        └── live.ts               # Pure fn: generateLiveInsights(snapshot, rollingData)
```

### Pattern 1: Category Lib Module Shape

**What:** Each batch category module exports an async function that queries the DB and returns an array of fully-constructed `InsightRow` objects (with all proof fields populated). The orchestrator calls each in sequence and upserts the results.

**When to use:** All five batch categories.

**Example:**
```typescript
// scripts/lib/insights/milestones.ts
import { sql } from '../db.js';
import crypto from 'crypto';

export interface InsightRow {
  scope: 'between_games' | 'historical';
  team_id: string | null;
  game_id: string | null;
  player_id: string | null;
  season_id: number | null;
  category: string;
  headline: string;
  detail: string | null;
  importance: number;
  proof_sql: string;
  proof_params: Record<string, unknown>;
  proof_result: unknown[];
  proof_hash: string;
}

function makeProofHash(
  category: string,
  teamId: string | null,
  playerId: string | null,
  gameId: string | null,
  seasonId: number | null,
  metricKey: string
): string {
  const raw = [category, teamId, playerId, gameId, seasonId, metricKey].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export async function generateMilestoneInsights(): Promise<InsightRow[]> {
  // ... query, build InsightRow[], return
  return [];
}
```

### Pattern 2: Orchestrator Upsert Loop

**What:** `generate-insights.ts` calls each category module, collects all rows, then upserts into `insights` using ON CONFLICT on `proof_hash`.

**When to use:** `generate-insights.ts` main()

**Example:**
```typescript
// scripts/generate-insights.ts (excerpt)
import { sql } from './lib/db.js';
import { generateStreakInsights } from './lib/insights/streaks.js';
// ... other imports

async function upsertInsight(row: InsightRow): Promise<void> {
  await sql`
    INSERT INTO insights (
      scope, team_id, game_id, player_id, season_id,
      category, headline, detail, importance,
      proof_sql, proof_params, proof_result, proof_hash
    ) VALUES (
      ${row.scope},
      ${row.team_id ? sql`${row.team_id}::bigint` : null},
      ${row.game_id ? sql`${row.game_id}::bigint` : null},
      ${row.player_id ? sql`${row.player_id}::bigint` : null},
      ${row.season_id},
      ${row.category}, ${row.headline}, ${row.detail}, ${row.importance},
      ${row.proof_sql}, ${sql.json(row.proof_params)},
      ${sql.json(row.proof_result)}, ${row.proof_hash}
    )
    ON CONFLICT (proof_hash) DO UPDATE SET
      headline     = EXCLUDED.headline,
      detail       = EXCLUDED.detail,
      importance   = EXCLUDED.importance,
      proof_result = EXCLUDED.proof_result,
      updated_at   = now()
  `;
}
```

**Note:** The `insights` table has `proof_hash TEXT` but no UNIQUE constraint defined in the current schema. Wave 0 must add `CREATE UNIQUE INDEX IF NOT EXISTS uq_insights_proof_hash ON insights (proof_hash)` before the ON CONFLICT clause will work.

### Pattern 3: Pure Live Detection Function

**What:** `generateLiveInsights` takes fully-typed in-memory inputs and returns `InsightCandidate[]` with no DB calls. Logic is deterministic and testable.

**When to use:** `live.ts` module

**Example:**
```typescript
// scripts/lib/insights/live.ts

export interface LiveSnapshot {
  game_id: string;
  period: number;             // 1–4 for regulation, 5+ for OT
  clock: string;              // "MM:SS" format
  home_score: number;
  away_score: number;
  home_team_id: string;
  away_team_id: string;
  recent_scoring: ScoringEvent[];  // ordered chronological; from snapshot payload
}

export interface ScoringEvent {
  team_id: string;
  points: number;
  event_time_seconds: number; // seconds elapsed in game
}

export interface RollingContext {
  home_rolling_10: RollingTeamRow | null;
  away_rolling_10: RollingTeamRow | null;
}

export interface InsightCandidate {
  category: 'run' | 'clutch';
  headline: string;
  detail: string | null;
  importance: number;
  proof_sql: string;
  proof_params: Record<string, unknown>;
  proof_result: unknown[];
}

export function generateLiveInsights(
  snapshot: LiveSnapshot,
  rollingData: RollingContext
): InsightCandidate[] {
  const results: InsightCandidate[] = [];

  // Scoring run detection: find consecutive unanswered points >= 8 by either team
  const run = detectScoringRun(snapshot.recent_scoring);
  if (run && run.points >= 8) {
    results.push(buildRunInsight(run, snapshot));
  }

  // Clutch alert: last 5 min of Q4/OT, margin <= 8
  if (isClutchSituation(snapshot)) {
    results.push(buildClutchInsight(snapshot));
  }

  return results;
}

function parseClockSeconds(clock: string): number {
  const [min, sec] = clock.split(':').map(Number);
  return (isNaN(min) ? 0 : min) * 60 + (isNaN(sec) ? 0 : sec);
}

function isClutchSituation(snap: LiveSnapshot): boolean {
  const secondsRemaining = parseClockSeconds(snap.clock);
  const margin = Math.abs(snap.home_score - snap.away_score);
  return snap.period >= 4 && secondsRemaining <= 300 && margin <= 8;
}
```

### Pattern 4: Proof SQL Construction

**What:** Each insight stores the SQL that proves the claim as a plain string, the parameter values as JSONB, and a snapshot of what the query returned.

**When to use:** Every batch insight row. The proof query is run at generation time; the result is captured and stored alongside the SQL. On display, the API can re-execute the proof query to verify or simply surface the stored snapshot.

**Example for a player streak:**
```typescript
const proofSql = `
  SELECT p.display_name, pb.points, g.game_date
  FROM game_player_box_scores pb
  JOIN games g ON g.game_id = pb.game_id
  JOIN players p ON p.player_id = pb.player_id
  WHERE pb.player_id = $1::bigint
    AND g.game_date >= $2
  ORDER BY g.game_date DESC
  LIMIT $3
`;
const proofParams = { player_id: playerId, from_date: streakStartDate, games: streakLength };
// Execute proofSql with params, capture rows as proofResult
const proofResult = await sql`...`;
```

### Pattern 5: Importance Score Computation

**What:** Pure helper function, no DB dependency.

**Example:**
```typescript
function computeImportance(
  category: 'milestone' | 'rare_event' | 'streak' | 'league_comparison' | 'opponent_context',
  percentileRank: number | null,  // 0–100; null if category doesn't use percentiles
  gameDateMs: number              // Date.getTime()
): number {
  const base: Record<string, number> = {
    milestone: 80,
    rare_event: 78,
    streak: 72,
    league_comparison: 65,
    opponent_context: 60,
  };
  let score = base[category] ?? 50;

  // Rarity boost
  if (percentileRank !== null) {
    if (percentileRank >= 99) score += 15;
    else if (percentileRank >= 95) score += 5;
  }

  // Recency boost
  const now = Date.now();
  const ageDays = (now - gameDateMs) / 86_400_000;
  if (ageDays <= 7) score += 10;
  else if (ageDays <= 30) score += 5;

  return Math.min(100, score);
}
```

### Anti-Patterns to Avoid

- **Inserting without proof fields populated:** proof_sql and proof_result are NOT NULL in the schema. Any attempt to INSERT without them will fail at the DB level — good, but catch this in the application layer too before the insert attempt.
- **Using UUID as the conflict key:** The schema uses UUID PRIMARY KEY (`gen_random_uuid()`), not proof_hash, as the PK. The ON CONFLICT must target the `proof_hash` column via a unique index, not the PK.
- **Dynamic SQL in proof_sql field:** The stored proof_sql string should use positional `$1`, `$2` params — not interpolated values — so it remains a reusable, safe parameterized query.
- **DB dependency in generateLiveInsights:** Live fn must remain pure. If it needs historical context (e.g., player season average), that context is passed in via `RollingContext`, not fetched inside the function.
- **Assuming box score data exists for all games:** Phase 4 scope was narrowed (BDL box scores removed from MVP). Insight queries that join `game_player_box_scores` or `game_team_box_scores` will only match games that have box score data. Queries must handle this gracefully (no rows returned = no insight generated, not an error).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SHA-256 hashing | Custom hash function | `crypto.createHash('sha256')` from Node built-in | Battle-tested, collision-resistant, zero install |
| UUID generation | Custom UUID | `gen_random_uuid()` in Postgres via pgcrypto | Schema already uses it; `pgcrypto` extension enabled in schema |
| Percentile rank | Manual sort + slice | PostgreSQL `PERCENT_RANK() OVER (...)` window function | Handles ties correctly; runs in DB where data lives |
| Deduplication | Application-side duplicate check | `ON CONFLICT (proof_hash) DO UPDATE` | Atomic, race-condition safe, idempotent |

**Key insight:** PostgreSQL window functions (`PERCENT_RANK`, `RANK`, `ROW_NUMBER`) handle percentile and ranking computations correctly at scale — doing this in TypeScript after fetching all rows would be slower and more complex.

---

## Common Pitfalls

### Pitfall 1: proof_hash Unique Constraint Missing

**What goes wrong:** ON CONFLICT (proof_hash) requires a unique index on `proof_hash`. The current `DB_SCHEMA.sql` has `proof_hash TEXT` with no UNIQUE constraint and no unique index. Without it, ON CONFLICT will throw a PostgreSQL error.

**Why it happens:** The schema was designed with `proof_hash TEXT` as an optional column (nullable, no constraint). The CONTEXT.md decision to use it as the deduplication key was made after the schema was defined.

**How to avoid:** Wave 0 task must add `CREATE UNIQUE INDEX IF NOT EXISTS uq_insights_proof_hash ON insights (proof_hash) WHERE proof_hash IS NOT NULL;` before any upsert attempt. Alternatively, add it to the schema alteration in Wave 0.

**Warning signs:** `ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification` from postgres.js.

### Pitfall 2: bigint TypeScript Serialization

**What goes wrong:** `team_id`, `player_id`, `game_id` are BIGSERIAL/BIGINT in Postgres. When fetched via postgres.js, they come back as strings (by default in postgres.js v3). When inserting back, they must be cast with `::bigint`. Passing a raw JS number or string without cast causes type mismatch errors.

**Why it happens:** postgres.js represents BigInt as strings to avoid precision loss. Established in Phase 04-02 decisions.

**How to avoid:** Always use `${value}::bigint` in sql template tags when passing IDs. Read IDs as `::text` in SELECT queries. This pattern is already established in compute-stats.ts and rolling-windows.ts.

**Warning signs:** `SerializableParameter` TypeScript errors, or runtime `invalid input syntax for type bigint` from Postgres.

### Pitfall 3: PERCENT_RANK with DISTINCT + ORDER BY Cast Expressions

**What goes wrong:** PostgreSQL error `42P10: for SELECT DISTINCT, ORDER BY expressions must appear in select list` when combining DISTINCT with ORDER BY on cast expressions inside window function queries.

**Why it happens:** This is a known PostgreSQL restriction documented in Phase 05 decisions. DISTINCT requires the ORDER BY columns to be in the SELECT list.

**How to avoid:** Wrap the inner query in a subquery (CTE or derived table) that materializes the cast columns, then apply DISTINCT + ORDER BY on the outer query. Pattern established in Phase 05.

**Warning signs:** Error `42P10` from PostgreSQL.

### Pitfall 4: Empty proof_result for Valid Insights

**What goes wrong:** An insight is generated but `proof_result` is stored as an empty array `[]`. The insight appears fabricated because there's no evidence.

**Why it happens:** The proof query runs after the insight has already been "detected" by application logic, but returns no rows (e.g., because the game has no box score data yet, or a date filter is off by one).

**How to avoid:** Validate that `proofResult.length > 0` before constructing the InsightRow. If the proof query returns empty, the insight must be discarded — not stored. This enforces INSIGHT-04 at the application layer.

**Warning signs:** `proof_result: []` rows in the insights table.

### Pitfall 5: Live Insights Accidentally Written to DB

**What goes wrong:** generateLiveInsights result gets upserted into the insights table, polluting it with transient live data that becomes stale immediately.

**Why it happens:** Misunderstanding the scope boundary — live insights are scoped `"live"` and are transient by design.

**How to avoid:** `generateLiveInsights` must have no access to the `sql` client. Keep it in a file with zero DB imports. Phase 7 owns the wiring; Phase 6 only exposes the pure function.

---

## Code Examples

### Percentile rank with PostgreSQL window function

```sql
-- Example: rare event detection — find player-game performances in top 5% for points
-- across all games in the 3-season DB
SELECT
  sub.player_id,
  sub.game_id,
  sub.points,
  sub.pct_rank
FROM (
  SELECT
    pb.player_id,
    pb.game_id,
    pb.points,
    PERCENT_RANK() OVER (ORDER BY pb.points ASC) AS pct_rank
  FROM game_player_box_scores pb
  JOIN games g ON g.game_id = pb.game_id
  WHERE g.season_id IN (2022, 2023, 2024)
) sub
WHERE sub.pct_rank >= 0.95
  AND sub.player_id = $1::bigint
ORDER BY sub.pct_rank DESC;
```

### Scoring streak detection (SQL-side)

```sql
-- Consecutive games where a player scored >= N points
-- Use window functions to group consecutive qualifying games
WITH player_games AS (
  SELECT
    pb.player_id,
    pb.game_id,
    g.game_date,
    pb.points,
    pb.points >= 20 AS qualifies,
    ROW_NUMBER() OVER (PARTITION BY pb.player_id ORDER BY g.game_date) AS rn,
    ROW_NUMBER() OVER (PARTITION BY pb.player_id, (pb.points >= 20)::int ORDER BY g.game_date) AS rn2
  FROM game_player_box_scores pb
  JOIN games g ON g.game_id = pb.game_id
  WHERE pb.player_id = $1::bigint
    AND g.season_id = $2
)
SELECT player_id, MIN(game_date) AS streak_start, MAX(game_date) AS streak_end,
       COUNT(*) AS streak_length
FROM player_games
WHERE qualifies = TRUE
GROUP BY player_id, rn - rn2
HAVING COUNT(*) >= 3
ORDER BY streak_end DESC
LIMIT 1;
```

### H2H record for opponent context

```sql
-- Head-to-head record between Clippers and opponent this season
SELECT
  COUNT(*) FILTER (WHERE
    (g.home_team_id = $1::bigint AND g.home_score > g.away_score)
    OR (g.away_team_id = $1::bigint AND g.away_score > g.home_score)
  ) AS clippers_wins,
  COUNT(*) FILTER (WHERE
    (g.home_team_id = $2::bigint AND g.home_score > g.away_score)
    OR (g.away_team_id = $2::bigint AND g.away_score > g.home_score)
  ) AS opp_wins,
  COUNT(*) AS total_games
FROM games g
WHERE ((g.home_team_id = $1::bigint AND g.away_team_id = $2::bigint)
    OR (g.home_team_id = $2::bigint AND g.away_team_id = $1::bigint))
  AND g.season_id = $3
  AND g.status = 'final';
```

### proof_hash computation in TypeScript

```typescript
import crypto from 'crypto';

function makeProofHash(parts: {
  category: string;
  team_id: string | null;
  player_id: string | null;
  game_id: string | null;
  season_id: number | null;
  metric_key: string;
}): string {
  const raw = [
    parts.category,
    parts.team_id ?? '',
    parts.player_id ?? '',
    parts.game_id ?? '',
    parts.season_id ?? '',
    parts.metric_key,
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}
```

### Scoring run detection (pure TypeScript)

```typescript
interface ScoringRun {
  team_id: string;
  points: number;
  start_event_index: number;
  end_event_index: number;
}

function detectScoringRun(events: ScoringEvent[]): ScoringRun | null {
  if (events.length === 0) return null;

  let bestRun: ScoringRun | null = null;

  for (let startIdx = 0; startIdx < events.length; startIdx++) {
    const runTeam = events[startIdx].team_id;
    let runPoints = 0;
    let endIdx = startIdx;

    for (let i = startIdx; i < events.length; i++) {
      if (events[i].team_id !== runTeam) break;
      runPoints += events[i].points;
      endIdx = i;
    }

    if (runPoints >= 8) {
      if (!bestRun || runPoints > bestRun.points) {
        bestRun = { team_id: runTeam, points: runPoints, start_event_index: startIdx, end_event_index: endIdx };
      }
    }
  }

  return bestRun;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ORM-based upserts | Raw SQL template tags via `postgres` | Phase 04-01 | Lighter, Neon-compatible, TypeScript-native |
| Incremental state tracking | Full recompute per run | Phase 05 / Established | Simpler, idempotent, no checkpoint debt |
| Application-side deduplication | ON CONFLICT DO UPDATE on deterministic hash | Phase 06 (this phase) | Atomic, race-safe, DB-enforced |

---

## Open Questions

1. **proof_hash unique index — schema migration mechanism**
   - What we know: DB_SCHEMA.sql is applied via `npm run db:schema` using `sql.unsafe()`. Adding a new index requires either re-applying the full schema (idempotent IF EXISTS guards are in place) or a one-off ALTER.
   - What's unclear: Whether re-running `npm run db:schema` will add the new index without clobbering existing data. Given `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` patterns throughout the schema, adding `CREATE UNIQUE INDEX IF NOT EXISTS uq_insights_proof_hash` should be safe to append.
   - Recommendation: Add the unique index statement to `Docs/DB_SCHEMA.sql` as a Wave 0 task and re-run `npm run db:schema`. It is idempotent and safe.

2. **Live.ts file location: scripts/lib vs src/lib**
   - What we know: At discretion per CONTEXT.md. Phase 9 API routes live in `src/app/api/`. If live.ts is in `scripts/lib/`, Phase 9 must reach across directory boundaries.
   - What's unclear: Whether Next.js build will include files from `scripts/` directory.
   - Recommendation: Place `live.ts` in `src/lib/insights/live.ts` so it is within the Next.js module graph and Phase 9 API routes can import it without any path hacks. The batch category modules stay in `scripts/lib/insights/` since they are Node CLI context only.

3. **Box score data availability**
   - What we know: Phase 4 BDL box score backfill was removed from MVP scope. Currently, only 2 seed games (LAC vs MIA 2024-01-01, LAC vs PHX 2024-01-08) have box score data. Streak, milestone, and rare event insights all join box score tables.
   - What's unclear: Whether Phase 4 will be extended before Phase 6 verification, or whether Phase 6 verification will run against the 2-game seed set.
   - Recommendation: Insight generators must handle 0-row returns gracefully (no insight = no problem). Test verification should confirm the script runs successfully with sparse data, generating 0 rows where expected.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None installed — Wave 0 must install |
| Config file | None — Wave 0 creates `vitest.config.ts` |
| Quick run command | `npx vitest run scripts/lib/insights/live.test.ts` |
| Full suite command | `npx vitest run` |

**Recommended framework:** Vitest. It is the natural choice for a Next.js + TypeScript project with no existing test infrastructure. It supports TypeScript out of the box with zero config, runs ESM natively (matching the project's tsx/ESM setup), and integrates with the existing TypeScript version (^5.9.3). Jest requires additional transforms for ESM; Vitest does not.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INSIGHT-01 | Script generates rows from DB input | integration | Manual — requires DB connection | N/A — smoke test |
| INSIGHT-02 | All 7 categories produce output | unit (pure logic) + integration (SQL) | `npx vitest run scripts/lib/insights/live.test.ts` | ❌ Wave 0 |
| INSIGHT-03 | Every row has proof_sql, proof_params, proof_result | unit | `npx vitest run scripts/lib/insights/__tests__/proof.test.ts` | ❌ Wave 0 |
| INSIGHT-04 | Rows with empty proof_result are rejected before upsert | unit | `npx vitest run scripts/lib/insights/__tests__/proof.test.ts` | ❌ Wave 0 |
| INSIGHT-05 | `generateLiveInsights` returns scoring run and clutch alerts from constructed snapshots | unit | `npx vitest run scripts/lib/insights/live.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run scripts/lib/insights/live.test.ts` (pure function, no DB needed, < 5s)
- **Per wave merge:** `npx vitest run` (full suite)
- **Phase gate:** Full suite green + manual `npm run generate-insights` smoke run against seed DB before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `package.json` — add `"test": "vitest run"` script and install `vitest` as devDependency: `npm install -D vitest`
- [ ] `vitest.config.ts` — minimal config pointing at TypeScript source
- [ ] `scripts/lib/insights/live.test.ts` — unit tests for `generateLiveInsights`, `detectScoringRun`, `isClutchSituation` using constructed snapshots
- [ ] `scripts/lib/insights/__tests__/proof.test.ts` — unit tests for `makeProofHash` determinism and the "reject if proof_result empty" guard
- [ ] `Docs/DB_SCHEMA.sql` — add `CREATE UNIQUE INDEX IF NOT EXISTS uq_insights_proof_hash ON insights (proof_hash) WHERE proof_hash IS NOT NULL;`
- [ ] `npm run db:schema` — re-apply schema to add the unique index

---

## Sources

### Primary (HIGH confidence)

- Direct codebase read — `scripts/compute-stats.ts` (orchestrator pattern)
- Direct codebase read — `scripts/lib/rolling-windows.ts` (category lib module shape, sql template tag usage)
- Direct codebase read — `scripts/lib/upserts.ts` (ON CONFLICT DO UPDATE pattern, bigint cast pattern)
- Direct codebase read — `scripts/lib/db.ts` (sql singleton, pool config)
- Direct codebase read — `Docs/DB_SCHEMA.sql` (insights table schema, proof fields, existing indexes)
- Direct codebase read — `package.json` (installed packages, npm script conventions)
- Direct codebase read — `.planning/phases/06-insight-engine/06-CONTEXT.md` (all locked decisions)
- Node.js docs — `crypto.createHash` is stable built-in, no version concern

### Secondary (MEDIUM confidence)

- PostgreSQL documentation (PERCENT_RANK window function, ON CONFLICT syntax) — standard SQL, no version concern for Postgres 14+
- Phase 04/05 STATE.md decisions — bigint text cast pattern, DISTINCT subquery workaround (documented from prior implementation)

### Tertiary (LOW confidence)

- Vitest recommendation — based on project characteristics (ESM, TypeScript 5, Next.js 16). No Context7 lookup performed; recommendation is from knowledge of the ecosystem as of training data (August 2025). Verify current Vitest version before installing.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed; no new packages required for batch pipeline
- Architecture: HIGH — directly mirrors established compute-stats.ts pattern with full schema knowledge
- Pitfalls: HIGH — most pitfalls derived from prior phase decisions documented in STATE.md and direct code inspection
- Test framework recommendation: MEDIUM — Vitest is strongly indicated but not verified against current docs

**Research date:** 2026-03-06
**Valid until:** 2026-06-06 (stable domain — postgres.js, Node crypto, PostgreSQL window functions are all mature APIs)
