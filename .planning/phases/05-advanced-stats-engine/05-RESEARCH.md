# Phase 5: Advanced Stats Engine - Research

**Researched:** 2026-03-06
**Domain:** NBA advanced statistics computation, PostgreSQL upsert patterns, TypeScript CLI scripts
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Phase boundary:** Compute derived metrics from box score data; store in `advanced_team_game_stats`, `advanced_player_game_stats`, `rolling_team_stats`, `rolling_player_stats`. Build and validate the computation engine only.
- **Data availability strategy:** Box scores don't exist at Phase 5 time. Phase 5 seeds 2-3 real Clippers games with hardcoded box scores from Basketball-Reference. These are permanent records; Phase 7 will upsert on top.
- **Invocation model:** Single command `npm run compute-stats`. Script lives in `scripts/compute-stats.ts`. Runs advanced stats and rolling windows in sequence. Full recompute every run (no incremental tracking, no `app_kv` checkpoint needed). Idempotent upserts.
- **Team-level stats (per game) in `advanced_team_game_stats`:** possessions, pace, off_rating, def_rating, net_rating, eFG%, TS%, TOV%, REB%
- **Team rolling windows in `rolling_team_stats`:** windows last 5 and last 10 per season; stats: off_rating, def_rating, net_rating, pace, eFG%, TS%, TOV%, REB%, record (wins/losses). All NBA teams.
- **Player-level stats (per game) in `advanced_player_game_stats`:** usage_rate, TS%, eFG%, ast_rate, reb_rate, tov_rate
- **Player rolling windows in `rolling_player_stats`:** windows last 5 and last 10 per season; stats: pts, reb, ast, TS%, eFG%, minutes. All players with box score data.
- **Validation:** Run `compute-stats` against 2-3 seeded games; compare computed eFG% against Basketball-Reference within 1% tolerance. Manual validation (developer looks up value). One game sufficient.
- **eFG% formula (canonical):** `(FGM + 0.5 * FG3M) / FGA`
- **Seed script:** `scripts/seed-test-games.ts` (or similar); one-time utility; NOT part of compute-stats flow.

