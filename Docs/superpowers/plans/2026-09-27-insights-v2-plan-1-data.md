# Insights v2 — Plan 1: Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the insights engine the history it needs: league-wide box scores back to 1996-97 (slim), play-by-play–derived tables for every Clippers game, and a nightly record book of game highs and streaks.

**Architecture:** Reuse the existing ingest path (`sync-league-games` → `ingestBoxscore` → `finalizeGame`), which already reads pre-2019 seasons from stats.nba.com and writes slim player rows (commits `c1e0fac`, `9d0f326`); keep old seasons' derived stats to Clippers players. Add a `scripts/lib/pbp/` module (normalize both play-by-play formats → derive game flow / period / clutch stats → write) and a `scripts/lib/record-book/` module (SQL-built game highs, TS-computed streaks, `records_start`). A local orchestrator (`backfill-history`) walks seasons newest-first with a storage checkpoint.

**Tech Stack:** TypeScript (tsx scripts, ESM), postgres.js, Vitest, GitHub Actions, Neon Postgres.

**Spec:** `Docs/superpowers/specs/2026-09-27-insights-engine-design.md` (§1 Data layer, §5.1 Scheduling, §6 phase 1). Plan 1 of 6 — see "Plan series" at the end.

## Global Constraints

- Git tracks documentation under `Docs/` (capital D). Always use `Docs/...` paths in code, workflows and commits (macOS hides the difference; Linux CI does not).
- Script imports use ESM `.js` suffixes (`import { sql } from './lib/db.js'`), matching every existing script.
- New npm scripts follow the existing pattern: `node --env-file-if-exists=.env.local node_modules/.bin/tsx scripts/<name>.ts`.
- Modules imported by unit tests must not import `scripts/lib/db.ts` (it calls `process.exit` without `DATABASE_URL`). Keep pure logic in DB-free files.
- **Neon's free tier caps the database at 0.5 GB.** Player box scores never store `raw_payload` (commit `9d0f326`). Before 2019-20 (`FULL_ROLLING_FIRST_SEASON` in `scripts/compute-stats.ts`), advanced player stats and player rolling windows are computed for Clippers players only.
- History begins no earlier than 1996-97 (`HISTORY_OLDEST_SEASON = 1996`). The backfill pauses at 2010-11 by default for a storage check; going further back needs Luke's go-ahead after the size check.
- Another session is working on this branch (Live v2 spec, `Docs/superpowers/specs/2026-09-27-live-v2-realtime-design.md`, which reuses this plan's `pbp_events` and parser). Pull/rebase before each task and keep the `pbp_events` columns exactly as defined in Task 1.
- Record book and streaks are **regular season only** (`REGULAR_SEASON` predicate), matching NBA record-keeping.
- Clutch = period ≥ 4, ≤ 5:00 left in the period, margin ≤ 5 **before** the event.
- No new npm dependencies in this plan.
- Integration tests need a local Postgres: `docker run -d --name ccc-fixture-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16` then `createdb -h 127.0.0.1 -U postgres fixture` (password `postgres`). Run with `FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/fixture npx vitest run scripts/lib/pipeline.integration.test.ts`. CI runs them too.
- **Production writes need Luke's explicit go-ahead in chat** (migration, backfills). Everything else in this plan runs against the fixture DB.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on branch `insights/espn-engine`.

## File Structure

| File | Responsibility |
|---|---|
| `Docs/DB_SCHEMA.sql` (modify) | Canonical schema: add play-by-play and record-book tables |
| `Docs/migrations/2026-10-insights-v2-data.sql` (create) | Same DDL for the production DB |
| `.github/workflows/db-migrate.yml` (modify) | Apply any migration file by name |
| `scripts/compute-stats.ts` (modify) | Clippers-only advanced player stats before 2019-20 |
| `scripts/lib/stats-nba.ts` (modify) | Historical tricode aliases; `fetchStatsPlayByPlay` |
| `scripts/lib/pbp/types.ts` | Raw + normalized play-by-play types |
| `scripts/lib/pbp/normalize.ts` | CDN / stats v3 → `NormalizedPbp` |
| `scripts/lib/pbp/derive.ts` | Game flow, period lines, clutch lines (pure) |
| `scripts/lib/pbp/ingest.ts` | Fetch → normalize → derive → write one game; prune raw events |
| `scripts/ingest-pbp.ts` | CLI over `ingestGamePbp` |
| `scripts/game-night.ts` (modify) | Ingest play-by-play right after finalization |
| `scripts/lib/sql-fragments.ts` | DB-free SQL fragments (`REGULAR_SEASON`) |
| `scripts/lib/record-book/highs.ts` | Game-high specs + SQL builder |
| `scripts/lib/record-book/streaks.ts` | Streak computation (pure) |
| `scripts/lib/record-book/records-start.ts` | `resolveRecordsStart` (pure) |
| `scripts/build-record-book.ts` | Nightly rebuild of `rb_game_highs`, `rb_streaks`, `records_start` |
| `scripts/lib/backfill-plan.ts` | `planHistorySeasons` (pure) |
| `scripts/backfill-history.ts` | Local orchestrator for the one-time backfill |
| `scripts/dev/capture-pbp-fixture.ts` | Saves real play-by-play samples for tests |
| `.github/workflows/post-game.yml` (modify) | Nightly `ingest-pbp` + `build-record-book` |
| `Docs/DATA_DICTIONARY.md` (modify) | Document the new tables |

---

### Task 1: Schema for play-by-play and the record book

**Files:**
- Modify: `Docs/DB_SCHEMA.sql` (insert before the final `COMMIT;`)
- Create: `Docs/migrations/2026-10-insights-v2-data.sql`
- Modify: `.github/workflows/db-migrate.yml`
- Test: `scripts/lib/pipeline.integration.test.ts`

**Interfaces:**
- Produces tables `game_flow`, `period_team_stats`, `period_player_stats`, `clutch_stats`, `pbp_events`, `rb_game_highs`, `rb_streaks` exactly as below. Later tasks write/read these column names.

- [ ] **Step 1: Write the failing test**

Add inside the `describe.skipIf(!url)(...)` block of `scripts/lib/pipeline.integration.test.ts`, right after the `afterAll`:

```ts
  it('schema has the play-by-play and record-book tables', async () => {
    const tables = ['game_flow', 'period_team_stats', 'period_player_stats', 'clutch_stats', 'pbp_events', 'rb_game_highs', 'rb_streaks'];
    const rows = await sql<{ name: string; exists: boolean }[]>`
      SELECT t AS name, to_regclass('public.' || t) IS NOT NULL AS exists
      FROM unnest(${tables}::text[]) AS t
    `;
    expect(rows.filter((r) => !r.exists).map((r) => r.name)).toEqual([]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/fixture npx vitest run scripts/lib/pipeline.integration.test.ts -t "schema has"`
Expected: FAIL — the list contains all seven table names.

- [ ] **Step 3: Add the DDL**

Insert this block into `Docs/DB_SCHEMA.sql` immediately before the last line `COMMIT;`:

```sql
-- =============================================================================
-- Play-by-play derived tables (Clippers games) — scripts/lib/pbp/
-- =============================================================================

CREATE TABLE IF NOT EXISTS game_flow (
  game_id             BIGINT PRIMARY KEY REFERENCES games(game_id) ON DELETE CASCADE,
  lac_largest_lead    SMALLINT NOT NULL,
  lac_largest_deficit SMALLINT NOT NULL,          -- positive number of points
  lead_changes        SMALLINT NOT NULL,
  times_tied          SMALLINT NOT NULL,
  lac_best_run        SMALLINT NOT NULL,          -- most unanswered points
  opp_best_run        SMALLINT NOT NULL,
  comeback_margin     SMALLINT,                   -- lac_largest_deficit when LAC won, else NULL
  margin_series       JSONB NOT NULL,             -- [[elapsed_sec, lac_margin], ...]
  source              TEXT NOT NULL,              -- 'cdn' | 'stats_pbp'
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS period_team_stats (
  game_id  BIGINT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  team_id  BIGINT NOT NULL REFERENCES teams(team_id),
  period   SMALLINT NOT NULL,
  pts      SMALLINT NOT NULL,
  fgm      SMALLINT NOT NULL,
  fga      SMALLINT NOT NULL,
  fg3m     SMALLINT NOT NULL,
  fg3a     SMALLINT NOT NULL,
  ftm      SMALLINT NOT NULL,
  fta      SMALLINT NOT NULL,
  reb      SMALLINT NOT NULL,
  ast      SMALLINT,                               -- NULL when the source has no assist credits
  tov      SMALLINT NOT NULL,
  PRIMARY KEY (game_id, team_id, period)
);

CREATE TABLE IF NOT EXISTS period_player_stats (
  game_id   BIGINT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id BIGINT NOT NULL REFERENCES players(player_id),
  team_id   BIGINT NOT NULL REFERENCES teams(team_id),
  period    SMALLINT NOT NULL,
  pts       SMALLINT NOT NULL,
  reb       SMALLINT NOT NULL,
  ast       SMALLINT,                              -- NULL: source lacks assist/steal/block credits
  fg3m      SMALLINT NOT NULL,
  fgm       SMALLINT NOT NULL,
  fga       SMALLINT NOT NULL,
  stl       SMALLINT,
  blk       SMALLINT,
  PRIMARY KEY (game_id, player_id, period)
);
CREATE INDEX IF NOT EXISTS idx_period_player_player ON period_player_stats (player_id);

-- Clutch = last 5:00 of the 4th/OT with the margin <= 5 before the event.
CREATE TABLE IF NOT EXISTS clutch_stats (
  game_id   BIGINT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  team_id   BIGINT NOT NULL REFERENCES teams(team_id),
  player_id BIGINT REFERENCES players(player_id),  -- NULL = team row
  pts       SMALLINT NOT NULL,
  fgm       SMALLINT NOT NULL,
  fga       SMALLINT NOT NULL,
  fg3m      SMALLINT NOT NULL,
  ftm       SMALLINT NOT NULL,
  fta       SMALLINT NOT NULL,
  tov       SMALLINT NOT NULL,
  CONSTRAINT uq_clutch_stats UNIQUE NULLS NOT DISTINCT (game_id, team_id, player_id)
);

-- Raw normalized events: current season (live receipts, replay) + games flagged keep.
CREATE TABLE IF NOT EXISTS pbp_events (
  game_id      BIGINT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  event_num    INTEGER NOT NULL,                  -- 1-based order within the game
  period       SMALLINT NOT NULL,
  clock_sec    SMALLINT NOT NULL,                 -- seconds left in the period
  elapsed_sec  INTEGER NOT NULL,                  -- seconds since tip
  team_id      BIGINT REFERENCES teams(team_id),
  player_id    BIGINT REFERENCES players(player_id),
  kind         TEXT NOT NULL,                     -- fg | ft | rebound | turnover | steal | block | other
  made         BOOLEAN,
  shot_value   SMALLINT,
  points       SMALLINT NOT NULL,                 -- score change on this event
  score_home   SMALLINT NOT NULL,
  score_away   SMALLINT NOT NULL,
  description  TEXT,
  keep         BOOLEAN NOT NULL DEFAULT FALSE,    -- survives season-rollover pruning
  PRIMARY KEY (game_id, event_num)
);

-- =============================================================================
-- Record book (rebuilt nightly by scripts/build-record-book.ts)
-- =============================================================================

CREATE TABLE IF NOT EXISTS rb_game_highs (
  scope      TEXT NOT NULL,       -- lac_team | lac_player | player_career | player_season | league_season
  scope_id   TEXT NOT NULL,       -- '' | player_id | season_id | player_id:season_id
  stat_key   TEXT NOT NULL,       -- pts, reb, ast, fg3m, stl, blk, team_pts, margin, opp_pts_low, q_pts, ...
  rank       SMALLINT NOT NULL,
  value      NUMERIC NOT NULL,
  game_id    BIGINT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  game_date  DATE NOT NULL,
  player_id  BIGINT REFERENCES players(player_id),
  team_id    BIGINT REFERENCES teams(team_id),
  PRIMARY KEY (scope, scope_id, stat_key, rank)
);

CREATE TABLE IF NOT EXISTS rb_streaks (
  entity_type   TEXT NOT NULL,    -- 'player' | 'team'
  entity_id     BIGINT NOT NULL,
  streak_key    TEXT NOT NULL,    -- scoring_20, scoring_30, rebounding_10, threes_3, hot_shooting, double_double, wins, losses
  length        SMALLINT NOT NULL,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  start_game_id BIGINT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  end_game_id   BIGINT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  is_active     BOOLEAN NOT NULL,
  team_id       BIGINT REFERENCES teams(team_id),  -- team during the streak (streaks break on team change)
  PRIMARY KEY (entity_type, entity_id, streak_key, start_game_id)
);
CREATE INDEX IF NOT EXISTS idx_rb_streaks_lookup ON rb_streaks (streak_key, team_id, length DESC);
```

- [ ] **Step 4: Create the migration file**

Create `Docs/migrations/2026-10-insights-v2-data.sql` containing:

```sql
-- Docs/migrations/2026-10-insights-v2-data.sql
-- Insights v2, plan 1: play-by-play derived tables and the record book.
-- Idempotent (IF NOT EXISTS); one transaction. Apply with the "DB Migrate"
-- workflow (file = 2026-10-insights-v2-data.sql).
BEGIN;
```

followed by the exact DDL block from Step 3 (from `CREATE TABLE IF NOT EXISTS game_flow` through `CREATE INDEX IF NOT EXISTS idx_rb_streaks_lookup ...;`), then a final line `COMMIT;`.

- [ ] **Step 5: Generalize the migrate workflow**

Replace `.github/workflows/db-migrate.yml` with:

```yaml
name: DB Migrate (manual)

# Applies one migration file from Docs/migrations/ to the production database.
# Migrations are idempotent and run in one transaction, so a re-run is safe.

on:
  workflow_dispatch:
    inputs:
      file:
        description: 'Migration file name in Docs/migrations/ (e.g. 2026-10-insights-v2-data.sql)'
        required: true
      confirm:
        description: 'Type "migrate" to apply it to production'
        required: true

permissions:
  contents: read

concurrency:
  group: db-write
  cancel-in-progress: false

jobs:
  migrate:
    if: inputs.confirm == 'migrate'
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - uses: actions/checkout@v5

      - name: Validate file
        run: |
          [[ "$FILE" =~ ^[A-Za-z0-9._-]+\.sql$ ]] || { echo "Invalid file name: $FILE"; exit 1; }
          test -f "Docs/migrations/$FILE" || { echo "Not found: Docs/migrations/$FILE"; exit 1; }
        env:
          FILE: ${{ inputs.file }}

      - name: Apply migration
        run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "Docs/migrations/$FILE"
        env:
          FILE: ${{ inputs.file }}
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/fixture npx vitest run scripts/lib/pipeline.integration.test.ts -t "schema has"`
Expected: PASS. Also run `psql postgres://postgres:postgres@127.0.0.1:5432/fixture -v ON_ERROR_STOP=1 -f Docs/migrations/2026-10-insights-v2-data.sql` twice; both succeed (idempotent).

- [ ] **Step 7: Commit**

```bash
git add Docs/DB_SCHEMA.sql Docs/migrations/2026-10-insights-v2-data.sql .github/workflows/db-migrate.yml scripts/lib/pipeline.integration.test.ts
git commit -m "feat(db): play-by-play and record-book tables; generic migrate workflow

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Leaner derived stats for pre-2019 seasons; historical tricodes

Already on this branch (commits `c1e0fac`, `9d0f326` — do not redo): `sync-league-games` loads pre-2019 seasons from stats.nba.com; player box scores never store `raw_payload`; before `FULL_ROLLING_FIRST_SEASON` (2019, in `scripts/compute-stats.ts`) player rolling windows are computed for Clippers players only. This task applies the same Clippers-only rule to **advanced player stats** (≈5 MB per season league-wide) and adds the franchise aliases older seasons need.

**Files:**
- Modify: `scripts/compute-stats.ts` (`computeGameStats`, its call site, the game selection)
- Modify: `scripts/lib/stats-nba.ts` (`TRICODE_ALIASES`), `scripts/lib/stats-nba.test.ts` (existing `normalizeTricode` describe)
- Test: `scripts/lib/pipeline.integration.test.ts`

**Interfaces:**
- Consumes: `FULL_ROLLING_FIRST_SEASON` (existing constant in `scripts/compute-stats.ts`).
- Produces: `normalizeTricode` maps `SEA→OKC`, `VAN→MEM`, `CHH→CHA` in addition to the existing aliases.

- [ ] **Step 1: Write the failing unit test**

In `scripts/lib/stats-nba.test.ts`, add to the existing `describe('normalizeTricode', …)` block:

```ts
  it('maps pre-2010 franchises to their current teams', () => {
    expect(normalizeTricode('SEA')).toBe('OKC');
    expect(normalizeTricode('VAN')).toBe('MEM');
    expect(normalizeTricode('CHH')).toBe('CHA');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run scripts/lib/stats-nba.test.ts`
Expected: FAIL — `SEA` comes back unchanged.

- [ ] **Step 3: Add the aliases**

In `scripts/lib/stats-nba.ts`, add three entries to `TRICODE_ALIASES` (keep the existing ones):

```ts
  SEA: 'OKC', // Seattle SuperSonics (through 2007-08)
  VAN: 'MEM', // Vancouver Grizzlies (through 2000-01)
  CHH: 'CHA', // Charlotte Hornets (1988-2002; history returned to Charlotte)
```

Run: `npx vitest run scripts/lib/stats-nba.test.ts` — expected: PASS.

- [ ] **Step 4: Write the failing integration test**

Add to `scripts/lib/pipeline.integration.test.ts`, after the `'ingests a league box score: …'` test:

```ts
  it('pre-2019 seasons: advanced player stats for Clippers players only', async () => {
    const { ingestBoxscore } = await import('./league-ingest');
    await sql`INSERT INTO seasons (season_id, label) VALUES (2015, '2015-16') ON CONFLICT DO NOTHING`;
    const box: NBABoxscoreResponse = {
      meta: { version: 1, code: 200, request: '', time: '' },
      game: {
        gameId: '0021500077', gameStatus: 3, gameStatusText: 'Final', period: 4, gameClock: '',
        gameTimeUTC: '2015-11-01T02:30:00Z',
        regulationPeriods: 4,
        homeTeam: team('DEN', [player(1_000_000 + 49, 'DEN Player 1', 18)]),
        awayTeam: team('LAC', [player(1_000_001, 'Star Clipper', 12), player(1_000_002, 'Big Clipper', 10)]),
      },
    };
    const gameId = await ingestBoxscore(2015, box);
    expect(run('scripts/compute-stats.ts')).toContain('for 1 game(s)');

    const [derived] = await sql<{ team_adv: number; lac_player_adv: number; other_player_adv: number }[]>`
      SELECT (SELECT COUNT(*)::int FROM advanced_team_game_stats WHERE game_id = ${gameId}::bigint) AS team_adv,
             (SELECT COUNT(*)::int FROM advanced_player_game_stats a JOIN teams t ON t.team_id = a.team_id
               WHERE a.game_id = ${gameId}::bigint AND t.abbreviation = 'LAC') AS lac_player_adv,
             (SELECT COUNT(*)::int FROM advanced_player_game_stats a JOIN teams t ON t.team_id = a.team_id
               WHERE a.game_id = ${gameId}::bigint AND t.abbreviation <> 'LAC') AS other_player_adv
    `;
    expect(derived).toEqual({ team_adv: 2, lac_player_adv: 2, other_player_adv: 0 });
  }, TIMEOUT);
```

- [ ] **Step 5: Run it to verify it fails**

Run: `FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/fixture npx vitest run scripts/lib/pipeline.integration.test.ts -t "pre-2019"`
Expected: FAIL — `other_player_adv` is 1.

- [ ] **Step 6: Implement**

In `scripts/compute-stats.ts`:

- change the game selection to also return the season:

```ts
  const games = await sql<{ game_id: string; season_id: number | null }[]>`
    SELECT g.game_id::text AS game_id, g.season_id
    FROM games g
    WHERE EXISTS (SELECT 1 FROM game_team_box_scores b WHERE b.game_id = g.game_id)
      ${all ? sql`` : sql`AND NOT EXISTS (SELECT 1 FROM advanced_team_game_stats a WHERE a.game_id = g.game_id)`}
    ORDER BY g.game_date, g.game_id
  `;
  const gameIds = games.map((g) => g.game_id);
```

- change the loop body to:

```ts
    const { game_id, season_id } = games[i];
    await computeGameStats(game_id, season_id !== null && season_id < FULL_ROLLING_FIRST_SEASON);
```

- change `async function computeGameStats(gameId: string): Promise<void> {` to

```ts
/**
 * @param clippersPlayersOnly before FULL_ROLLING_FIRST_SEASON, advanced player
 *   stats are kept for Clippers players only (the same rule as their rolling
 *   windows) — league-wide rows for old seasons cost storage nothing reads.
 */
async function computeGameStats(gameId: string, clippersPlayersOnly: boolean): Promise<void> {
```

- replace the `// Step 2: Player advanced stats` query with:

```ts
  // Step 2: Player advanced stats
  const playerRows = await sql<PlayerBoxRow[]>`
    SELECT
      p.player_id::text, p.team_id::text,
      p.minutes, p.points, p.rebounds, p.assists, p.turnovers,
      p.fg_made, p.fg_attempted, p.fg3_made, p.fg3_attempted,
      p.ft_made, p.ft_attempted,
      p.offensive_reb, p.defensive_reb
    FROM game_player_box_scores p
    WHERE p.game_id = ${gameId}::bigint
      ${clippersPlayersOnly ? sql`AND p.team_id IN (SELECT team_id FROM teams WHERE abbreviation = 'LAC')` : sql``}
  `;
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/fixture npx vitest run scripts/lib/pipeline.integration.test.ts && npx vitest run scripts/lib && npx tsc --noEmit`
Expected: PASS (fixture seasons 2024+ are unaffected).

- [ ] **Step 8: Commit**

```bash
git add scripts/compute-stats.ts scripts/lib/stats-nba.ts scripts/lib/stats-nba.test.ts scripts/lib/pipeline.integration.test.ts
git commit -m "feat(stats): Clippers-only advanced player stats before 2019-20; SEA/VAN/CHH aliases

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Play-by-play normalizer (CDN and stats.nba.com v3)

**Files:**
- Create: `scripts/lib/pbp/types.ts`, `scripts/lib/pbp/normalize.ts`, `scripts/lib/pbp/normalize.test.ts`
- Create: `scripts/dev/capture-pbp-fixture.ts`
- Modify: `scripts/lib/stats-nba.ts` (add `fetchStatsPlayByPlay`)

**Interfaces:**
- Produces (types.ts): `PbpKind`, `PbpSource = 'cdn' | 'stats_pbp'`, `RawAction`, `RawPlayByPlay`, `PbpEvent`, `NormalizedPbp` as defined below.
- Produces (normalize.ts): `clockSeconds(iso: string): number`, `elapsedSeconds(period: number, clockSec: number): number`, `normalizePbp(raw: RawPlayByPlay, source: PbpSource): NormalizedPbp`.
- Produces (stats-nba.ts): `fetchStatsPlayByPlay(gameId10: string, log: (msg: string) => void): Promise<RawPlayByPlay | null>`.

- [ ] **Step 1: Create the types**

Create `scripts/lib/pbp/types.ts`:

```ts
// scripts/lib/pbp/types.ts
// Play-by-play shapes. Raw* mirror the fields cdn.nba.com liveData and
// stats.nba.com playbyplayv3 share (both wrap actions in { game: { actions } });
// PbpEvent is the one normalized shape everything downstream uses.

export type PbpSource = 'cdn' | 'stats_pbp';
export type PbpKind = 'fg' | 'ft' | 'rebound' | 'turnover' | 'steal' | 'block' | 'other';

export interface RawAction {
  actionNumber: number;
  clock: string;                       // "PT04M32.00S" — time left in the period
  period: number;
  teamTricode?: string | null;
  personId?: number | null;
  actionType?: string | null;          // cdn: "2pt","3pt","freethrow","rebound",... v3: "Made Shot","Free Throw",...
  subType?: string | null;
  shotResult?: string | null;          // "Made" | "Missed"
  shotValue?: number | null;           // v3 only
  assistPersonId?: number | null;      // cdn only
  scoreHome?: string | number | null;  // v3 leaves it "" when unchanged
  scoreAway?: string | number | null;
  description?: string | null;
}

export interface RawPlayByPlay {
  game: { gameId: string; actions: RawAction[] };
}

export interface PbpEvent {
  seq: number;                         // 1-based order within the game
  period: number;
  clockSec: number;
  elapsedSec: number;
  teamTricode: string | null;
  personId: number | null;
  kind: PbpKind;
  made: boolean | null;                // fg / ft only
  shotValue: 1 | 2 | 3 | null;
  assistPersonId: number | null;
  points: number;                      // total score change on this event (negative after a correction)
  scoringSide: 'home' | 'away' | null;
  scoreHome: number;
  scoreAway: number;
  description: string;
}

export interface NormalizedPbp {
  source: PbpSource;
  /** Assists, steals and blocks carry player ids (cdn only). */
  hasDefensiveCredits: boolean;
  events: PbpEvent[];
}
```

- [ ] **Step 2: Write the failing tests**

Create `scripts/lib/pbp/normalize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { clockSeconds, elapsedSeconds, normalizePbp } from './normalize';
import type { RawPlayByPlay } from './types';

describe('clock helpers', () => {
  it('parses ISO clocks', () => {
    expect(clockSeconds('PT11M40.00S')).toBe(700);
    expect(clockSeconds('PT00M04.70S')).toBe(4);
    expect(clockSeconds('')).toBe(0);
  });
  it('computes elapsed seconds in regulation and overtime', () => {
    expect(elapsedSeconds(1, 720)).toBe(0);
    expect(elapsedSeconds(2, 700)).toBe(740);
    expect(elapsedSeconds(4, 0)).toBe(2880);
    expect(elapsedSeconds(5, 300)).toBe(2880);
    expect(elapsedSeconds(6, 0)).toBe(3480);
  });
});

const CDN: RawPlayByPlay = { game: { gameId: '0022500001', actions: [
  { actionNumber: 1, clock: 'PT12M00.00S', period: 1, actionType: 'period', subType: 'start', scoreHome: '0', scoreAway: '0', description: 'Period Start' },
  { actionNumber: 4, clock: 'PT11M40.00S', period: 1, teamTricode: 'LAC', personId: 202695, actionType: '3pt', shotResult: 'Made', assistPersonId: 201935, scoreHome: '3', scoreAway: '0', description: "Leonard 26' 3PT (3 PTS) (Harden 1 AST)" },
  { actionNumber: 5, clock: 'PT11M20.00S', period: 1, teamTricode: 'DEN', personId: 203999, actionType: '2pt', shotResult: 'Missed', scoreHome: '3', scoreAway: '0', description: "MISS Jokic 10' Jump Shot" },
  { actionNumber: 6, clock: 'PT11M18.00S', period: 1, teamTricode: 'LAC', personId: 1627826, actionType: 'rebound', subType: 'defensive', scoreHome: '3', scoreAway: '0', description: 'Zubac REBOUND (Off:0 Def:1)' },
  { actionNumber: 7, clock: 'PT05M00.00S', period: 5, teamTricode: 'DEN', personId: 203999, actionType: 'freethrow', subType: '1 of 2', shotResult: 'Made', scoreHome: '3', scoreAway: '1', description: 'Jokic Free Throw 1 of 2 (1 PTS)' },
] } };

const STATS: RawPlayByPlay = { game: { gameId: '0020500001', actions: [
  { actionNumber: 2, clock: 'PT11M40.00S', period: 1, teamTricode: 'LAC', personId: 1, actionType: 'Made Shot', subType: 'Jump Shot', shotValue: 3, scoreHome: '3', scoreAway: '0', description: "Brand 26' 3PT Jump Shot (3 PTS) (Cassell 1 AST)" },
  { actionNumber: 3, clock: 'PT11M20.00S', period: 1, teamTricode: 'NJN', personId: 2, actionType: 'Missed Shot', subType: 'Layup', shotValue: 2, scoreHome: '', scoreAway: '', description: 'MISS Kidd Layup' },
  { actionNumber: 4, clock: 'PT11M10.00S', period: 1, teamTricode: 'NJN', personId: 2, actionType: 'Free Throw', subType: 'Free Throw 1 of 2', scoreHome: '', scoreAway: '', description: 'MISS Kidd Free Throw 1 of 2' },
  { actionNumber: 5, clock: 'PT11M10.00S', period: 1, teamTricode: 'NJN', personId: 2, actionType: 'Free Throw', subType: 'Free Throw 2 of 2', scoreHome: '3', scoreAway: '1', description: 'Kidd Free Throw 2 of 2 (1 PTS)' },
] } };

describe('normalizePbp (cdn)', () => {
  const pbp = normalizePbp(CDN, 'cdn');
  it('classifies shots, rebounds and free throws', () => {
    expect(pbp.hasDefensiveCredits).toBe(true);
    expect(pbp.events.map((e) => e.kind)).toEqual(['other', 'fg', 'fg', 'rebound', 'ft']);
    expect(pbp.events[1]).toMatchObject({ seq: 2, made: true, shotValue: 3, teamTricode: 'LAC', personId: 202695, assistPersonId: 201935, points: 3, scoringSide: 'home', elapsedSec: 20 });
    expect(pbp.events[2]).toMatchObject({ made: false, shotValue: 2, points: 0, scoringSide: null });
  });
  it('handles overtime clocks and away scoring', () => {
    expect(pbp.events[4]).toMatchObject({ period: 5, elapsedSec: 2880, made: true, shotValue: 1, points: 1, scoringSide: 'away', scoreHome: 3, scoreAway: 1 });
  });
});

describe('normalizePbp (stats v3)', () => {
  const pbp = normalizePbp(STATS, 'stats_pbp');
  it('carries the score forward when the provider leaves it blank', () => {
    expect(pbp.events.map((e) => [e.scoreHome, e.scoreAway])).toEqual([[3, 0], [3, 0], [3, 0], [3, 1]]);
  });
  it('reads made/missed free throws from the description and drops assist ids', () => {
    expect(pbp.hasDefensiveCredits).toBe(false);
    expect(pbp.events[2]).toMatchObject({ kind: 'ft', made: false, points: 0 });
    expect(pbp.events[3]).toMatchObject({ kind: 'ft', made: true, points: 1, scoringSide: 'away' });
    expect(pbp.events[0].assistPersonId).toBeNull();
  });
  it('normalizes historical tricodes', () => {
    expect(pbp.events[1].teamTricode).toBe('BKN');
  });
});

// Real samples saved by scripts/dev/capture-pbp-fixture.ts. Every made shot and
// free throw must add up to the final score — this validates classification.
const FIXTURES = path.join(__dirname, '__fixtures__');
const real = fs.existsSync(FIXTURES) ? fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.json')) : [];
describe.skipIf(real.length === 0)('normalizePbp on captured games', () => {
  for (const file of real) {
    it(`${file}: made shots + free throws equal the final score`, () => {
      const source = file.startsWith('cdn-') ? 'cdn' : 'stats_pbp';
      const pbp = normalizePbp(JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8')), source);
      const last = pbp.events[pbp.events.length - 1];
      const fromShots = pbp.events.reduce((s, e) => s + (e.made ? (e.shotValue ?? 0) : 0), 0);
      expect(pbp.events.length).toBeGreaterThan(300);
      expect(fromShots).toBe(last.scoreHome + last.scoreAway);
    });
  }
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run scripts/lib/pbp/normalize.test.ts`
Expected: FAIL — `./normalize` does not exist.

- [ ] **Step 4: Implement the normalizer**

Create `scripts/lib/pbp/normalize.ts`:

```ts
// scripts/lib/pbp/normalize.ts
// cdn.nba.com liveData and stats.nba.com playbyplayv3 → one PbpEvent stream.
// Points come from score changes (robust to both formats and to corrections);
// shot classification comes from actionType. Pure — no DB, no network.
import { normalizeTricode } from '../stats-nba.js';
import type { NormalizedPbp, PbpEvent, PbpSource, RawAction, RawPlayByPlay } from './types.js';

const REGULATION_PERIOD_SEC = 720;
const OT_PERIOD_SEC = 300;

/** "PT11M40.00S" → 700 (seconds left in the period). */
export function clockSeconds(iso: string): number {
  const m = /PT(\d+)M([\d.]+)S/.exec(iso ?? '');
  return m ? Number(m[1]) * 60 + Math.floor(Number(m[2])) : 0;
}

/** Seconds since tip for a period and time left in it. */
export function elapsedSeconds(period: number, clockSec: number): number {
  if (period <= 4) return (period - 1) * REGULATION_PERIOD_SEC + (REGULATION_PERIOD_SEC - clockSec);
  return 4 * REGULATION_PERIOD_SEC + (period - 5) * OT_PERIOD_SEC + (OT_PERIOD_SEC - clockSec);
}

type Classified = Pick<PbpEvent, 'kind' | 'made' | 'shotValue'>;
const OTHER: Classified = { kind: 'other', made: null, shotValue: null };
const missedFromText = (a: RawAction) => /\bMISS\b/i.test(a.description ?? '');

function classifyCdn(a: RawAction): Classified {
  switch ((a.actionType ?? '').toLowerCase()) {
    case '2pt': return { kind: 'fg', made: a.shotResult === 'Made', shotValue: 2 };
    case '3pt': return { kind: 'fg', made: a.shotResult === 'Made', shotValue: 3 };
    case 'freethrow':
      return {
        kind: 'ft',
        made: a.shotResult === 'Made' ? true : a.shotResult === 'Missed' ? false : !missedFromText(a),
        shotValue: 1,
      };
    case 'rebound': return { kind: 'rebound', made: null, shotValue: null };
    case 'turnover': return { kind: 'turnover', made: null, shotValue: null };
    case 'steal': return { kind: 'steal', made: null, shotValue: null };
    case 'block': return { kind: 'block', made: null, shotValue: null };
    default: return OTHER;
  }
}

function classifyStats(a: RawAction): Classified {
  const three = a.shotValue === 3 || /\b3PT\b/i.test(a.description ?? '') ? 3 : 2;
  switch (a.actionType) {
    case 'Made Shot': return { kind: 'fg', made: true, shotValue: three };
    case 'Missed Shot': return { kind: 'fg', made: false, shotValue: three };
    case 'Free Throw': return { kind: 'ft', made: !missedFromText(a), shotValue: 1 };
    case 'Rebound': return { kind: 'rebound', made: null, shotValue: null };
    case 'Turnover': return { kind: 'turnover', made: null, shotValue: null };
    default: return OTHER;
  }
}

function parseScore(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Normalizes a game's actions in provider order (both providers list them chronologically). */
export function normalizePbp(raw: RawPlayByPlay, source: PbpSource): NormalizedPbp {
  let home = 0;
  let away = 0;
  const events: PbpEvent[] = [];
  for (const a of raw.game.actions) {
    const nextHome = parseScore(a.scoreHome) ?? home;
    const nextAway = parseScore(a.scoreAway) ?? away;
    const clockSec = clockSeconds(a.clock);
    const cls = source === 'cdn' ? classifyCdn(a) : classifyStats(a);
    events.push({
      seq: events.length + 1,
      period: a.period,
      clockSec,
      elapsedSec: elapsedSeconds(a.period, clockSec),
      teamTricode: a.teamTricode ? normalizeTricode(a.teamTricode) : null,
      personId: a.personId ? a.personId : null,
      ...cls,
      assistPersonId: source === 'cdn' && a.assistPersonId ? a.assistPersonId : null,
      points: nextHome - home + (nextAway - away),
      scoringSide: nextHome > home ? 'home' : nextAway > away ? 'away' : null,
      scoreHome: nextHome,
      scoreAway: nextAway,
      description: a.description ?? '',
    });
    home = nextHome;
    away = nextAway;
  }
  return { source, hasDefensiveCredits: source === 'cdn', events };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run scripts/lib/pbp/normalize.test.ts`
Expected: PASS (the captured-games block is skipped until Step 7).

- [ ] **Step 6: Add the stats.nba.com fetcher and capture script**

Append to `scripts/lib/stats-nba.ts` (add `import type { RawAction, RawPlayByPlay } from './pbp/types.js';` to the imports):

```ts
// ── Play-by-play (playbyplayv3) ──────────────────────────────────────────────

/** One game's play-by-play from stats.nba.com, or null when it has none. */
export async function fetchStatsPlayByPlay(gameId10: string, log: (msg: string) => void): Promise<RawPlayByPlay | null> {
  const data = await statsGet<{ game?: { gameId: string; actions?: RawAction[] } }>(
    `/playbyplayv3?GameID=${gameId10}&StartPeriod=0&EndPeriod=0`,
    log
  );
  if (!data.game?.actions?.length) return null;
  return { game: { gameId: data.game.gameId, actions: data.game.actions } };
}
```

Create `scripts/dev/capture-pbp-fixture.ts`:

```ts
// scripts/dev/capture-pbp-fixture.ts
// Saves real play-by-play JSON for normalize.test.ts. Run from a home network
// (stats.nba.com blocks cloud IPs):
//   npx tsx scripts/dev/capture-pbp-fixture.ts --cdn=0022500123 --stats=0020500456
import fs from 'node:fs';
import path from 'node:path';
import { fetchPlayByPlay } from '../lib/nba-live-client.js';
import { fetchStatsPlayByPlay } from '../lib/stats-nba.js';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const dir = path.join(process.cwd(), 'scripts/lib/pbp/__fixtures__');

async function main() {
  fs.mkdirSync(dir, { recursive: true });
  const cdn = arg('cdn');
  if (cdn) {
    const data = await fetchPlayByPlay(cdn);
    fs.writeFileSync(path.join(dir, `cdn-${cdn}.json`), JSON.stringify({ game: { gameId: data.game.gameId, actions: data.game.actions } }));
    console.log(`saved cdn-${cdn}.json (${data.game.actions.length} actions)`);
  }
  const stats = arg('stats');
  if (stats) {
    const data = await fetchStatsPlayByPlay(stats, console.log);
    if (!data) throw new Error(`stats.nba.com has no play-by-play for ${stats}`);
    fs.writeFileSync(path.join(dir, `stats-${stats}.json`), JSON.stringify(data));
    console.log(`saved stats-${stats}.json (${data.game.actions.length} actions)`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 7: Capture two real games and validate**

Pick game ids (10-char NBA ids) for one 2025-26 Clippers game and one 2005-06 Clippers game. The 2025-26 one comes from the DB:

```bash
psql "$(grep ^DATABASE_URL .env.local | cut -d= -f2-)" -Atc "SELECT lpad(g.nba_game_id::text, 10, '0') FROM games g JOIN teams t ON t.team_id IN (g.home_team_id, g.away_team_id) WHERE t.abbreviation='LAC' AND g.season_id=2025 AND g.status='final' ORDER BY g.game_date DESC LIMIT 1"
```

For 2005-06 use `0020500010` (any regular-season id `00205000NN` works; if it isn't a Clippers game that's fine — the sum check is team-agnostic). Then:

```bash
npx tsx scripts/dev/capture-pbp-fixture.ts --cdn=<2025-26 id> --stats=0020500010
npx vitest run scripts/lib/pbp/normalize.test.ts
```

Expected: both captured-game tests PASS. If one fails, print the first action whose `actionType` isn't classified (`kind === 'other'` but description mentions a shot or free throw), fix the mapping in `classifyCdn` / `classifyStats`, and re-run. If stats.nba.com returns HTTP 403 from this network, skip the `--stats` capture, note it for Task 9 (history will start at 2019-20), and continue.

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/pbp/types.ts scripts/lib/pbp/normalize.ts scripts/lib/pbp/normalize.test.ts scripts/lib/pbp/__fixtures__ scripts/lib/stats-nba.ts scripts/dev/capture-pbp-fixture.ts
git commit -m "feat(pbp): normalize cdn and stats.nba.com play-by-play

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Play-by-play derivations (game flow, periods, clutch)

**Files:**
- Create: `scripts/lib/pbp/derive.ts`, `scripts/lib/pbp/derive.test.ts`

**Interfaces:**
- Consumes: `PbpEvent`, `NormalizedPbp` from `scripts/lib/pbp/types.ts`.
- Produces:
  - `deriveGameFlow(events: PbpEvent[], lacIsHome: boolean): GameFlow`
  - `derivePeriodStats(pbp: NormalizedPbp, tricodes: { home: string; away: string }): { teams: PeriodTeamLine[]; players: PeriodPlayerLine[] }`
  - `deriveClutch(events: PbpEvent[]): ClutchLine[]`
  - interfaces `GameFlow`, `PeriodTeamLine`, `PeriodPlayerLine`, `ClutchLine` as below.

- [ ] **Step 1: Write the failing tests**

Create `scripts/lib/pbp/derive.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveClutch, deriveGameFlow, derivePeriodStats } from './derive';
import type { NormalizedPbp, PbpEvent } from './types';

// Builds a scoring/shot event. Score is the running score AFTER the event.
let seq = 0;
function ev(p: Partial<PbpEvent> & { home: number; away: number; prev: [number, number] }): PbpEvent {
  const { home, away, prev, ...rest } = p;
  const points = home - prev[0] + (away - prev[1]);
  return {
    seq: ++seq, period: 1, clockSec: 600, elapsedSec: 120, teamTricode: null, personId: null,
    kind: 'other', made: null, shotValue: null, assistPersonId: null,
    points, scoringSide: home > prev[0] ? 'home' : away > prev[1] ? 'away' : null,
    scoreHome: home, scoreAway: away, description: '', ...rest,
  };
}

// LAC is the AWAY team. Sequence: LAC 3 (0-3), DEN 2 (2-3), DEN 2 (4-3), LAC FT (4-4), LAC 2 (4-6).
const events: PbpEvent[] = [
  ev({ prev: [0, 0], home: 0, away: 3, teamTricode: 'LAC', personId: 1, kind: 'fg', made: true, shotValue: 3, assistPersonId: 2, elapsedSec: 20 }),
  ev({ prev: [0, 3], home: 0, away: 3, teamTricode: 'DEN', personId: 9, kind: 'fg', made: false, shotValue: 2, elapsedSec: 40 }),
  ev({ prev: [0, 3], home: 0, away: 3, teamTricode: 'LAC', personId: 2, kind: 'rebound', elapsedSec: 41 }),
  ev({ prev: [0, 3], home: 2, away: 3, teamTricode: 'DEN', personId: 9, kind: 'fg', made: true, shotValue: 2, elapsedSec: 60 }),
  ev({ prev: [2, 3], home: 4, away: 3, teamTricode: 'DEN', personId: 9, kind: 'fg', made: true, shotValue: 2, period: 4, clockSec: 200, elapsedSec: 2680 }),
  ev({ prev: [4, 3], home: 4, away: 4, teamTricode: 'LAC', personId: 1, kind: 'ft', made: true, shotValue: 1, period: 4, clockSec: 120, elapsedSec: 2760 }),
  ev({ prev: [4, 4], home: 4, away: 4, teamTricode: 'LAC', personId: 1, kind: 'turnover', period: 4, clockSec: 90, elapsedSec: 2790 }),
  ev({ prev: [4, 4], home: 4, away: 6, teamTricode: 'LAC', personId: 1, kind: 'fg', made: true, shotValue: 2, period: 4, clockSec: 60, elapsedSec: 2820 }),
];

describe('deriveGameFlow', () => {
  const flow = deriveGameFlow(events, false);
  it('tracks leads, deficits, lead changes and ties from the Clippers side', () => {
    expect(flow).toMatchObject({ lacLargestLead: 3, lacLargestDeficit: 1, leadChanges: 2, timesTied: 1 });
  });
  it('finds the best unanswered runs', () => {
    expect(flow.lacBestRun).toBe(3);
    expect(flow.oppBestRun).toBe(4);
  });
  it('records a comeback margin only for a win', () => {
    expect(flow.comebackMargin).toBe(1);
    expect(deriveGameFlow(events.slice(0, 5), false).comebackMargin).toBeNull();
  });
  it('emits the margin series at each score change', () => {
    expect(flow.marginSeries).toEqual([[0, 0], [20, 3], [60, 1], [2680, -1], [2760, 0], [2820, 2]]);
  });
});

describe('derivePeriodStats', () => {
  const pbp: NormalizedPbp = { source: 'cdn', hasDefensiveCredits: true, events };
  const { teams, players } = derivePeriodStats(pbp, { home: 'DEN', away: 'LAC' });
  const team = (t: string, p: number) => teams.find((x) => x.tricode === t && x.period === p);
  const player = (id: number, p: number) => players.find((x) => x.personId === id && x.period === p);

  it('team points per period match the score changes', () => {
    expect(team('LAC', 1)).toMatchObject({ pts: 3, fgm: 1, fga: 1, fg3m: 1, fg3a: 1, ast: 1, reb: 1 });
    expect(team('DEN', 1)).toMatchObject({ pts: 2, fgm: 1, fga: 2 });
    expect(team('LAC', 4)).toMatchObject({ pts: 3, fgm: 1, fga: 1, ftm: 1, fta: 1, tov: 1 });
  });
  it('credits players for points, threes, rebounds and assists', () => {
    expect(player(1, 1)).toMatchObject({ pts: 3, fg3m: 1, fgm: 1, fga: 1, tricode: 'LAC' });
    expect(player(2, 1)).toMatchObject({ reb: 1, ast: 1, pts: 0 });
    expect(player(1, 4)).toMatchObject({ pts: 3, fgm: 1, fga: 1 });
  });
  it('leaves assist/steal/block credits NULL when the source has none', () => {
    const v3 = derivePeriodStats({ ...pbp, source: 'stats_pbp', hasDefensiveCredits: false }, { home: 'DEN', away: 'LAC' });
    expect(v3.players.find((x) => x.personId === 2 && x.period === 1)).toMatchObject({ ast: null, stl: null, blk: null });
    expect(v3.teams.find((x) => x.tricode === 'LAC' && x.period === 1)?.ast).toBeNull();
  });
});

describe('deriveClutch', () => {
  const lines = deriveClutch(events);
  it('counts only events in the last 5:00 of the 4th with the game within 5', () => {
    expect(lines.find((l) => l.tricode === 'LAC' && l.personId === null)).toMatchObject({ pts: 3, fgm: 1, fga: 1, ftm: 1, fta: 1, tov: 1 });
    expect(lines.find((l) => l.tricode === 'LAC' && l.personId === 1)).toMatchObject({ pts: 3, tov: 1 });
    expect(lines.find((l) => l.tricode === 'DEN' && l.personId === 9)).toMatchObject({ pts: 2, fgm: 1, fga: 1 });
  });
  it('excludes events when the margin before them is more than 5', () => {
    const blowout = [ev({ prev: [20, 0], home: 22, away: 0, teamTricode: 'DEN', personId: 9, kind: 'fg', made: true, shotValue: 2, period: 4, clockSec: 100 })];
    blowout.unshift(ev({ prev: [0, 0], home: 20, away: 0, period: 1 }));
    expect(deriveClutch(blowout)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/lib/pbp/derive.test.ts`
Expected: FAIL — `./derive` does not exist.

- [ ] **Step 3: Implement the derivations**

Create `scripts/lib/pbp/derive.ts`:

```ts
// scripts/lib/pbp/derive.ts
// Per-game facts derived from normalized play-by-play. Pure.
import type { NormalizedPbp, PbpEvent } from './types.js';

export interface GameFlow {
  lacLargestLead: number;
  lacLargestDeficit: number;
  leadChanges: number;
  timesTied: number;
  lacBestRun: number;
  oppBestRun: number;
  comebackMargin: number | null;
  marginSeries: [number, number][];   // [elapsed_sec, lac_margin]
}

/** Lead, runs and comeback facts from the Clippers' side. */
export function deriveGameFlow(events: PbpEvent[], lacIsHome: boolean): GameFlow {
  let margin = 0;
  let lead = 0;
  let deficit = 0;
  let leadChanges = 0;
  let timesTied = 0;
  let lastSign = 0;                  // sign of the last non-zero margin
  const series: [number, number][] = [[0, 0]];
  const best = { lac: 0, opp: 0 };
  let run: { side: 'lac' | 'opp' | null; pts: number } = { side: null, pts: 0 };

  for (const e of events) {
    if (e.points === 0) continue;
    const m = lacIsHome ? e.scoreHome - e.scoreAway : e.scoreAway - e.scoreHome;
    if (m !== margin) {
      if (m === 0) timesTied++;
      const sign = Math.sign(m);
      if (sign !== 0 && lastSign !== 0 && sign !== lastSign) leadChanges++;
      if (sign !== 0) lastSign = sign;
      margin = m;
      lead = Math.max(lead, m);
      deficit = Math.max(deficit, -m);
      series.push([e.elapsedSec, m]);
    }
    if (e.points > 0 && e.scoringSide) {
      const side = (e.scoringSide === 'home') === lacIsHome ? 'lac' : 'opp';
      run = run.side === side ? { side, pts: run.pts + e.points } : { side, pts: e.points };
      best[side] = Math.max(best[side], run.pts);
    }
  }

  return {
    lacLargestLead: lead,
    lacLargestDeficit: deficit,
    leadChanges,
    timesTied,
    lacBestRun: best.lac,
    oppBestRun: best.opp,
    comebackMargin: margin > 0 ? deficit : null,
    marginSeries: series,
  };
}

export interface PeriodTeamLine {
  tricode: string; period: number;
  pts: number; fgm: number; fga: number; fg3m: number; fg3a: number; ftm: number; fta: number;
  reb: number; ast: number | null; tov: number;
}

export interface PeriodPlayerLine {
  personId: number; tricode: string; period: number;
  pts: number; reb: number; ast: number | null; fg3m: number; fgm: number; fga: number;
  stl: number | null; blk: number | null;
}

/** Team and player lines per period. Team points follow the score, so they match the line score. */
export function derivePeriodStats(
  pbp: NormalizedPbp,
  tricodes: { home: string; away: string }
): { teams: PeriodTeamLine[]; players: PeriodPlayerLine[] } {
  const credits = pbp.hasDefensiveCredits;
  const teams = new Map<string, PeriodTeamLine>();
  const players = new Map<string, PeriodPlayerLine>();

  const team = (tricode: string, period: number) => {
    const key = `${tricode}|${period}`;
    let line = teams.get(key);
    if (!line) {
      line = { tricode, period, pts: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, reb: 0, ast: credits ? 0 : null, tov: 0 };
      teams.set(key, line);
    }
    return line;
  };
  const player = (personId: number, tricode: string, period: number) => {
    const key = `${personId}|${period}`;
    let line = players.get(key);
    if (!line) {
      line = { personId, tricode, period, pts: 0, reb: 0, ast: credits ? 0 : null, fg3m: 0, fgm: 0, fga: 0, stl: credits ? 0 : null, blk: credits ? 0 : null };
      players.set(key, line);
    }
    return line;
  };

  let prevHome = 0;
  let prevAway = 0;
  for (const e of pbp.events) {
    const dh = e.scoreHome - prevHome;
    const da = e.scoreAway - prevAway;
    prevHome = e.scoreHome;
    prevAway = e.scoreAway;
    if (dh !== 0) team(tricodes.home, e.period).pts += dh;
    if (da !== 0) team(tricodes.away, e.period).pts += da;
    if (!e.teamTricode) continue;

    const t = team(e.teamTricode, e.period);
    const p = () => (e.personId ? player(e.personId, e.teamTricode!, e.period) : null);
    switch (e.kind) {
      case 'fg': {
        const shooter = p();
        t.fga++;
        if (shooter) shooter.fga++;
        if (e.shotValue === 3) t.fg3a++;
        if (e.made) {
          t.fgm++;
          if (e.shotValue === 3) t.fg3m++;
          if (shooter) {
            shooter.fgm++;
            shooter.pts += e.shotValue ?? 2;
            if (e.shotValue === 3) shooter.fg3m++;
          }
          if (credits && e.assistPersonId) {
            t.ast = (t.ast ?? 0) + 1;
            const assister = player(e.assistPersonId, e.teamTricode, e.period);
            assister.ast = (assister.ast ?? 0) + 1;
          }
        }
        break;
      }
      case 'ft': {
        t.fta++;
        if (e.made) {
          t.ftm++;
          const shooter = p();
          if (shooter) shooter.pts += 1;
        }
        break;
      }
      case 'rebound': {
        const rebounder = p();
        if (rebounder) {   // team rebounds (no player) are not counted, as in the box score
          t.reb++;
          rebounder.reb++;
        }
        break;
      }
      case 'turnover':
        t.tov++;
        break;
      case 'steal': {
        const stealer = credits ? p() : null;
        if (stealer) stealer.stl = (stealer.stl ?? 0) + 1;
        break;
      }
      case 'block': {
        const blocker = credits ? p() : null;
        if (blocker) blocker.blk = (blocker.blk ?? 0) + 1;
        break;
      }
      default:
        break;
    }
  }
  return { teams: [...teams.values()], players: [...players.values()] };
}

export interface ClutchLine {
  tricode: string;
  personId: number | null;     // null = team line
  pts: number; fgm: number; fga: number; fg3m: number; ftm: number; fta: number; tov: number;
}

/** Clutch = period >= 4, <= 5:00 left, margin <= 5 before the event (NBA definition). */
export function deriveClutch(events: PbpEvent[]): ClutchLine[] {
  const lines = new Map<string, ClutchLine>();
  const line = (tricode: string, personId: number | null) => {
    const key = `${tricode}|${personId ?? ''}`;
    let l = lines.get(key);
    if (!l) {
      l = { tricode, personId, pts: 0, fgm: 0, fga: 0, fg3m: 0, ftm: 0, fta: 0, tov: 0 };
      lines.set(key, l);
    }
    return l;
  };

  let prevHome = 0;
  let prevAway = 0;
  for (const e of events) {
    const inWindow = e.period >= 4 && e.clockSec <= 300 && Math.abs(prevHome - prevAway) <= 5;
    prevHome = e.scoreHome;
    prevAway = e.scoreAway;
    if (!inWindow || !e.teamTricode) continue;
    if (e.kind !== 'fg' && e.kind !== 'ft' && e.kind !== 'turnover') continue;

    const targets = [line(e.teamTricode, null), ...(e.personId ? [line(e.teamTricode, e.personId)] : [])];
    for (const l of targets) {
      if (e.kind === 'turnover') l.tov++;
      else if (e.kind === 'fg') {
        l.fga++;
        if (e.made) {
          l.fgm++;
          l.pts += e.shotValue ?? 2;
          if (e.shotValue === 3) l.fg3m++;
        }
      } else {
        l.fta++;
        if (e.made) {
          l.ftm++;
          l.pts += 1;
        }
      }
    }
  }
  return [...lines.values()];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/lib/pbp/derive.test.ts`
Expected: PASS.

- [ ] **Step 5: Validate against the captured games**

Append to `scripts/lib/pbp/normalize.test.ts`'s captured-games `describe` (inside the `for` loop, after the existing `it`):

```ts
    it(`${file}: period team points sum to the final score`, async () => {
      const { derivePeriodStats } = await import('./derive');
      const source = file.startsWith('cdn-') ? 'cdn' : 'stats_pbp';
      const pbp = normalizePbp(JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8')), source);
      const last = pbp.events[pbp.events.length - 1];
      const { teams } = derivePeriodStats(pbp, { home: 'HOME', away: 'AWAY' });
      const sum = (t: string) => teams.filter((l) => l.tricode === t).reduce((s, l) => s + l.pts, 0);
      expect(sum('HOME')).toBe(last.scoreHome);
      expect(sum('AWAY')).toBe(last.scoreAway);
    });
```

Run: `npx vitest run scripts/lib/pbp`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/pbp/derive.ts scripts/lib/pbp/derive.test.ts scripts/lib/pbp/normalize.test.ts
git commit -m "feat(pbp): derive game flow, period lines and clutch lines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Write play-by-play to the database (`ingest-pbp`, game-night hook)

**Files:**
- Create: `scripts/lib/pbp/ingest.ts`, `scripts/ingest-pbp.ts`
- Modify: `scripts/game-night.ts:88-104`, `package.json`
- Test: `scripts/lib/pipeline.integration.test.ts`

**Interfaces:**
- Consumes: `normalizePbp`, `deriveGameFlow`, `derivePeriodStats`, `deriveClutch`, `fetchStatsPlayByPlay`, `fetchPlayByPlay` (existing, `scripts/lib/nba-live-client.ts`), `toNbaGameId10`, `currentSeasonId`.
- Produces:
  - `CDN_PBP_FIRST_SEASON = 2019`
  - `ingestGamePbp(gameDbId: string, opts?: IngestPbpOptions): Promise<IngestPbpResult>` where `IngestPbpOptions = { db?: Db; keepRaw?: boolean; raw?: { data: RawPlayByPlay; source: PbpSource }; log?: (msg: string) => void }` and `IngestPbpResult = { status: 'ok'; events: number; unknownPlayers: number } | { status: 'missing' }`
  - `pruneRawEvents(db?: Db, now?: Date): Promise<number>`
  - CLI `npm run ingest-pbp [-- --days=3 | --season=2025-26 | --game=<game_id> [--from-file=path --format=cdn|stats_pbp]] [--keep-raw] [--force]`

- [ ] **Step 1: Write the failing integration test**

Add to `scripts/lib/pipeline.integration.test.ts`, after the slim-season test (it relies on the 2026 DEN–LAC game from the `'ingests a league box score'` test):

```ts
  it('ingests play-by-play for a Clippers game: flow, periods, clutch, raw events', async () => {
    const [game] = await sql<{ game_id: string }[]>`SELECT game_id::text FROM games WHERE nba_game_id = 22600077`;
    // DEN home, LAC away. LAC 3 (0-3), DEN 2+2 (4-3), LAC FT in the clutch (4-4), LAC 2 (4-6).
    const a = (n: number, clock: string, period: number, tri: string | null, person: number, type: string, result: string | null, h: number, w: number, extra: Record<string, unknown> = {}) =>
      ({ actionNumber: n, clock, period, teamTricode: tri, personId: person, actionType: type, shotResult: result, scoreHome: String(h), scoreAway: String(w), description: '', ...extra });
    const pbp = { game: { gameId: '0022600077', actions: [
      a(1, 'PT12M00.00S', 1, null, 0, 'period', null, 0, 0),
      a(2, 'PT11M40.00S', 1, 'LAC', 1_000_001, '3pt', 'Made', 0, 3, { assistPersonId: 1_000_002 }),
      a(3, 'PT11M00.00S', 1, 'DEN', 1_000_049, '2pt', 'Made', 2, 3),
      a(4, 'PT03M20.00S', 4, 'DEN', 1_000_049, '2pt', 'Made', 4, 3),
      a(5, 'PT02M00.00S', 4, 'LAC', 1_000_001, 'freethrow', 'Made', 4, 4),
      a(6, 'PT01M00.00S', 4, 'LAC', 1_000_001, '2pt', 'Made', 4, 6),
    ] } };
    const file = path.join(os.tmpdir(), `pbp-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(pbp));

    const out = run('scripts/ingest-pbp.ts', {}, [`--game=${game.game_id}`, `--from-file=${file}`, '--format=cdn', '--keep-raw']);
    expect(out).toContain('1 ingested');

    const [flow] = await sql`SELECT lac_largest_lead, lac_largest_deficit, lead_changes, times_tied, lac_best_run, opp_best_run, comeback_margin, source
                             FROM game_flow WHERE game_id = ${game.game_id}::bigint`;
    expect(flow).toEqual({ lac_largest_lead: 3, lac_largest_deficit: 1, lead_changes: 2, times_tied: 1, lac_best_run: 3, opp_best_run: 4, comeback_margin: 1, source: 'cdn' });

    const star = await sql<{ period: number; pts: number; fg3m: number }[]>`
      SELECT pp.period, pp.pts, pp.fg3m FROM period_player_stats pp JOIN players p ON p.player_id = pp.player_id
      WHERE pp.game_id = ${game.game_id}::bigint AND p.display_name = 'Star Clipper' ORDER BY pp.period`;
    expect(star).toEqual([{ period: 1, pts: 3, fg3m: 1 }, { period: 4, pts: 3, fg3m: 0 }]);

    const [clutch] = await sql`SELECT c.pts, c.ftm FROM clutch_stats c JOIN teams t ON t.team_id = c.team_id
                               WHERE c.game_id = ${game.game_id}::bigint AND t.abbreviation = 'LAC' AND c.player_id IS NULL`;
    expect(clutch).toEqual({ pts: 3, ftm: 1 });

    const counts = async () => (await sql<{ events: number; periods: number }[]>`
      SELECT (SELECT COUNT(*)::int FROM pbp_events WHERE game_id = ${game.game_id}::bigint) AS events,
             (SELECT COUNT(*)::int FROM period_team_stats WHERE game_id = ${game.game_id}::bigint) AS periods`)[0];
    expect(await counts()).toEqual({ events: 6, periods: 4 });

    // Already ingested → skipped; --force rewrites the same rows.
    expect(run('scripts/ingest-pbp.ts', {}, [`--game=${game.game_id}`, `--from-file=${file}`, '--format=cdn'])).toContain('0 game(s) to ingest');
    run('scripts/ingest-pbp.ts', {}, [`--game=${game.game_id}`, `--from-file=${file}`, '--format=cdn', '--force']);
    expect(await counts()).toEqual({ events: 6, periods: 4 });   // rows flagged keep by --keep-raw are stored again
    const [kept] = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM pbp_events WHERE game_id = ${game.game_id}::bigint AND keep`;
    expect(kept.n).toBe(6);
  }, TIMEOUT);
```

Add the imports at the top of the test file: `import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';`

- [ ] **Step 2: Run it to verify it fails**

Run: `FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/fixture npx vitest run scripts/lib/pipeline.integration.test.ts -t "play-by-play"`
Expected: FAIL — `scripts/ingest-pbp.ts` does not exist.

- [ ] **Step 3: Implement the ingest library**

Create `scripts/lib/pbp/ingest.ts`:

```ts
// scripts/lib/pbp/ingest.ts
// One Clippers game's play-by-play → game_flow, period_*_stats, clutch_stats
// (all seasons) and pbp_events (current season, or keepRaw). Rewrites the
// game's rows in one transaction, so re-running is safe.
import { sql as rootSql } from '../db.js';
import type { Db } from '../upserts.js';
import { fetchPlayByPlay } from '../nba-live-client.js';
import { fetchStatsPlayByPlay } from '../stats-nba.js';
import { currentSeasonId, toNbaGameId10 } from '../schedule-utils.js';
import { normalizePbp } from './normalize.js';
import { deriveClutch, deriveGameFlow, derivePeriodStats } from './derive.js';
import type { NormalizedPbp, PbpSource, RawPlayByPlay } from './types.js';

/** First season cdn.nba.com serves play-by-play for (same archive as its box scores). */
export const CDN_PBP_FIRST_SEASON = 2019;

export interface IngestPbpOptions {
  db?: Db;
  /** Store raw events and flag them keep (survive pruning). Default: store only for the current season, unflagged. */
  keepRaw?: boolean;
  /** Use this play-by-play instead of fetching (tests, replays). */
  raw?: { data: RawPlayByPlay; source: PbpSource };
  log?: (msg: string) => void;
}

export type IngestPbpResult =
  | { status: 'ok'; events: number; unknownPlayers: number }
  | { status: 'missing' };

async function fetchNormalized(gid: string, seasonId: number | null, log: (m: string) => void): Promise<NormalizedPbp | null> {
  if (seasonId !== null && seasonId >= CDN_PBP_FIRST_SEASON) {
    try {
      const data = (await fetchPlayByPlay(gid)) as unknown as RawPlayByPlay;
      return normalizePbp(data, 'cdn');
    } catch (err) {
      log(`cdn play-by-play failed for ${gid} (${(err as Error).message}); trying stats.nba.com`);
    }
  }
  const raw = await fetchStatsPlayByPlay(gid, log);
  return raw ? normalizePbp(raw, 'stats_pbp') : null;
}

export async function ingestGamePbp(gameDbId: string, opts: IngestPbpOptions = {}): Promise<IngestPbpResult> {
  const db = opts.db ?? rootSql;
  const log = opts.log ?? ((m: string) => console.log(`[pbp] ${m}`));

  const [game] = await db<{
    nba_game_id: string; season_id: number | null; home_team_id: string; away_team_id: string; home_abbr: string; away_abbr: string;
  }[]>`
    SELECT g.nba_game_id::text AS nba_game_id, g.season_id,
           g.home_team_id::text AS home_team_id, g.away_team_id::text AS away_team_id,
           h.abbreviation AS home_abbr, a.abbreviation AS away_abbr
    FROM games g
    JOIN teams h ON h.team_id = g.home_team_id
    JOIN teams a ON a.team_id = g.away_team_id
    WHERE g.game_id = ${gameDbId}::bigint
  `;
  if (!game) throw new Error(`[pbp] game_id ${gameDbId} not found`);
  const lacIsHome = game.home_abbr === 'LAC';
  if (!lacIsHome && game.away_abbr !== 'LAC') throw new Error(`[pbp] game_id ${gameDbId} is not a Clippers game`);
  const gid = toNbaGameId10(game.nba_game_id, game.season_id);
  if (!gid) throw new Error(`[pbp] game_id ${gameDbId}: ${game.nba_game_id} is not an NBA game id`);

  const pbp = opts.raw ? normalizePbp(opts.raw.data, opts.raw.source) : await fetchNormalized(gid, game.season_id, log);
  if (!pbp || pbp.events.length === 0) return { status: 'missing' };

  const flow = deriveGameFlow(pbp.events, lacIsHome);
  const periods = derivePeriodStats(pbp, { home: game.home_abbr, away: game.away_abbr });
  const clutch = deriveClutch(pbp.events);

  const teamIds = new Map<string, string>([[game.home_abbr, game.home_team_id], [game.away_abbr, game.away_team_id]]);
  const personIds = [...new Set(pbp.events.flatMap((e) => [e.personId, e.assistPersonId]).filter((x): x is number => x !== null))];
  const known = personIds.length
    ? await db<{ player_id: string; nba_person_id: number }[]>`
        SELECT player_id::text AS player_id, nba_person_id FROM players WHERE nba_person_id = ANY(${personIds}::int[])`
    : [];
  const playerIds = new Map(known.map((r) => [r.nba_person_id, r.player_id]));
  const unknownPlayers = personIds.filter((id) => !playerIds.has(id)).length;

  await db.begin(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    // keepRaw: true also flags the rows keep, so season-rollover pruning spares them (replay games).
    const [existing] = await tx<{ keep: boolean | null }[]>`SELECT bool_or(keep) AS keep FROM pbp_events WHERE game_id = ${gameDbId}::bigint`;
    const keepFlag = (existing?.keep ?? false) || opts.keepRaw === true;
    const storeRaw = opts.keepRaw ?? (keepFlag || game.season_id === currentSeasonId());

    await tx`DELETE FROM game_flow WHERE game_id = ${gameDbId}::bigint`;
    await tx`DELETE FROM period_team_stats WHERE game_id = ${gameDbId}::bigint`;
    await tx`DELETE FROM period_player_stats WHERE game_id = ${gameDbId}::bigint`;
    await tx`DELETE FROM clutch_stats WHERE game_id = ${gameDbId}::bigint`;
    await tx`DELETE FROM pbp_events WHERE game_id = ${gameDbId}::bigint`;

    await tx`
      INSERT INTO game_flow (game_id, lac_largest_lead, lac_largest_deficit, lead_changes, times_tied,
                             lac_best_run, opp_best_run, comeback_margin, margin_series, source)
      VALUES (${gameDbId}::bigint, ${flow.lacLargestLead}, ${flow.lacLargestDeficit}, ${flow.leadChanges}, ${flow.timesTied},
              ${flow.lacBestRun}, ${flow.oppBestRun}, ${flow.comebackMargin}, ${tx.json(flow.marginSeries)}, ${pbp.source})
    `;

    const teamRows = periods.teams
      .filter((t) => teamIds.has(t.tricode))
      .map((t) => ({
        game_id: gameDbId, team_id: teamIds.get(t.tricode)!, period: t.period,
        pts: t.pts, fgm: t.fgm, fga: t.fga, fg3m: t.fg3m, fg3a: t.fg3a, ftm: t.ftm, fta: t.fta, reb: t.reb, ast: t.ast, tov: t.tov,
      }));
    if (teamRows.length) await tx`INSERT INTO period_team_stats ${tx(teamRows)}`;

    const playerRows = periods.players
      .filter((p) => teamIds.has(p.tricode) && playerIds.has(p.personId))
      .map((p) => ({
        game_id: gameDbId, player_id: playerIds.get(p.personId)!, team_id: teamIds.get(p.tricode)!, period: p.period,
        pts: p.pts, reb: p.reb, ast: p.ast, fg3m: p.fg3m, fgm: p.fgm, fga: p.fga, stl: p.stl, blk: p.blk,
      }));
    if (playerRows.length) await tx`INSERT INTO period_player_stats ${tx(playerRows)}`;

    const clutchRows = clutch
      .filter((c) => teamIds.has(c.tricode) && (c.personId === null || playerIds.has(c.personId)))
      .map((c) => ({
        game_id: gameDbId, team_id: teamIds.get(c.tricode)!, player_id: c.personId === null ? null : playerIds.get(c.personId)!,
        pts: c.pts, fgm: c.fgm, fga: c.fga, fg3m: c.fg3m, ftm: c.ftm, fta: c.fta, tov: c.tov,
      }));
    if (clutchRows.length) await tx`INSERT INTO clutch_stats ${tx(clutchRows)}`;

    if (storeRaw) {
      const rows = pbp.events.map((e) => ({
        game_id: gameDbId, event_num: e.seq, period: e.period, clock_sec: e.clockSec, elapsed_sec: e.elapsedSec,
        team_id: e.teamTricode ? teamIds.get(e.teamTricode) ?? null : null,
        player_id: e.personId ? playerIds.get(e.personId) ?? null : null,
        kind: e.kind, made: e.made, shot_value: e.shotValue, points: e.points,
        score_home: e.scoreHome, score_away: e.scoreAway, description: e.description, keep: keepFlag,
      }));
      for (let i = 0; i < rows.length; i += 500) await tx`INSERT INTO pbp_events ${tx(rows.slice(i, i + 500))}`;
    }
  });

  return { status: 'ok', events: pbp.events.length, unknownPlayers };
}

/** Deletes raw events of past seasons, except games flagged keep. Returns rows deleted. */
export async function pruneRawEvents(db: Db = rootSql, now: Date = new Date()): Promise<number> {
  const result = await db`
    DELETE FROM pbp_events e USING games g
    WHERE g.game_id = e.game_id AND g.season_id < ${currentSeasonId(now)} AND NOT e.keep
  `;
  return result.count;
}
```

- [ ] **Step 4: Implement the CLI**

Create `scripts/ingest-pbp.ts`:

```ts
// scripts/ingest-pbp.ts
// Play-by-play → derived tables for final Clippers games that have box scores
// and no game_flow row yet (--force: re-derive them too).
//
//   (default)        games in the last --days (default 3) — the nightly job
//   --season=2005-06 a whole season (stats.nba.com before 2019-20: run locally)
//   --game=<game_id> one game; with --from-file=<json> --format=cdn|stats_pbp
//                    the play-by-play is read from disk (tests, replays)
//   --keep-raw       store raw events even for past seasons (replay games)
//
// Also prunes past seasons' raw events. Exits 1 if any game fails.
// Run via: npm run ingest-pbp [-- --season=2025-26]
import fs from 'node:fs';
import { sql } from './lib/db.js';
import { seasonIdFromSeasonYear } from './lib/schedule-utils.js';
import { ingestGamePbp, pruneRawEvents } from './lib/pbp/ingest.js';
import type { PbpSource, RawPlayByPlay } from './lib/pbp/types.js';

const log = (msg: string) => console.log(`[ingest-pbp] ${msg}`);

function parseArgs(argv: string[]) {
  const get = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const season = get('season');
  const seasonId = season ? seasonIdFromSeasonYear(season) : null;
  if (season && seasonId === null) throw new Error(`Invalid --season "${season}" (expected e.g. 2025-26)`);
  const days = Number(get('days') ?? 3);
  if (!Number.isInteger(days) || days < 1) throw new Error(`Invalid --days "${get('days')}"`);
  const game = get('game') ?? null;
  if (game !== null && !/^\d+$/.test(game)) throw new Error(`Invalid --game "${game}"`);
  const fromFile = get('from-file') ?? null;
  const format = (get('format') ?? 'cdn') as PbpSource;
  if (fromFile && !game) throw new Error('--from-file needs --game');
  if (!['cdn', 'stats_pbp'].includes(format)) throw new Error(`Invalid --format "${format}"`);
  return { seasonId, days, game, fromFile, format, keepRaw: argv.includes('--keep-raw'), force: argv.includes('--force') };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filter = args.game
    ? sql`AND g.game_id = ${args.game}::bigint`
    : args.seasonId !== null
      ? sql`AND g.season_id = ${args.seasonId}`
      : sql`AND g.game_date >= CURRENT_DATE - ${args.days}::int`;

  const games = await sql<{ game_id: string }[]>`
    SELECT g.game_id::text AS game_id
    FROM games g
    JOIN teams h ON h.team_id = g.home_team_id
    JOIN teams a ON a.team_id = g.away_team_id
    WHERE 'LAC' IN (h.abbreviation, a.abbreviation)
      AND g.status = 'final'
      AND EXISTS (SELECT 1 FROM game_player_box_scores pb WHERE pb.game_id = g.game_id)
      ${args.force ? sql`` : sql`AND NOT EXISTS (SELECT 1 FROM game_flow f WHERE f.game_id = g.game_id)`}
      ${filter}
    ORDER BY g.game_date DESC, g.game_id DESC
  `;
  log(`${games.length} game(s) to ingest`);

  const raw = args.fromFile
    ? { data: JSON.parse(fs.readFileSync(args.fromFile, 'utf8')) as RawPlayByPlay, source: args.format }
    : undefined;

  let ingested = 0;
  let missing = 0;
  const failures: string[] = [];
  for (const [i, g] of games.entries()) {
    try {
      const r = await ingestGamePbp(g.game_id, { raw, keepRaw: args.keepRaw || undefined, log });
      if (r.status === 'missing') missing++;
      else {
        ingested++;
        if (r.unknownPlayers > 0) log(`game ${g.game_id}: ${r.unknownPlayers} player id(s) not in players — their lines were skipped`);
      }
    } catch (err) {
      failures.push(`${g.game_id}: ${(err as Error).message}`);
    }
    if ((i + 1) % 50 === 0) log(`progress ${i + 1}/${games.length}`);
  }

  const pruned = await pruneRawEvents();
  log(`Done: ${ingested} ingested, ${missing} without play-by-play, ${failures.length} failed; pruned ${pruned} old raw event(s)`);
  await sql.end();
  if (failures.length) throw new Error(`${failures.length} game(s) failed:\n  ${failures.slice(0, 50).join('\n  ')}`);
}

main().catch(async (err) => {
  console.error('[ingest-pbp] Failed:', err);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
```

Add to `package.json` `scripts` (after `"finalize-games"`):

```json
    "ingest-pbp": "node --env-file-if-exists=.env.local node_modules/.bin/tsx scripts/ingest-pbp.ts",
```

- [ ] **Step 5: Run the integration test to verify it passes**

Run: `FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/fixture npx vitest run scripts/lib/pipeline.integration.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Hook the game-night runner**

In `scripts/game-night.ts`, add `import { ingestGamePbp } from './lib/pbp/ingest.js';` and, right after `console.log('[game-night] Finalization complete.');`, add:

```ts
            // Play-by-play → game flow / period / clutch tables, so postgame
            // insights can run minutes after the buzzer. Non-fatal: the nightly
            // pipeline picks up any game without a game_flow row.
            try {
              const r = await ingestGamePbp(candidate.game_id);
              console.log(`[game-night] Play-by-play: ${r.status === 'ok' ? `${r.events} events` : 'not available yet'}`);
            } catch (err) {
              console.error(`[game-night] Play-by-play ingest failed: ${(err as Error).message}`);
            }
```

- [ ] **Step 7: Typecheck, lint and commit**

Run: `npx tsc --noEmit && npm run lint` — expected: no errors.

```bash
git add scripts/lib/pbp/ingest.ts scripts/ingest-pbp.ts scripts/game-night.ts package.json scripts/lib/pipeline.integration.test.ts
git commit -m "feat(pbp): ingest-pbp and post-final play-by-play in the game-night runner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Record book (`build-record-book`)

**Files:**
- Create: `scripts/lib/sql-fragments.ts`
- Modify: `scripts/lib/insights/context.ts` (re-export `REGULAR_SEASON`)
- Create: `scripts/lib/record-book/highs.ts`, `scripts/lib/record-book/highs.test.ts`
- Create: `scripts/lib/record-book/streaks.ts`, `scripts/lib/record-book/streaks.test.ts`
- Create: `scripts/lib/record-book/records-start.ts`, `scripts/lib/record-book/records-start.test.ts`
- Create: `scripts/build-record-book.ts`
- Modify: `package.json`
- Test: `scripts/lib/pipeline.integration.test.ts`

**Interfaces:**
- Produces: `REGULAR_SEASON: string` from `scripts/lib/sql-fragments.ts` (context.ts keeps exporting it).
- Produces (highs.ts): `HighScope`, `HighSpec`, `HIGH_SPECS: HighSpec[]`, `RELEVANT_PLAYERS: string` (SQL subquery using `$1` LAC team id and `$2` first relevant season), `buildHighsSql(spec: HighSpec): string`, `highsParams(spec: HighSpec, lacTeamId: string, relevantFrom: number): (string | number)[]`.
- Produces (streaks.ts): `StreakGameBase`, `PlayerStreakGame`, `TeamStreakGame`, `StreakDef<G>`, `Streak`, `PLAYER_STREAK_DEFS`, `TEAM_STREAK_DEFS`, `computeStreaks<G>(games: G[], defs: StreakDef<G>[]): Streak[]`.
- Produces (records-start.ts): `MIN_COMPLETE_GAMES = 700`, `SeasonCoverage`, `resolveRecordsStart(coverage: SeasonCoverage[], backfilledThrough: number | null): number | null`.
- Produces app_kv keys: `insights.records_start` = `{ "season_id": number, "label": "1996-97" }` (read by Plan 2's framer); reads `history:backfilled_through` (number, written by Task 7).

- [ ] **Step 1: Move `REGULAR_SEASON` to a DB-free module**

Create `scripts/lib/sql-fragments.ts`:

```ts
// scripts/lib/sql-fragments.ts
// SQL fragments shared by insight and record-book queries. DB-free so pure
// modules (and their unit tests) can import them.

/**
 * Predicate (for alias `g`) selecting regular-season games only: excludes
 * playoffs and the play-in (NBA ids 005YY…, stored as 50,000,000–59,999,999).
 */
export const REGULAR_SEASON = `(NOT g.is_playoffs AND g.nba_game_id NOT BETWEEN 50000000 AND 59999999)`;
```

In `scripts/lib/insights/context.ts`, delete the `REGULAR_SEASON` constant and its doc comment, and add near the other imports:

```ts
import { REGULAR_SEASON } from '../sql-fragments.js';
export { REGULAR_SEASON };
```

Run: `npx tsc --noEmit && npx vitest run scripts/lib` — expected: PASS (no behavior change).

- [ ] **Step 2: Write the failing unit tests**

Create `scripts/lib/record-book/records-start.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveRecordsStart } from './records-start';

const cov = (pairs: [number, number][]) => pairs.map(([season_id, games_with_box]) => ({ season_id, games_with_box }));

describe('resolveRecordsStart', () => {
  it('walks back from the latest complete season while seasons stay complete', () => {
    expect(resolveRecordsStart(cov([[2024, 900], [2025, 900], [2026, 1], [2015, 1]]), null)).toBe(2024);
  });
  it('stops at a gap', () => {
    expect(resolveRecordsStart(cov([[2020, 1080], [2022, 1230], [2023, 1230], [2024, 1230]]), null)).toBe(2022);
  });
  it('counts a lockout season (725 games) as complete', () => {
    expect(resolveRecordsStart(cov([[1997, 1189], [1998, 725], [1999, 1189]]), null)).toBe(1997);
  });
  it('never reaches past the last successfully backfilled season', () => {
    expect(resolveRecordsStart(cov([[2008, 1230], [2009, 800], [2010, 1230], [2011, 990]]), 2010)).toBe(2010);
  });
  it('is null with no complete season', () => {
    expect(resolveRecordsStart(cov([[2026, 40]]), null)).toBeNull();
  });
});
```

Create `scripts/lib/record-book/streaks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeStreaks, PLAYER_STREAK_DEFS, TEAM_STREAK_DEFS, type PlayerStreakGame, type TeamStreakGame } from './streaks';

let n = 0;
const g = (entityId: string, teamId: string, pts: number, extra: Partial<PlayerStreakGame> = {}): PlayerStreakGame => ({
  entityId, teamId, gameId: String(++n), gameDate: `2026-01-${String(n).padStart(2, '0')}`,
  pts, reb: 0, ast: 0, stl: 0, blk: 0, fg3m: 0, fgm: 0, fga: 0, ...extra,
});
const scoring20 = PLAYER_STREAK_DEFS.filter((d) => d.key === 'scoring_20');

describe('computeStreaks', () => {
  it('keeps runs at or above the minimum and marks the one that reaches the last game active', () => {
    n = 0;
    const games = [g('1', 'A', 25), g('1', 'A', 22), g('1', 'A', 30), g('1', 'A', 8), g('1', 'A', 21), g('1', 'A', 20), g('1', 'A', 24)];
    const s = computeStreaks(games, scoring20);
    expect(s.map((x) => [x.length, x.isActive, x.startGameId, x.endGameId])).toEqual([[3, false, '1', '3'], [3, true, '5', '7']]);
  });
  it('breaks a streak when the player changes teams', () => {
    n = 0;
    const games = [g('1', 'A', 25), g('1', 'A', 25), g('1', 'B', 25), g('1', 'B', 25), g('1', 'B', 25)];
    const s = computeStreaks(games, scoring20);
    expect(s.map((x) => [x.teamId, x.length])).toEqual([['B', 3]]);
  });
  it('handles several entities independently', () => {
    n = 0;
    const games = [g('1', 'A', 25), g('1', 'A', 25), g('1', 'A', 25), g('2', 'A', 25), g('2', 'A', 25), g('2', 'A', 25), g('2', 'A', 25)];
    expect(computeStreaks(games, scoring20).map((x) => [x.entityId, x.length, x.isActive])).toEqual([['1', 3, true], ['2', 4, true]]);
  });
  it('recognizes double-doubles from any two categories', () => {
    n = 0;
    const dd = PLAYER_STREAK_DEFS.filter((d) => d.key === 'double_double');
    const games = [1, 2, 3, 4].map(() => g('1', 'A', 12, { reb: 11 }));
    games[2] = g('1', 'A', 10, { ast: 10 });
    expect(computeStreaks(games, dd)[0].length).toBe(4);
  });
  it('computes team win and loss streaks', () => {
    const t = (won: boolean, i: number): TeamStreakGame => ({ entityId: '13', teamId: '13', gameId: `t${i}`, gameDate: `2026-02-${String(i).padStart(2, '0')}`, won });
    const games = [true, true, true, false, false, false, false].map(t);
    expect(computeStreaks(games, TEAM_STREAK_DEFS).map((x) => [x.streakKey, x.length, x.isActive])).toEqual([['wins', 3, false], ['losses', 4, true]]);
  });
});
```

Create `scripts/lib/record-book/highs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildHighsSql, highsParams, HIGH_SPECS } from './highs';

describe('HIGH_SPECS', () => {
  it('has unique stat keys per scope', () => {
    const keys = HIGH_SPECS.map((s) => `${s.scope}:${s.statKey}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('ranks the opponent-points low ascending and everything else descending', () => {
    for (const s of HIGH_SPECS) expect(s.order).toBe(s.statKey === 'opp_pts_low' ? 'asc' : 'desc');
  });
  it('passes exactly the parameters each query references', () => {
    for (const s of HIGH_SPECS) {
      const sqlText = buildHighsSql(s);
      const params = highsParams(s, '13', 2024);
      const maxRef = Math.max(0, ...[...sqlText.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
      expect(params.length, `${s.scope}:${s.statKey}`).toBe(maxRef);
    }
  });
  it('builds an INSERT that keeps the top N per scope id', () => {
    const s = HIGH_SPECS.find((x) => x.scope === 'player_season' && x.statKey === 'pts')!;
    const text = buildHighsSql(s);
    expect(text).toContain('INSERT INTO rb_game_highs');
    expect(text).toContain('PARTITION BY s.scope_id');
    expect(text).toContain(`rn <= ${s.limit}`);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run scripts/lib/record-book`
Expected: FAIL — modules do not exist.

- [ ] **Step 4: Implement `records-start.ts`**

Create `scripts/lib/record-book/records-start.ts`:

```ts
// scripts/lib/record-book/records-start.ts
// The first season of the contiguous run of complete seasons ending at the
// latest complete one — where "records" begin for framing ("since 1996-97").

/** Regular-season games with box scores for a season to count as complete (1998-99 lockout: 725). */
export const MIN_COMPLETE_GAMES = 700;

export interface SeasonCoverage {
  season_id: number;
  games_with_box: number;   // final regular-season games that have player box scores
}

/**
 * @param backfilledThrough earliest season backfill-history finished cleanly
 *   (app_kv 'history:backfilled_through'); a partially written older season is
 *   never counted even if it passes the game threshold.
 */
export function resolveRecordsStart(coverage: SeasonCoverage[], backfilledThrough: number | null): number | null {
  const complete = new Set(coverage.filter((c) => c.games_with_box >= MIN_COMPLETE_GAMES).map((c) => c.season_id));
  if (complete.size === 0) return null;
  let start = Math.max(...complete);
  while (complete.has(start - 1)) start--;
  return backfilledThrough !== null ? Math.max(start, backfilledThrough) : start;
}
```

- [ ] **Step 5: Implement `streaks.ts`**

Create `scripts/lib/record-book/streaks.ts`:

```ts
// scripts/lib/record-book/streaks.ts
// Streaks of consecutive qualifying games, per entity, from game logs sorted
// by entity then date. A streak breaks on a miss or a team change; one that
// reaches the entity's latest game is active. Pure.

export interface StreakGameBase {
  entityId: string;
  teamId: string;
  gameId: string;
  gameDate: string;   // YYYY-MM-DD
}

export interface PlayerStreakGame extends StreakGameBase {
  pts: number; reb: number; ast: number; stl: number; blk: number; fg3m: number; fgm: number; fga: number;
}

export interface TeamStreakGame extends StreakGameBase {
  won: boolean;
}

export interface StreakDef<G> {
  key: string;
  minLength: number;
  hit: (g: G) => boolean;
}

export interface Streak {
  entityId: string;
  streakKey: string;
  length: number;
  startDate: string;
  endDate: string;
  startGameId: string;
  endGameId: string;
  isActive: boolean;
  teamId: string;
}

const tens = (g: PlayerStreakGame) => [g.pts, g.reb, g.ast, g.stl, g.blk].filter((v) => v >= 10).length;

export const PLAYER_STREAK_DEFS: StreakDef<PlayerStreakGame>[] = [
  { key: 'scoring_20', minLength: 3, hit: (g) => g.pts >= 20 },
  { key: 'scoring_30', minLength: 3, hit: (g) => g.pts >= 30 },
  { key: 'rebounding_10', minLength: 4, hit: (g) => g.reb >= 10 },
  { key: 'threes_3', minLength: 4, hit: (g) => g.fg3m >= 3 },
  { key: 'hot_shooting', minLength: 4, hit: (g) => g.fga >= 8 && g.fgm * 2 >= g.fga },
  { key: 'double_double', minLength: 4, hit: (g) => tens(g) >= 2 },
];

export const TEAM_STREAK_DEFS: StreakDef<TeamStreakGame>[] = [
  { key: 'wins', minLength: 3, hit: (g) => g.won },
  { key: 'losses', minLength: 3, hit: (g) => !g.won },
];

export function computeStreaks<G extends StreakGameBase>(games: G[], defs: StreakDef<G>[]): Streak[] {
  const out: Streak[] = [];
  const byEntity = new Map<string, G[]>();
  for (const g of games) {
    const list = byEntity.get(g.entityId) ?? [];
    list.push(g);
    byEntity.set(g.entityId, list);
  }

  for (const [entityId, list] of byEntity) {
    for (const def of defs) {
      let start = -1;   // index of the current run's first game, -1 = no run
      const close = (endIdx: number, active: boolean) => {
        const length = endIdx - start + 1;
        if (start >= 0 && length >= def.minLength) {
          out.push({
            entityId, streakKey: def.key, length,
            startDate: list[start].gameDate, endDate: list[endIdx].gameDate,
            startGameId: list[start].gameId, endGameId: list[endIdx].gameId,
            isActive: active, teamId: list[start].teamId,
          });
        }
        start = -1;
      };
      for (let i = 0; i < list.length; i++) {
        const g = list[i];
        if (start >= 0 && g.teamId !== list[start].teamId) close(i - 1, false);
        if (def.hit(g)) {
          if (start < 0) start = i;
        } else if (start >= 0) {
          close(i - 1, false);
        }
      }
      if (start >= 0) close(list.length - 1, true);
    }
  }
  return out;
}
```

- [ ] **Step 6: Implement `highs.ts`**

Create `scripts/lib/record-book/highs.ts`:

```ts
// scripts/lib/record-book/highs.ts
// Top-N single-game values per scope, rebuilt nightly into rb_game_highs.
// Regular season only. Query params: $1 = LAC team_id, $2 = first season of
// the "relevant players" window (players with a recent Clippers game).
import { REGULAR_SEASON } from '../sql-fragments.js';

export type HighScope = 'lac_team' | 'lac_player' | 'player_career' | 'player_season' | 'league_season';

export interface HighSpec {
  scope: HighScope;
  statKey: string;
  /** SELECT of (scope_id text, value numeric, game_id, game_date, player_id, team_id). */
  source: string;
  order: 'desc' | 'asc';
  limit: number;
}

/** Players with a regular-season Clippers game since season $2. */
export const RELEVANT_PLAYERS = `(
  SELECT DISTINCT rp.player_id
  FROM game_player_box_scores rp
  JOIN games rg ON rg.game_id = rp.game_id
  WHERE rp.team_id = $1::bigint AND rg.season_id >= $2::int
    AND NOT rg.is_playoffs AND rg.nba_game_id NOT BETWEEN 50000000 AND 59999999
)`;

const PLAYER_STATS: [string, string][] = [
  ['pts', 'points'], ['reb', 'rebounds'], ['ast', 'assists'], ['fg3m', 'fg3_made'], ['stl', 'steals'], ['blk', 'blocks'],
];

function playerGames(column: string, where: string, scopeId: string): string {
  return `
    SELECT ${scopeId} AS scope_id, pb.${column}::numeric AS value, pb.game_id, g.game_date, pb.player_id, pb.team_id
    FROM game_player_box_scores pb
    JOIN games g ON g.game_id = pb.game_id
    WHERE ${REGULAR_SEASON} AND ${where}`;
}

function lacTeamGames(expr: string): string {
  return `
    SELECT ''::text AS scope_id, (${expr})::numeric AS value, t.game_id, g.game_date, NULL::bigint AS player_id, t.team_id
    FROM game_team_box_scores t
    JOIN game_team_box_scores o ON o.game_id = t.game_id AND o.team_id <> t.team_id
    JOIN games g ON g.game_id = t.game_id
    WHERE t.team_id = $1::bigint AND ${REGULAR_SEASON}`;
}

const spec = (scope: HighScope, statKey: string, source: string, limit = 25, order: 'desc' | 'asc' = 'desc'): HighSpec =>
  ({ scope, statKey, source, order, limit });

export const HIGH_SPECS: HighSpec[] = [
  // Any Clipper, any season.
  ...PLAYER_STATS.map(([key, col]) => spec('lac_player', key, playerGames(col, 'pb.team_id = $1::bigint', `''::text`))),
  // Personal bests of relevant players (all teams).
  ...PLAYER_STATS.map(([key, col]) => spec('player_career', key, playerGames(col, `pb.player_id IN ${RELEVANT_PLAYERS}`, 'pb.player_id::text'))),
  ...PLAYER_STATS.map(([key, col]) =>
    spec('player_season', key, playerGames(col, `pb.player_id IN ${RELEVANT_PLAYERS}`, `pb.player_id::text || ':' || g.season_id::text`), 5)),
  // League-wide per season.
  ...PLAYER_STATS.filter(([key]) => ['pts', 'reb', 'ast', 'fg3m'].includes(key))
    .map(([key, col]) => spec('league_season', key, playerGames(col, 'TRUE', 'g.season_id::text'))),
  // Clippers team games.
  spec('lac_team', 'team_pts', lacTeamGames('t.points')),
  spec('lac_team', 'team_fg3m', lacTeamGames('t.fg3_made')),
  spec('lac_team', 'team_ast', lacTeamGames('t.assists')),
  spec('lac_team', 'margin', lacTeamGames('t.points - o.points')),
  spec('lac_team', 'opp_pts_low', lacTeamGames('o.points'), 25, 'asc'),
  // Quarters and halves (play-by-play derived).
  spec('lac_team', 'team_q_pts', `
    SELECT ''::text AS scope_id, pt.pts::numeric AS value, pt.game_id, g.game_date, NULL::bigint AS player_id, pt.team_id
    FROM period_team_stats pt JOIN games g ON g.game_id = pt.game_id
    WHERE pt.team_id = $1::bigint AND ${REGULAR_SEASON}`),
  spec('lac_player', 'q_pts', `
    SELECT ''::text AS scope_id, pp.pts::numeric AS value, pp.game_id, g.game_date, pp.player_id, pp.team_id
    FROM period_player_stats pp JOIN games g ON g.game_id = pp.game_id
    WHERE pp.team_id = $1::bigint AND ${REGULAR_SEASON}`),
  spec('lac_player', 'half_pts', `
    SELECT ''::text AS scope_id, SUM(pp.pts)::numeric AS value, pp.game_id, g.game_date, pp.player_id, pp.team_id
    FROM period_player_stats pp JOIN games g ON g.game_id = pp.game_id
    WHERE pp.team_id = $1::bigint AND pp.period <= 4 AND ${REGULAR_SEASON}
    GROUP BY pp.game_id, g.game_date, pp.player_id, pp.team_id, (pp.period <= 2)`),
];

export function buildHighsSql(s: HighSpec): string {
  const dir = s.order === 'asc' ? 'ASC' : 'DESC';
  return `
    INSERT INTO rb_game_highs (scope, scope_id, stat_key, rank, value, game_id, game_date, player_id, team_id)
    SELECT '${s.scope}', scope_id, '${s.statKey}', rn, value, game_id, game_date, player_id, team_id
    FROM (
      SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.scope_id ORDER BY s.value ${dir}, s.game_date, s.game_id) AS rn
      FROM (${s.source}) s
      WHERE s.value IS NOT NULL
    ) ranked
    WHERE rn <= ${s.limit}`.trim();
}

/** Only the params a spec's SQL references (Postgres rejects extra bind params). */
export function highsParams(s: HighSpec, lacTeamId: string, relevantFrom: number): (string | number)[] {
  if (s.source.includes('$2')) return [lacTeamId, relevantFrom];
  if (s.source.includes('$1')) return [lacTeamId];
  return [];
}
```

- [ ] **Step 7: Run unit tests to verify they pass**

Run: `npx vitest run scripts/lib/record-book`
Expected: PASS.

- [ ] **Step 8: Write the failing integration test**

Add to `scripts/lib/pipeline.integration.test.ts`, after the play-by-play test:

```ts
  it('builds the record book: highs, streaks, records start; idempotent', async () => {
    const out = run('scripts/build-record-book.ts');
    expect(out).toContain('records start 2024-25');

    const [top] = await sql<{ display_name: string }[]>`
      SELECT p.display_name FROM rb_game_highs h JOIN players p ON p.player_id = h.player_id
      WHERE h.scope = 'lac_player' AND h.stat_key = 'pts' AND h.rank = 1`;
    expect(top.display_name).toBe('Star Clipper');

    const [career] = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM rb_game_highs h JOIN players p ON p.player_id::text = h.scope_id
      WHERE h.scope = 'player_career' AND h.stat_key = 'pts' AND p.display_name = 'Star Clipper'`;
    expect(career.n).toBeGreaterThan(0);

    const [low] = await sql<{ r1: number; r2: number }[]>`
      SELECT MAX(value) FILTER (WHERE rank = 1)::int AS r1, MAX(value) FILTER (WHERE rank = 2)::int AS r2
      FROM rb_game_highs WHERE scope = 'lac_team' AND stat_key = 'opp_pts_low'`;
    expect(low.r1).toBeLessThanOrEqual(low.r2);

    const [quarter] = await sql<{ value: number }[]>`
      SELECT value::int FROM rb_game_highs WHERE scope = 'lac_player' AND stat_key = 'q_pts' AND rank = 1`;
    expect(quarter.value).toBe(3);

    const [streak] = await sql<{ length: number; is_active: boolean }[]>`
      SELECT s.length, s.is_active FROM rb_streaks s JOIN players p ON p.player_id = s.entity_id
      WHERE s.entity_type = 'player' AND s.streak_key = 'scoring_30' AND p.display_name = 'Star Clipper'
      ORDER BY s.end_date DESC LIMIT 1`;
    expect(streak.is_active).toBe(true);
    expect(streak.length).toBeGreaterThanOrEqual(4);

    const [kv] = await sql<{ value: { season_id: number; label: string } }[]>`SELECT value FROM app_kv WHERE key = 'insights.records_start'`;
    expect(kv.value).toEqual({ season_id: 2024, label: '2024-25' });

    const counts = async () => (await sql<{ highs: number; streaks: number }[]>`
      SELECT (SELECT COUNT(*)::int FROM rb_game_highs) AS highs, (SELECT COUNT(*)::int FROM rb_streaks) AS streaks`)[0];
    const before = await counts();
    run('scripts/build-record-book.ts');
    expect(await counts()).toEqual(before);
  }, TIMEOUT);
```

- [ ] **Step 9: Run it to verify it fails**

Run: `FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/fixture npx vitest run scripts/lib/pipeline.integration.test.ts -t "record book"`
Expected: FAIL — `scripts/build-record-book.ts` does not exist.

- [ ] **Step 10: Implement the script**

Create `scripts/build-record-book.ts`:

```ts
// scripts/build-record-book.ts
// Rebuilds the record book from scratch (it is small):
//   rb_game_highs — top single-game values per scope (see lib/record-book/highs.ts)
//   rb_streaks    — every qualifying streak of relevant players and the Clippers
//   app_kv 'insights.records_start' — first season of complete records
// Relevant players: a regular-season Clippers game in the last RELEVANT_SEASONS
// seasons that have Clippers box scores. Regular season only.
//
// Run via: npm run build-record-book
import { sql } from './lib/db.js';
import { seasonLabel } from './lib/schedule-utils.js';
import { REGULAR_SEASON } from './lib/sql-fragments.js';
import { buildHighsSql, highsParams, HIGH_SPECS, RELEVANT_PLAYERS } from './lib/record-book/highs.js';
import {
  computeStreaks, PLAYER_STREAK_DEFS, TEAM_STREAK_DEFS, type PlayerStreakGame, type TeamStreakGame,
} from './lib/record-book/streaks.js';
import { resolveRecordsStart, type SeasonCoverage } from './lib/record-book/records-start.js';

const RELEVANT_SEASONS = 3;
const log = (msg: string) => console.log(`[record-book] ${msg}`);

async function main() {
  const [lac] = await sql<{ team_id: string }[]>`SELECT team_id::text FROM teams WHERE abbreviation = 'LAC' ORDER BY team_id LIMIT 1`;
  if (!lac) throw new Error('LAC team not found');
  const [latest] = await sql<{ season_id: number | null }[]>`
    SELECT MAX(g.season_id)::int AS season_id FROM games g
    WHERE EXISTS (SELECT 1 FROM game_player_box_scores pb WHERE pb.game_id = g.game_id AND pb.team_id = ${lac.team_id}::bigint)`;
  if (latest?.season_id == null) {
    log('No Clippers box scores — nothing to build.');
    await sql.end();
    return;
  }
  const relevantFrom = latest.season_id - (RELEVANT_SEASONS - 1);

  const playerGames = (await sql.unsafe(`
    SELECT pb.player_id::text AS "entityId", pb.team_id::text AS "teamId", pb.game_id::text AS "gameId",
           g.game_date::text AS "gameDate",
           COALESCE(pb.points, 0)::int AS pts, COALESCE(pb.rebounds, 0)::int AS reb, COALESCE(pb.assists, 0)::int AS ast,
           COALESCE(pb.steals, 0)::int AS stl, COALESCE(pb.blocks, 0)::int AS blk, COALESCE(pb.fg3_made, 0)::int AS fg3m,
           COALESCE(pb.fg_made, 0)::int AS fgm, COALESCE(pb.fg_attempted, 0)::int AS fga
    FROM game_player_box_scores pb
    JOIN games g ON g.game_id = pb.game_id
    WHERE ${REGULAR_SEASON} AND pb.player_id IN ${RELEVANT_PLAYERS}
    ORDER BY pb.player_id, g.game_date, g.game_id`, [lac.team_id, relevantFrom])) as unknown as PlayerStreakGame[];

  const teamGames = (await sql.unsafe(`
    SELECT $1::text AS "entityId", $1::text AS "teamId", g.game_id::text AS "gameId", g.game_date::text AS "gameDate",
           ((g.home_team_id = $1::bigint) = (g.home_score > g.away_score)) AS won
    FROM games g
    WHERE $1::bigint IN (g.home_team_id, g.away_team_id) AND g.status = 'final'
      AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL AND ${REGULAR_SEASON}
    ORDER BY g.game_date, g.game_id`, [lac.team_id])) as unknown as TeamStreakGame[];

  const streakRows = [
    ...computeStreaks(playerGames, PLAYER_STREAK_DEFS).map((s) => ({ ...s, entityType: 'player' })),
    ...computeStreaks(teamGames, TEAM_STREAK_DEFS).map((s) => ({ ...s, entityType: 'team' })),
  ].map((s) => ({
    entity_type: s.entityType, entity_id: s.entityId, streak_key: s.streakKey, length: s.length,
    start_date: s.startDate, end_date: s.endDate, start_game_id: s.startGameId, end_game_id: s.endGameId,
    is_active: s.isActive, team_id: s.teamId,
  }));

  await sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as typeof sql;
    await tx`DELETE FROM rb_game_highs`;
    for (const s of HIGH_SPECS) await tx.unsafe(buildHighsSql(s), highsParams(s, lac.team_id, relevantFrom));
    await tx`DELETE FROM rb_streaks`;
    for (let i = 0; i < streakRows.length; i += 1000) await tx`INSERT INTO rb_streaks ${tx(streakRows.slice(i, i + 1000))}`;
  });

  const coverage = await sql<SeasonCoverage[]>`
    SELECT g.season_id::int AS season_id, COUNT(*)::int AS games_with_box
    FROM games g
    WHERE g.status = 'final' AND g.season_id IS NOT NULL AND ${sql.unsafe(REGULAR_SEASON)}
      AND EXISTS (SELECT 1 FROM game_player_box_scores pb WHERE pb.game_id = g.game_id)
    GROUP BY g.season_id`;
  const [kv] = await sql<{ value: number }[]>`SELECT value::int AS value FROM app_kv WHERE key = 'history:backfilled_through'`;
  const start = resolveRecordsStart(coverage, kv?.value ?? null);
  if (start !== null) {
    await sql`
      INSERT INTO app_kv (key, value, updated_at)
      VALUES ('insights.records_start', ${sql.json({ season_id: start, label: seasonLabel(start) })}, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  }

  const [counts] = await sql<{ highs: number }[]>`SELECT COUNT(*)::int AS highs FROM rb_game_highs`;
  log(`${counts.highs} game highs, ${streakRows.length} streaks; records start ${start === null ? 'unknown' : seasonLabel(start)}`);
  await sql.end();
}

main().catch(async (err) => {
  console.error('[record-book] Failed:', err);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
```

Add to `package.json` `scripts`:

```json
    "build-record-book": "node --env-file-if-exists=.env.local node_modules/.bin/tsx scripts/build-record-book.ts",
```

- [ ] **Step 11: Run tests to verify they pass**

Run: `FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/fixture npx vitest run scripts/lib/pipeline.integration.test.ts && npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 12: Commit**

```bash
git add scripts/lib/sql-fragments.ts scripts/lib/insights/context.ts scripts/lib/record-book scripts/build-record-book.ts package.json scripts/lib/pipeline.integration.test.ts
git commit -m "feat(record-book): nightly game highs, streaks and records start

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `backfill-history` orchestrator

**Files:**
- Create: `scripts/lib/backfill-plan.ts`, `scripts/lib/backfill-plan.test.ts`
- Create: `scripts/backfill-history.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `seasonLabel`, `seasonIdFromSeasonYear` (schedule-utils); `resolveRecordsStart`, `SeasonCoverage` (Task 6); CLIs `sync-league-games`, `ingest-pbp`, `compute-stats`, `build-record-book`.
- Produces: `HISTORY_OLDEST_SEASON = 1996`, `planHistorySeasons(loadedThrough: number, stopAt: number): number[]`; app_kv `history:backfilled_through` (number) after each clean season.

- [ ] **Step 1: Write the failing test**

Create `scripts/lib/backfill-plan.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { planHistorySeasons } from './backfill-plan';

describe('planHistorySeasons', () => {
  it('starts just below the earliest loaded season and walks back to the stop season', () => {
    expect(planHistorySeasons(2022, 2010)).toEqual([2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012, 2011, 2010]);
  });
  it('resumes below the last clean season', () => {
    expect(planHistorySeasons(2010, 1996)[0]).toBe(2009);
    expect(planHistorySeasons(2010, 1996).at(-1)).toBe(1996);
  });
  it('never goes past 1996-97', () => {
    expect(planHistorySeasons(1998, 1980)).toEqual([1997, 1996]);
  });
  it('is empty when done', () => {
    expect(planHistorySeasons(1996, 1996)).toEqual([]);
    expect(planHistorySeasons(2010, 2010)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run scripts/lib/backfill-plan.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the plan function**

Create `scripts/lib/backfill-plan.ts`:

```ts
// scripts/lib/backfill-plan.ts
// Which seasons backfill-history should ingest next (newest first). Pure.

/** stats.nba.com league game logs are complete from 1996-97. */
export const HISTORY_OLDEST_SEASON = 1996;

/**
 * @param loadedThrough earliest season already fully loaded (app_kv
 *                      'history:backfilled_through', else the start of complete records)
 * @param stopAt        oldest season to ingest in this run
 */
export function planHistorySeasons(loadedThrough: number, stopAt: number): number[] {
  const from = loadedThrough - 1;
  const to = Math.max(stopAt, HISTORY_OLDEST_SEASON);
  const seasons: number[] = [];
  for (let s = from; s >= to; s--) seasons.push(s);
  return seasons;
}
```

Run: `npx vitest run scripts/lib/backfill-plan.test.ts` — expected: PASS.

- [ ] **Step 4: Implement the orchestrator**

Create `scripts/backfill-history.ts`:

```ts
// scripts/backfill-history.ts
// One-time history backfill, run LOCALLY (stats.nba.com blocks cloud IPs).
// Walks seasons newest-first from just below the earliest complete season
// already loaded, one sync-league-games run per season, then Clippers
// play-by-play for that season (--pbp). After each clean season it records
// app_kv 'history:backfilled_through' and prints the database size, so an
// interrupted run resumes where it stopped. Stops at --stop-at (default
// 2010-11) for a storage check; continue with --stop-at=1996-97.
// Finishes with compute-stats and build-record-book.
//
// Run via: npm run backfill-history [-- --stop-at=1996-97] [-- --pbp]
import { execFileSync } from 'node:child_process';
import { sql } from './lib/db.js';
import { seasonIdFromSeasonYear, seasonLabel } from './lib/schedule-utils.js';
import { REGULAR_SEASON } from './lib/sql-fragments.js';
import { planHistorySeasons } from './lib/backfill-plan.js';
import { resolveRecordsStart, type SeasonCoverage } from './lib/record-book/records-start.js';

const log = (msg: string) => console.log(`[backfill-history] ${msg}`);
const tsx = (script: string, args: string[] = []) =>
  execFileSync('npx', ['tsx', script, ...args], { stdio: 'inherit', env: process.env });

async function dbSize(): Promise<string> {
  const [row] = await sql<{ size: string }[]>`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`;
  return row.size;
}

async function main() {
  const argv = process.argv.slice(2);
  const stopArg = argv.find((a) => a.startsWith('--stop-at='))?.split('=')[1] ?? '2010-11';
  const stopAt = seasonIdFromSeasonYear(stopArg);
  if (stopAt === null) throw new Error(`Invalid --stop-at "${stopArg}" (expected e.g. 2010-11)`);
  const withPbp = argv.includes('--pbp');

  const [kv] = await sql<{ value: number }[]>`SELECT value::int AS value FROM app_kv WHERE key = 'history:backfilled_through'`;
  const coverage = await sql<SeasonCoverage[]>`
    SELECT g.season_id::int AS season_id, COUNT(*)::int AS games_with_box
    FROM games g
    WHERE g.status = 'final' AND g.season_id IS NOT NULL AND ${sql.unsafe(REGULAR_SEASON)}
      AND EXISTS (SELECT 1 FROM game_player_box_scores pb WHERE pb.game_id = g.game_id)
    GROUP BY g.season_id`;
  const loadedThrough = kv?.value ?? resolveRecordsStart(coverage, null);
  if (loadedThrough === null) throw new Error('No complete season loaded yet — run sync-league-games for the current era first');
  const seasons = planHistorySeasons(loadedThrough, stopAt);
  log(`Database ${await dbSize()}. Seasons to backfill: ${seasons.length ? seasons.map(seasonLabel).join(', ') : 'none'}`);

  for (const season of seasons) {
    log(`── ${seasonLabel(season)} ──`);
    try {
      tsx('scripts/sync-league-games.ts', [`--season=${seasonLabel(season)}`]);
      if (withPbp) tsx('scripts/ingest-pbp.ts', [`--season=${seasonLabel(season)}`]);
    } catch {
      log(`${seasonLabel(season)} failed. Re-run \`npm run backfill-history\` to retry it (finished seasons are kept).`);
      log('If the log shows "stats.nba.com HTTP 403", this network is blocked: stop here; records will start at the last clean season.');
      await sql.end();
      process.exit(1);
    }
    await sql`
      INSERT INTO app_kv (key, value, updated_at) VALUES ('history:backfilled_through', ${sql.json(season)}, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    log(`${seasonLabel(season)} done. Database ${await dbSize()}.`);
  }

  log('Computing derived stats and the record book…');
  tsx('scripts/compute-stats.ts');
  tsx('scripts/build-record-book.ts');
  log(`Finished. Database ${await dbSize()}. To go further back: npm run backfill-history -- --stop-at=1996-97${withPbp ? ' --pbp' : ''}`);
  await sql.end();
}

main().catch(async (err) => {
  console.error('[backfill-history] Failed:', err);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
```

Add to `package.json` `scripts`:

```json
    "backfill-history": "node --env-file-if-exists=.env.local node_modules/.bin/tsx scripts/backfill-history.ts",
```

- [ ] **Step 5: Typecheck, lint and commit**

Run: `npx tsc --noEmit && npm run lint && npx vitest run` — expected: PASS.

```bash
git add scripts/lib/backfill-plan.ts scripts/lib/backfill-plan.test.ts scripts/backfill-history.ts package.json
git commit -m "feat(ingest): resumable backfill-history orchestrator with storage checkpoints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Nightly pipeline steps and docs

**Files:**
- Modify: `.github/workflows/post-game.yml`
- Modify: `Docs/DATA_DICTIONARY.md`

- [ ] **Step 1: Add the nightly steps**

In `.github/workflows/post-game.yml`, insert between the `Compute stats` and `Generate insights` steps:

```yaml
      # Clippers play-by-play → game flow / period / clutch tables (last 3 days).
      - name: Ingest play-by-play
        run: npm run ingest-pbp
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}

      # Game highs, streaks and records start for insight framing.
      - name: Build record book
        run: npm run build-record-book
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

- [ ] **Step 2: Document the tables**

Append to `Docs/DATA_DICTIONARY.md`:

```markdown
---

## game_flow

One row per Clippers game with play-by-play. Written by `scripts/lib/pbp/ingest.ts`.

**Primary key** — `game_id`

**Key fields**
- `lac_largest_lead`, `lac_largest_deficit`: from the Clippers' side (deficit is a positive number)
- `lead_changes`, `times_tied`
- `lac_best_run`, `opp_best_run`: most unanswered points
- `comeback_margin`: largest deficit overcome in a win (NULL in a loss)
- `margin_series`: `[[elapsed_sec, lac_margin], …]` at each score change (game-flow chart)
- `source`: `cdn` (2019-20+) or `stats_pbp` (stats.nba.com playbyplayv3)

## period_team_stats / period_player_stats

Per-quarter lines for both teams in Clippers games. Team points follow the score (match the line score). `ast`, `stl`, `blk` are NULL for `stats_pbp` games (no player credits in that feed).

## clutch_stats

Last 5:00 of the 4th/OT with the margin ≤ 5 before each event. `player_id` NULL = team line.

## pbp_events

Normalized events for current-season Clippers games (live receipts, replay) and games flagged `keep`. Past seasons are pruned by `ingest-pbp`.

## rb_game_highs

Record book, rebuilt nightly by `scripts/build-record-book.ts`. Regular season only.

**Primary key** — `(scope, scope_id, stat_key, rank)`

- `scope`: `lac_team`, `lac_player` (any Clipper), `player_career` / `player_season` (players with a Clippers game in the last 3 seasons), `league_season`
- `scope_id`: `''`, a `player_id`, a `season_id`, or `player_id:season_id`
- `stat_key`: `pts reb ast fg3m stl blk`, team `team_pts team_fg3m team_ast margin opp_pts_low team_q_pts`, player `q_pts half_pts`
- `rank` 1 = best (for `opp_pts_low`, fewest points allowed); ties broken by earliest date

## rb_streaks

Every qualifying streak for relevant players and the Clippers (regular season; breaks on a miss or a team change). `is_active` = reaches the entity's latest game. Keys: `scoring_20`, `scoring_30`, `rebounding_10`, `threes_3`, `hot_shooting`, `double_double` (min 3–4 games), `wins`, `losses` (min 3).

## app_kv keys (insights)

- `insights.records_start`: `{ season_id, label }` — first season of complete league records; frames say "since {label}"
- `history:backfilled_through`: earliest season `backfill-history` finished cleanly
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/post-game.yml Docs/DATA_DICTIONARY.md
git commit -m "chore(pipeline): nightly play-by-play and record book; document new tables

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Production rollout (operational — needs Luke)

No code. Each step that writes to production waits for Luke's explicit "go" in chat.

- [ ] **Step 1: Open the PR and get CI green**

Push `insights/espn-engine`, open a PR to `main`, and confirm `ci.yml` (typecheck, lint, unit + fixture integration tests) passes.

- [ ] **Step 2: Apply the migration (Luke approves)**

After merge: `gh workflow run db-migrate.yml -f file=2026-10-insights-v2-data.sql -f confirm=migrate`, then `gh run watch`. Expected: "Apply migration" succeeds. Verify: `psql "$DATABASE_URL" -c "\dt rb_*"` lists `rb_game_highs`, `rb_streaks`.

- [ ] **Step 3: Reclaim the old player payloads (Luke approves; run off-hours)**

Rows written before `9d0f326` still hold ~1 KB of raw JSON each (~100 MB). With Neon's 0.5 GB cap this is the cheapest headroom available:

```bash
psql "$DATABASE_URL" -c "SELECT pg_size_pretty(pg_database_size(current_database()))"
psql "$DATABASE_URL" -c "UPDATE game_player_box_scores SET raw_payload = NULL WHERE raw_payload IS NOT NULL"
psql "$DATABASE_URL" -c "VACUUM FULL game_player_box_scores"
psql "$DATABASE_URL" -c "SELECT pg_size_pretty(pg_database_size(current_database()))"
```

`VACUUM FULL` locks the table for a minute or two (the site's player pages briefly wait). Expected: the database shrinks by roughly 80–100 MB.

- [ ] **Step 4: Current-era play-by-play and record book**

Run locally: `npm run ingest-pbp -- --season=2025-26 --keep-raw` (keeps last season's raw events, ≈40k rows, for live replay in Plan 6), then `npm run ingest-pbp -- --season=2024-25`, `-- --season=2023-24`, `-- --season=2022-23`, then `npm run build-record-book`. Expected: `records start 2022-23`; `SELECT COUNT(*) FROM pbp_events WHERE keep` > 30000.

- [ ] **Step 5: Probe stats.nba.com from Luke's network**

`npx tsx scripts/dev/capture-pbp-fixture.ts --stats=0020500010` (sandbox off — this needs the real network). Expected: `saved stats-0020500010.json`. HTTP 403 → history stops at 2019-20 (CDN seasons only); run Step 6 with `--stop-at=2019-20` and skip Step 7.

- [ ] **Step 6: Backfill to 2010-11 (Luke approves; long-running)**

Check first whether the other session already loaded some of these seasons (`SELECT season_id, COUNT(*) FROM games WHERE status='final' GROUP BY 1 ORDER BY 1`); the orchestrator starts below the earliest complete one either way. Run `DB_POOL_MAX=10 npm run backfill-history -- --pbp` (defaults to `--stop-at=2010-11`). Takes several hours; safe to interrupt and re-run. Watch the printed database size after each season and **stop if it passes 450 MB**. Report the final size to Luke with the projection for 1996-97 (≈ size growth per season × 14) against the 0.5 GB cap.

- [ ] **Step 7: Continue further back (only if Luke approves after the size check)**

`npm run backfill-history -- --stop-at=<season Luke picks> --pbp`, stopping early if the database nears 450 MB. Expected final line: `Finished. Database <size>`; `build-record-book` logs `records start <that season>`.

- [ ] **Step 8: Spot-check the data**

```sql
SELECT season_id, COUNT(*) FROM games WHERE status = 'final' GROUP BY 1 ORDER BY 1;   -- ~1189-1320 per season, 725 in 1998-99
SELECT h.value, p.display_name, h.game_date FROM rb_game_highs h JOIN players p USING (player_id)
 WHERE scope = 'lac_player' AND stat_key = 'pts' ORDER BY rank LIMIT 5;               -- plausible Clippers scoring highs
SELECT COUNT(*) FROM game_flow;                                                         -- ≈ 82 × seasons with play-by-play
```

Report the results to Luke; note any season with a much lower game count.

---

## Plan series

Plans are written just-in-time against the code the previous plan produced:

1. **Data foundation** — this plan.
2. **Engine core** — facts, framer (reads `insights.records_start`, `rb_*`), scorer, templates, composer, `insights` migration (surface, frame, evidence, entities, score_parts, first_emitted_at), port six generators, `insights:replay`, golden tests.
3. **New surfaces** — postgame, pregame, player detectors; runner hooks.
4. **UI** — card anatomy, six evidence visuals, receipts, placements, game-flow chart, API/loader changes.
5. **News & social** — `Docs/superpowers/plans/2026-09-27-insights-v2-plan-5-news.md` (independent; can run in parallel with 2–4).
6. **Live** — runner integration, preload, live detectors, watch list, `live:replay`.