### Claude's Discretion
- Exact formula implementations for possessions and ratings (use Dean Oliver's standard 4-factor formulas)
- Which 2-3 specific Clippers games to seed (any clear-cut final regular season games work)
- Console output format for compute-stats (progress + final counts, consistent with backfill style)
- Whether to add `--dry-run` flag

### Deferred Ideas (OUT OF SCOPE)
- None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DATA-02 | System computes advanced stats after final box scores: possessions, pace, off/def/net rating, eFG%, TS% | Formula research below; all columns exist in `advanced_team_game_stats` schema |
| DATA-03 | System computes rolling windows (last 5 / last 10) for teams and players | Window strategy and SQL patterns documented below; `rolling_team_stats` and `rolling_player_stats` tables already defined |
</phase_requirements>

---

## Summary

Phase 5 builds a pure computation layer: reads box scores, computes advanced stats using well-established basketball formulas (Dean Oliver's Four Factors), and writes results to four pre-defined tables. The schema is already in the database. The scripts pattern is established by `scripts/backfill.ts`. No new npm packages are required — this phase is TypeScript + SQL only.

The main complexity is formula correctness, not infrastructure. Dean Oliver's possession estimate and the derived pace/rating formulas have known algebraic forms that can be implemented in a single pass over the box score data. Rolling windows are a straightforward ordered-window aggregation: for each team/player, fetch their last N games chronologically and average the advanced stat columns.

The seed script is a one-time fixture that inserts real box score rows from Basketball-Reference into `game_team_box_scores` and `game_player_box_scores`. The seed data doubles as the validation fixture.

**Primary recommendation:** Implement `scripts/compute-stats.ts` following the `backfill.ts` invocation pattern; implement formulas as pure TypeScript functions over box score row objects before writing to DB; use `ON CONFLICT DO UPDATE` upserts matching the existing pattern.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `postgres` (sql tag) | ^3.4.8 (already installed) | DB queries | Project-established; used in all scripts |
| `tsx` | ^4.21.0 (already installed) | Run TypeScript scripts | Project-established; used for `npm run backfill` |
| TypeScript | ^5.9.3 (already installed) | Type-safe formula logic | Project-established |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None new required | — | — | All dependencies already present |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-process TypeScript formulas | SQL-side computation (window functions) | SQL approach has no intermediate type safety; TypeScript approach is more testable and readable |
| Full recompute per run | Incremental checkpoint via `app_kv` | Incremental adds complexity; full recompute is fast enough for 3 seasons of seeded data (2-3 games at Phase 5 time) |

**Installation:** No new packages needed.

---

## Architecture Patterns

### Recommended Project Structure
```
scripts/
├── compute-stats.ts         # Main entry: imports lib functions, runs pipeline
├── seed-test-games.ts       # One-time fixture: inserts hardcoded box score rows
├── lib/
│   ├── db.ts                # Existing — sql tag singleton
│   ├── upserts.ts           # Existing — upsert helpers (reference pattern)
│   ├── advanced-stats.ts    # NEW — formula functions (pure TS, no DB dependency)
│   └── rolling-windows.ts   # NEW — rolling window computation logic
└── verification.sql         # Existing — can extend with Phase 5 verification queries
```

### Pattern 1: Script Invocation (mirror backfill.ts)
**What:** Top-level `main()` that logs a header, runs steps sequentially, prints a summary, calls `sql.end()`.
**When to use:** All CLI scripts in this project follow this shape.
**Example:**
```typescript
// Source: scripts/backfill.ts (existing)
async function main(): Promise<void> {
  console.log('========================================');
  console.log('Clippers Command Center — Advanced Stats Compute');
  console.log('========================================\n');

  console.log('[1/4] Loading games with box scores...');
  // ... step logic ...

  await printSummary();
  await sql.end();
}

main().catch(err => {
  console.error('Compute-stats failed:', err);
  sql.end();
  process.exit(1);
});
```

### Pattern 2: Upsert with ON CONFLICT (mirror upserts.ts)
**What:** Every write to derived tables uses `ON CONFLICT (game_id, team_id) DO UPDATE SET ...`.
**When to use:** All writes in this project. The unique constraints are already defined in the schema.
**Example:**
```typescript
// Source: scripts/lib/upserts.ts pattern, adapted for advanced_team_game_stats
await sql`
  INSERT INTO advanced_team_game_stats (
    game_id, team_id,
    possessions, pace, off_rating, def_rating, net_rating,
    efg_pct, ts_pct, tov_pct, reb_pct
  ) VALUES (
    ${gameId}::bigint, ${teamId}::bigint,
    ${possessions}, ${pace}, ${offRating}, ${defRating}, ${netRating},
    ${efgPct}, ${tsPct}, ${tovPct}, ${rebPct}
  )
  ON CONFLICT (game_id, team_id) DO UPDATE SET
    possessions = EXCLUDED.possessions,
    pace        = EXCLUDED.pace,
    off_rating  = EXCLUDED.off_rating,
    def_rating  = EXCLUDED.def_rating,
    net_rating  = EXCLUDED.net_rating,
    efg_pct     = EXCLUDED.efg_pct,
    ts_pct      = EXCLUDED.ts_pct,
    tov_pct     = EXCLUDED.tov_pct,
    reb_pct     = EXCLUDED.reb_pct
`;
```

### Pattern 3: bigint/text cast (project-established workaround)
**What:** Fetch bigint PKs as `::text`, cast back to `::bigint` when binding. Avoids postgres.js SerializableParameter type gap.
**When to use:** Every query joining on bigint FKs.
**Example:**
```typescript
// Source: scripts/lib/upserts.ts (Phase 04-02 decision)
const [row] = await sql<{ game_id: string }[]>`
  SELECT game_id::text FROM games WHERE nba_game_id = ${nbaGameId}
`;
// Then use: ${row.game_id}::bigint in subsequent queries
```

### Pattern 4: Pure formula functions
**What:** Implement all math as pure TypeScript functions that accept box score numbers and return derived stats. No SQL inside formula functions.
**When to use:** Keeps formulas testable in isolation; easy to verify against Basketball-Reference by hand.
**Example:**
```typescript
// Source: Dean Oliver "Basketball on Paper" (2004); widely reproduced
// Confidence: HIGH — these are the canonical NBA analytics formulas

export function computePossessions(
  fga: number, fta: number, oreb: number, tov: number
): number {
  // Dean Oliver's simplified possession estimate (team-level)
  return fga + 0.44 * fta - oreb + tov;
}

export function computePace(
  teamPoss: number, oppPoss: number, minutes: number
): number {
  // Possessions per 48 minutes (regulation = 240 player minutes = 48 team minutes)
  const avgPoss = (teamPoss + oppPoss) / 2;
  return (avgPoss / minutes) * 48;
}

export function computeOffRating(points: number, possessions: number): number {
  // Points per 100 possessions
  return (points / possessions) * 100;
}

export function computeEfgPct(fgm: number, fg3m: number, fga: number): number {
  if (fga === 0) return 0;
  return (fgm + 0.5 * fg3m) / fga;
}

export function computeTsPct(
  points: number, fga: number, fta: number
): number {
  // True Shooting %: accounts for 3s and FTs
  const tsa = fga + 0.44 * fta;
  if (tsa === 0) return 0;
  return points / (2 * tsa);
}

export function computeTovPct(tov: number, fga: number, fta: number): number {
  // Turnover rate (per 100 plays)
  const denom = fga + 0.44 * fta + tov;
  if (denom === 0) return 0;
  return tov / denom;
}

export function computeRebPct(
  teamOreb: number, teamDreb: number,
  oppOreb: number, oppDreb: number
): number {
  // Team rebounding percentage
  const totalAvailable = teamOreb + teamDreb + oppOreb + oppDreb;
  if (totalAvailable === 0) return 0;
  return (teamOreb + teamDreb) / totalAvailable;
}
```

### Pattern 5: Rolling window computation
**What:** For each team (or player), fetch their game-level advanced stats ordered by game_date, then compute a sliding average over the last N rows.
**When to use:** Rolling team stats and rolling player stats.
**Example:**
```typescript
// Fetch team's game-level advanced stats ordered by date for one season
const rows = await sql<TeamAdvancedRow[]>`
  SELECT
    atgs.game_id, atgs.off_rating, atgs.def_rating, atgs.net_rating,
    atgs.pace, atgs.efg_pct, atgs.ts_pct, atgs.tov_pct, atgs.reb_pct,
    g.game_date,
    CASE WHEN g.home_team_id = ${teamId}::bigint
         THEN g.home_score > g.away_score
         ELSE g.away_score > g.home_score
    END AS is_win
  FROM advanced_team_game_stats atgs
  JOIN games g ON g.game_id = atgs.game_id
  WHERE atgs.team_id = ${teamId}::bigint
    AND g.season_id = ${seasonId}
    AND g.status = 'Final'
  ORDER BY g.game_date ASC
`;

// Slide windows of size 5 and 10
for (let i = 0; i < rows.length; i++) {
  for (const window of [5, 10]) {
    if (i + 1 < window) continue; // not enough games yet
    const slice = rows.slice(i + 1 - window, i + 1);
    const asOfDate = rows[i].game_date;
    const avg = computeWindowAvg(slice);
    // upsert into rolling_team_stats
  }
}
```

### Anti-Patterns to Avoid
- **Querying games table with status != 'Final' for advanced stats:** Advanced stats require complete box scores. Filter strictly to `status = 'Final'` (or check that box score rows exist) before computing.
- **Dividing without null/zero guard:** Many denominators can be 0 (e.g., FGA = 0 for a player who DNP). All formula functions must guard `if (denom === 0) return 0` or `return null`.
- **Mixing bigint and string IDs without explicit cast:** The project-established pattern is `::text` on fetch, `::bigint` on bind. Skip the cast and postgres.js will throw a SerializableParameter error at runtime.
- **Computing rolling windows before advanced stats:** Rolling windows depend on `advanced_team_game_stats` rows. The compute sequence must be: (1) team advanced stats, (2) player advanced stats, (3) team rolling windows, (4) player rolling windows.
- **Inserting seed data inside compute-stats.ts:** The seed script is separate. `compute-stats.ts` only reads box scores; it does not create them.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Advanced stat formulas | Custom derivations without reference | Dean Oliver's Four Factors (documented below) | Dean Oliver's formulas are the industry standard; Basketball-Reference uses them; hand-rolled variants will diverge from reference values and fail validation |
| Upsert conflict handling | INSERT + UPDATE logic | `ON CONFLICT DO UPDATE` (already in `upserts.ts`) | Project pattern; handles idempotency correctly |
| Bigint FK binding | String interpolation in SQL | `::bigint` cast in sql template tag | postgres.js will reject uncast bigint strings |
| Minutes parsing from "MM:SS" | Ad-hoc string split | Reuse or standardize: `parseMinutes("34:21") => 34.35` | Player minutes are stored as TEXT ("34:21") in `game_player_box_scores`; need consistent decimal conversion for player formula denominators |

**Key insight:** The formulas are not novel — they are published, validated, and used by every NBA analytics site. Implement them exactly as defined by Dean Oliver / Basketball-Reference; don't approximate.

---

## Common Pitfalls

### Pitfall 1: Minutes Column is TEXT in game_player_box_scores
**What goes wrong:** Player box score `minutes` column is `TEXT` (schema comment: "keep provider format e.g. '34:12'"). Arithmetic on it will fail or give wrong results.
**Why it happens:** The schema intentionally preserves the provider string format.
**How to avoid:** Write a `parseMinutes(s: string | null): number` helper that splits on ":" and returns decimal minutes (`34 + 21/60`). Use this in all player formulas. Return 0 for null/missing.
**Warning signs:** `NaN` in computed player stats; TypeScript will not catch this — test with a known seed value.

### Pitfall 2: Opponent Box Score Required for Team Ratings
**What goes wrong:** Off/def rating and pace require BOTH teams' box score in the same game. If only one team's row is in `game_team_box_scores`, the formula will fail or silently produce wrong numbers.
**Why it happens:** The compute script must fetch both team rows per game, not just one.
**How to avoid:** Always fetch both box score rows for a game (home and away) together before computing either team's stats. Assert both rows exist before writing either team's advanced stats.

### Pitfall 3: Possession Estimate Asymmetry
**What goes wrong:** Dean Oliver's formula can give slightly different possession counts for home vs. away (because OREB depends on both sides). This is expected and normal; don't try to equalize them.
**Why it happens:** The formula accounts for OREB opportunity asymmetry.
**How to avoid:** Accept slight asymmetry (~1-2 possessions difference between teams in same game). Use the team's own OREB in their formula.

### Pitfall 4: Rolling Window Boundary — "as_of_game_date"
**What goes wrong:** `rolling_team_stats` has a `UNIQUE (team_id, season_id, window_games, as_of_game_date)` constraint. If two games are on the same date (doubleheader would be unusual for a single team, but edge case), the second upsert will overwrite the first.
**Why it happens:** The unique key uses date not game_id.
**How to avoid:** For Phase 5, seeded games are 2-3 distinct dates, so this won't trigger. Document the constraint; Phase 7 full-scale will need to verify no same-date doubles for a given team.

### Pitfall 5: game status filter for box score completeness
**What goes wrong:** Games with status "Final" may still have empty box score tables if Phase 7 hasn't run yet (expected at Phase 5 time — only the 2-3 seeded games have box scores).
**Why it happens:** Status comes from BDL backfill; box scores come from a separate source (NBA live JSON, Phase 7) or seed script.
**How to avoid:** In `compute-stats.ts`, filter games by whether a `game_team_box_scores` row EXISTS for that game, not purely by `status = 'Final'`. This is safer and will still work post-Phase 7.

### Pitfall 6: Player Usage Rate Requires Team Minutes Context
**What goes wrong:** Usage rate formula `(FGA + 0.44*FTA + TOV) / (TEAM_FGA + 0.44*TEAM_FTA + TEAM_TOV) * 5` requires team-level totals for the same game. If querying player rows in isolation, team totals are unavailable.
**Why it happens:** The formula is a ratio of player contribution to team opportunities.
**How to avoid:** For each game, fetch all player rows AND the team box score row together. Compute team context first, then player usage.

---

## Code Examples

Verified patterns from the existing codebase and Dean Oliver's canonical formulas:

### Dean Oliver's Possession Estimate (Team-Level)
```typescript
// Source: Dean Oliver "Basketball on Paper" (2004); implemented identically on Basketball-Reference
// Confidence: HIGH — widely used industry standard

// Team-level: uses team totals from game_team_box_scores
export function computeTeamPossessions(bs: {
  fg_attempted: number;
  ft_attempted: number;
  offensive_reb: number;
  turnovers: number;
}): number {
  return bs.fg_attempted
    + 0.44 * bs.ft_attempted
    - bs.offensive_reb
    + bs.turnovers;
}
```

### Player Usage Rate
```typescript
// Source: Basketball-Reference glossary (https://www.basketball-reference.com/about/glossary.html)
// Confidence: HIGH

// Usage Rate = 100 * ((FGA + 0.44 * FTA + TOV) * (Tm MP / 5))
//              / (MP * (Tm FGA + 0.44 * Tm FTA + Tm TOV))
export function computeUsageRate(p: {
  fg_attempted: number;
  ft_attempted: number;
  turnovers: number;
  minutesDecimal: number;    // player minutes as decimal
}, team: {
  fg_attempted: number;
  ft_attempted: number;
  turnovers: number;
  minutesDecimal: number;    // team total minutes (240 for regulation)
}): number {
  const playerPart = p.fg_attempted + 0.44 * p.ft_attempted + p.turnovers;
  const teamPart = team.fg_attempted + 0.44 * team.ft_attempted + team.turnovers;
  if (teamPart === 0 || p.minutesDecimal === 0) return 0;
  return 100 * (playerPart * (team.minutesDecimal / 5)) / (p.minutesDecimal * teamPart);
}
```

### Fetching Games with Box Scores (SQL pattern for compute-stats)
```typescript
// Fetch all games that have both team box score rows (i.e., complete data)
const gamesWithBoxScores = await sql<{ game_id: string; season_id: number }[]>`
  SELECT DISTINCT g.game_id::text, g.season_id
  FROM games g
  WHERE EXISTS (
    SELECT 1 FROM game_team_box_scores b
    WHERE b.game_id = g.game_id
  )
  ORDER BY g.game_date ASC
`;
```

### Fetch Both Team Box Scores for a Game
```typescript
const boxes = await sql<TeamBoxRow[]>`
  SELECT
    b.team_id::text,
    b.is_home,
    b.points, b.fg_made, b.fg_attempted,
    b.fg3_made, b.fg3_attempted,
    b.ft_made, b.ft_attempted,
    b.offensive_reb, b.defensive_reb,
    b.turnovers, b.assists, b.rebounds
  FROM game_team_box_scores b
  WHERE b.game_id = ${gameId}::bigint
`;
// Expect exactly 2 rows (home + away). Skip game if not exactly 2.
if (boxes.length !== 2) {
  console.warn(`  Skipping game ${gameId}: expected 2 team box scores, got ${boxes.length}`);
  continue;
}
```

### Minutes Parsing Helper
```typescript
// game_player_box_scores.minutes is TEXT ("34:21" or null)
export function parseMinutes(s: string | null | undefined): number {
  if (!s) return 0;
  const [min, sec] = s.split(':').map(Number);
  if (isNaN(min)) return 0;
  return min + (isNaN(sec) ? 0 : sec / 60);
}
```

### npm run script registration
```json
// In package.json (pattern from existing "backfill" script)
{
  "scripts": {
    "compute-stats": "node --env-file=.env.local node_modules/.bin/tsx scripts/compute-stats.ts"
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Pythagorean expectation for rating proxy | Dean Oliver's Four Factors (possessions-based) | ~2004 (Oliver's book) | More accurate per-game ratings; used by all major NBA analytics sites |
| Box score stats only | Advanced stats (eFG%, TS%, pace, ratings) | Industry standard since ~2010 | These are what Phase 6 Insight Engine queries |

**Deprecated/outdated:**
- Simple FG% as shooting efficiency metric: replaced by eFG% (3PT weighted) and TS% (FT included)
- Points-based pace estimation: replaced by possession-based pace (Dean Oliver)

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None installed (no jest/vitest config found in project) |
| Config file | None — Wave 0 must install a test runner |
| Quick run command | `npx tsx scripts/compute-stats.ts --dry-run` (if dry-run flag added) |
| Full suite command | Manual: inspect DB counts + Basketball-Reference eFG% comparison |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DATA-02 | Advanced stats populated for seeded games | manual-only (DB query) | `psql $DATABASE_URL -c "SELECT game_id, team_id, efg_pct, ts_pct, pace, off_rating, def_rating FROM advanced_team_game_stats"` | ❌ Wave 0 (seed + compute must run first) |
| DATA-02 | eFG% within 1% of Basketball-Reference value | manual-only | Developer lookup on basketball-reference.com, compare to DB value | N/A |
| DATA-03 | Rolling windows populated for seeded games | manual-only (DB query) | `psql $DATABASE_URL -c "SELECT team_id, window_games, as_of_game_date, off_rating FROM rolling_team_stats"` | ❌ Wave 0 |

**Note on manual-only:** Validation is explicitly manual per CONTEXT.md. The developer runs `compute-stats`, then queries the DB and cross-checks eFG% against Basketball-Reference. Automated assertion tests are not required for this phase.

### Sampling Rate
- **Per task commit:** Run `npm run compute-stats` and inspect console output for zero errors
- **Per wave merge:** Execute verification SQL against DB, confirm row counts in all four derived tables
- **Phase gate:** All four derived tables populated; eFG% for at least one seeded game within 1% of Basketball-Reference

### Wave 0 Gaps
- [ ] `scripts/seed-test-games.ts` — must exist with 2-3 hardcoded Clippers game box scores before `compute-stats` can produce output
- [ ] `scripts/verification-phase5.sql` — optional but recommended: SQL queries to inspect derived table counts and spot-check eFG%
- [ ] No test framework to install — validation is manual per phase decisions

---

## Basketball Reference: Seed Game Selection Guide

When selecting 2-3 Clippers games to hardcode:

**Criteria (per CONTEXT.md):**
- Real historical regular season games (not OT, not postponed)
- Final status with clean box scores on Basketball-Reference
- Recent seasons (2022-24 range already in the `seasons` table)

**Where to get data:** https://www.basketball-reference.com/teams/LAC/ — click a season, pick a game with "W" or "L" result, use the box score page.

**What to hardcode in seed-test-games.ts:**
- The `nba_game_id` (from the `games` table after backfill)
- Both teams' box score totals: FGM, FGA, FG3M, FG3A, FTM, FTA, OREB, DREB, TOV, PTS
- Player rows for all players in the box score (at minimum: FGM, FGA, FG3M, FG3A, FTM, FTA, OREB, DREB, TOV, PTS, MIN)

**Validation fixture:** After running compute-stats, the eFG% value in `advanced_team_game_stats` should match Basketball-Reference's listed eFG% for that team in that game within ±0.01.

---

## Open Questions

1. **Minutes column for team box scores**
   - What we know: `game_team_box_scores.minutes` is `SMALLINT`, nullable. BDL-seeded data likely has null (since box scores weren't populated in Phase 4 backfill).
   - What's unclear: Should team minutes default to 240 (regulation) for purposes of pace calculation? Or should pace be computed from the players' total minutes?
   - Recommendation: Default team minutes to 240 for regulation games. This is the standard assumption for pace calculation when team minutes are not explicitly tracked. Flag if a seeded game is OT (avoid OT games in seed selection per CONTEXT.md).

2. **REBoundPct team vs. available rebounds**
   - What we know: REB% is `(team reb) / (available reb)`. "Available" = team_oreb + opp_dreb + team_dreb + opp_oreb.
   - What's unclear: Whether the schema `defensive_reb` + `offensive_reb` captures all rebounds or just player-credited rebounds (team rebounds excluded).
   - Recommendation: Sum `offensive_reb + defensive_reb` from both team box score rows. This is sufficient for Phase 5 validation purposes.

3. **Player AST rate denominator**
   - What we know: AST rate = `AST / (((MP / (Tm MP / 5)) * Tm FG) - FG)` — this requires knowing team FGM excluding player's own FGM.
   - What's unclear: Whether the seed script will have enough team/player data to compute this accurately.
   - Recommendation: Implement AST rate in `advanced_player_game_stats` but treat it as best-effort for Phase 5. The validation gate only requires eFG% accuracy; other player stats are secondary.

---

## Sources

### Primary (HIGH confidence)
- Basketball-Reference Glossary — https://www.basketball-reference.com/about/glossary.html — eFG%, TS%, Usage Rate, Off/Def Rating formulas
- Dean Oliver "Basketball on Paper" (2004) — canonical possession estimate and Four Factors framework
- `Docs/DB_SCHEMA.sql` (project file, read directly) — confirmed table columns, UNIQUE constraints, REAL types for all derived stats
- `scripts/lib/upserts.ts` (project file, read directly) — established upsert pattern, bigint cast workaround
- `scripts/backfill.ts` (project file, read directly) — invocation pattern, progress logging style
- `package.json` (project file, read directly) — confirmed tsx invocation pattern for npm scripts

### Secondary (MEDIUM confidence)
- NBA.com/stats Advanced Stats documentation — corroborates Dean Oliver formula variants for official NBA metrics

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all tools already in project
- Formula correctness: HIGH — Dean Oliver's formulas are canonical, confirmed by Basketball-Reference glossary
- Architecture: HIGH — mirrors established `backfill.ts` pattern exactly
- Pitfalls: HIGH — bigint/text cast and minutes-as-text are confirmed project patterns; others are standard basketball analytics edge cases

**Research date:** 2026-03-06
**Valid until:** 2026-06-06 (stable domain — formulas don't change; postgres patterns don't change)
