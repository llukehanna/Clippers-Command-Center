# Phase 7: Live Data Pipeline - Research

**Researched:** 2026-03-06
**Domain:** Node.js polling engine, NBA live JSON CDN, PostgreSQL append-only writes
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Poller execution model**
- `npm run poll-live` — a long-running Node process started manually before a game
- Auto-exits when game reaches Final status (no manual Ctrl+C needed)
- One log line per poll: e.g. `[Q3 4:32] LAC 87 - MIA 82 | snapshot #47 stored`
- On API failure: warn and continue with exponential backoff (up to ~60s ceiling); do NOT exit on first failure
- Failure counter shown in warning lines; normal cadence resumes when API recovers

**Finalization trigger**
- Poller triggers finalization inline when it detects `gameStatus = Final` — same process, before exiting
- Finalization retries up to 3 times with 60s delay if player box score rows are absent (NBA API lag)
- Also build a standalone `npm run finalize-games` script for catch-up runs (games missed when poll-live wasn't running)
- Both scripts use the NBA live JSON boxscore endpoint: `cdn.nba.com/static/json/liveData/boxscore/boxscore_{gameId}.json`

**Script and code location**
- All Phase 7 scripts follow `scripts/` pattern: `scripts/poll-live.ts`, `scripts/finalize-games.ts`, `scripts/sync-schedule.ts`
- NBA Live JSON HTTP logic extracted to `scripts/lib/nba-live-client.ts` — mirrors `bdl-client.ts` pattern
  - Encapsulates all endpoint URLs, fetch logic, and response type definitions
- Shared TypeScript types (`LiveSnapshot`, `LiveGameState`, etc.) written to `src/lib/types/` so Phase 9 API routes can import them without depending on scripts/

**Pre-game detection window**
- `poll-live` queries `games` table for a Clippers game with `status = 'in_progress'` OR `status = 'scheduled'` with start time within 30 minutes
- If no candidate found: exit with message "No active Clippers game found."
- Pre-game snapshots (period=0 or null before tip-off) are stored normally — every successful poll writes a snapshot, logged as pre-game
- `sync-schedule.ts` (also built in Phase 7) keeps `games` table current using BALLDONTLIE /games for recent + upcoming Clippers games

**Phase 7 scope also includes**
- `npm run sync-schedule` — keeps games table current (status, scores, upcoming games) via BALLDONTLIE
- Wires `generateLiveInsights(snapshot, rollingData)` from Phase 6 `src/lib/insights/live.ts` into the poll loop
- Live insights are transient — not stored in DB, returned by `/api/live` in Phase 9

### Claude's Discretion
- Exact NBA live JSON endpoint URLs and field mapping to `live_snapshots` columns
- Polling loop implementation details (setInterval vs async loop with sleep)
- app_kv key names for tracking last poll time and failure counters
- Console output format for finalize-games and sync-schedule (mirror backfill/compute-stats style)
- Whether to add `--dry-run` flag to any scripts

### Deferred Ideas (OUT OF SCOPE)
- GitHub Actions cron for finalize-games (10-minute cadence on game nights) — Phase 16
- Vercel Cron for sync-schedule — deployment phase
- "Waiting mode" for poll-live (slow pre-game check every 5 min) — not in Phase 7 scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LIVE-01 | Application detects when a Clippers game is active and activates live mode | poll-live queries games table by status + start_time_utc window; NBA scoreboard confirms gameStatus=2 means in-progress |
| LIVE-06 | Live data refreshes approximately every 12 seconds | Async loop with `sleep(12_000)` between poll iterations; mirrors BDL DELAY_MS pattern |
| LIVE-07 | A snapshot of game state is stored in live_snapshots on every poll | INSERT into live_snapshots with full JSON payload; no ON CONFLICT — append-only by design |
| LIVE-08 | System detects scoring runs of 8–0 or greater | `detectScoringRun()` in src/lib/insights/live.ts already built and tested; Phase 7 calls it with recent_scoring extracted from play-by-play payload |
| LIVE-09 | System detects clutch situations (last 5 min of Q4/OT, margin ≤ 8) | `isClutchSituation()` in src/lib/insights/live.ts already built and tested; driven by period + clock from snapshot |
| LIVE-12 | If live source fails, system displays "data delayed" indicator and serves last cached snapshot | poll-live catches errors, increments failure counter, applies exponential backoff; last good snapshot remains in live_snapshots; /api/live (Phase 9) reads latest snapshot from DB |
</phase_requirements>

---

## Summary

Phase 7 builds three TypeScript scripts under `scripts/`: `poll-live.ts` (long-running game-night poller), `finalize-games.ts` (post-game box score catch-up), and `sync-schedule.ts` (schedule sync via BDL). All three follow the established project script pattern and share `scripts/lib/db.ts` for DB access.

The NBA live data comes from two public, key-free endpoints: `cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json` for game detection and score tracking, and `cdn.nba.com/static/json/liveData/boxscore/boxscore_{gameId}.json` for full box scores used in finalization. Both are verified live and return structured JSON with camelCase field names. The Clippers' NBA `teamId` is `1610612746`.

The insight detection logic (`detectScoringRun`, `isClutchSituation`, `generateLiveInsights`) is already fully implemented and tested in `src/lib/insights/live.ts`. Phase 7's primary job is wiring the polling loop, building the HTTP client for NBA live JSON, and performing the DB writes — the intelligence layer is already done.

**Primary recommendation:** Build `nba-live-client.ts` mirroring `bdl-client.ts`, then implement the polling loop as an async `while(true)` with a `sleep()` at the end of each iteration (simpler than `setInterval`, avoids drift and overlapping polls), with inline finalization triggered on `gameStatus === 3`.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `postgres` (npm) | ^3.4.8 | DB client — `sql` template tag | Already in use across all scripts; project decision Phase 04-01 |
| `tsx` | ^4.21.0 | TypeScript execution for scripts | Already wired into all `npm run` scripts via `node --env-file=.env.local node_modules/.bin/tsx` |
| Node `fetch` | built-in (Node 18+) | HTTP calls to NBA live JSON CDN | Used in `bdl-client.ts`; same pattern for `nba-live-client.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | ^4.0.18 | Unit tests | Testing new pure functions for snapshot parsing |
| `AbortController` | built-in | HTTP request timeout | Mirror bdl-client.ts 30s timeout pattern |

### No New Dependencies
Phase 7 requires zero new npm packages. All infrastructure (HTTP client pattern, DB client, upsert helpers, insight functions) is already in place.

**Installation:**
```bash
# No new installs — extend existing package.json scripts only:
# "poll-live": "node --env-file=.env.local node_modules/.bin/tsx scripts/poll-live.ts"
# "finalize-games": "node --env-file=.env.local node_modules/.bin/tsx scripts/finalize-games.ts"
# "sync-schedule": "node --env-file=.env.local node_modules/.bin/tsx scripts/sync-schedule.ts"
```

---

## NBA Live JSON API — Verified Endpoints

All endpoints are public, require no API key, and are served from `cdn.nba.com`.

### Endpoint 1: Today's Scoreboard
**URL:** `https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json`

**Response shape (verified):**
```typescript
{
  meta: { version: number; code: number; request: string; time: string };
  scoreboard: {
    gameDate: string;   // "YYYY-MM-DD"
    leagueId: string;
    leagueName: string;
    games: ScoreboardGame[];
  };
}

interface ScoreboardGame {
  gameId: string;          // e.g. "0022400001"
  gameCode: string;        // e.g. "20260306/DALBOS"
  gameStatus: number;      // 1=scheduled, 2=in_progress, 3=final
  gameStatusText: string;  // e.g. "Q3 4:32" | "Final" | "7:00 pm ET"
  period: number;          // 0=not started, 1-4=regulation, 5+=OT
  gameClock: string;       // "" when not in progress; "PT04M32.00S" during game
  gameTimeUTC: string;     // ISO 8601 tipoff time
  homeTeam: ScoreboardTeam;
  awayTeam: ScoreboardTeam;
}

interface ScoreboardTeam {
  teamId: number;          // LAC = 1610612746
  teamName: string;        // e.g. "Clippers"
  teamCity: string;        // e.g. "Los Angeles"
  teamTricode: string;     // e.g. "LAC"
  wins: number;
  losses: number;
  score: number;           // current score
  periods: Array<{ period: number; periodType: string; score: number }>;
  timeoutsRemaining: number;
  inBonus: string;
}
```

**Clippers teamId:** `1610612746` (verified from live scoreboard JSON)

**gameStatus values (confirmed):**
- `1` = scheduled (not yet started)
- `2` = in progress
- `3` = final

**gameClock format:** ISO 8601 duration — `"PT04M32.00S"` — must be parsed to display as `"4:32"`. When game is not in progress: empty string `""`.

### Endpoint 2: Live Boxscore
**URL:** `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_{gameId}.json`

**Response shape (verified structure):**
```typescript
{
  meta: { version: number; code: number; request: string; time: string };
  game: {
    gameId: string;
    gameStatus: number;      // same 1/2/3 values
    gameStatusText: string;
    period: number;
    gameClock: string;       // ISO 8601 format
    gameTimeUTC: string;
    regulationPeriods: number;
    arena: { arenaId: number; arenaName: string; arenaCity: string; arenaState: string };
    officials: Array<{ personId: number; name: string; jerseyNum: string; assignment: string }>;
    homeTeam: BoxscoreTeam;
    awayTeam: BoxscoreTeam;
  };
}

interface BoxscoreTeam {
  teamId: number;
  teamName: string;
  teamCity: string;
  teamTricode: string;
  score: number;
  periods: Array<{ period: number; periodType: string; score: number }>;
  statistics: TeamStatistics;  // team-level aggregates
  players: BoxscorePlayer[];
}

interface BoxscorePlayer {
  status: string;         // "ACTIVE" | "INACTIVE"
  order: number;
  personId: number;       // maps to players.nba_player_id
  jerseyNum: string;
  name: string;           // "First Last"
  nameI: string;          // "Last, F."
  position: string;
  starter: string;        // "1" | "0" (string, not boolean)
  oncourt: string;        // "1" | "0"
  played: string;         // "1" | "0" — use to filter DNPs
  statistics: PlayerStatistics;
}

interface PlayerStatistics {
  assists: number;
  blocks: number;
  blocksReceived: number;
  fieldGoalsAttempted: number;
  fieldGoalsMade: number;
  fieldGoalsPercentage: number;
  foulsOffensive: number;
  foulsDrawn: number;
  foulsPersonal: number;
  foulsTechnical: number;
  freeThrowsAttempted: number;
  freeThrowsMade: number;
  freeThrowsPercentage: number;
  minus: number;
  minutes: string;            // ISO 8601 "PT25M01.00S"
  minutesCalculated: string;  // simplified "PT25M"
  plus: number;
  plusMinusPoints: number;
  points: number;
  pointsFastBreak: number;
  pointsInThePaint: number;
  pointsSecondChance: number;
  reboundsDefensive: number;
  reboundsOffensive: number;
  reboundsTotal: number;
  steals: number;
  threePointersAttempted: number;
  threePointersMade: number;
  threePointersPercentage: number;
  turnovers: number;
  twoPointersAttempted: number;
  twoPointersMade: number;
  twoPointersPercentage: number;
}

interface TeamStatistics {
  // mirrors PlayerStatistics fields as team aggregates
  assists: number;
  blocks: number;
  fieldGoalsAttempted: number;
  fieldGoalsMade: number;
  freeThrowsAttempted: number;
  freeThrowsMade: number;
  points: number;
  reboundsDefensive: number;
  reboundsOffensive: number;
  reboundsTotal: number;
  steals: number;
  threePointersAttempted: number;
  threePointersMade: number;
  turnovers: number;
  // ... plus all percentage fields
}
```

### Endpoint 3: Play-by-Play (optional, for scoring events)
**URL:** `https://cdn.nba.com/static/json/liveData/playbyplay/playbyplay_{gameId}.json`

**Useful for:** Extracting `recent_scoring` events to pass to `generateLiveInsights()`. Each action has `teamId`, `actionType` ("2pt"/"3pt"), `scoreHome`, `scoreAway`, `clock` (ISO 8601), `period`.

**Note:** `LiveSnapshot.recent_scoring` (as defined in `src/lib/insights/live.ts`) requires `event_time_seconds: number` — must convert ISO 8601 clock to seconds elapsed in game.

---

## Architecture Patterns

### Recommended Script Structure
```
scripts/
├── poll-live.ts           # Long-running poller — entry point
├── finalize-games.ts      # Catch-up box score finalizer
├── sync-schedule.ts       # Schedule sync via BDL
└── lib/
    ├── db.ts              # (existing) postgres sql client
    ├── bdl-client.ts      # (existing) BDL HTTP client
    ├── upserts.ts         # (existing) + new box score upserts from NBA live JSON
    └── nba-live-client.ts # NEW: NBA live JSON HTTP client (mirrors bdl-client.ts)

src/lib/
├── types/
│   └── live.ts            # NEW: LiveGameState, NBALiveSnapshot shared types for Phase 9
└── insights/
    └── live.ts            # (existing, complete) generateLiveInsights, detectScoringRun, etc.
```

### Pattern 1: Async Poll Loop (setInterval alternative)

Use an `async while(true)` loop with `await sleep()` at the end. This avoids `setInterval`'s risk of overlapping executions when an API call takes longer than 12 seconds.

```typescript
// scripts/poll-live.ts (conceptual pattern)
async function pollLoop(gameId: string): Promise<void> {
  let snapshotCount = 0;
  let failureCount = 0;
  let backoffMs = 12_000;

  while (true) {
    try {
      const data = await fetchScoreboard();           // nba-live-client.ts
      const game = findClippersGame(data);

      if (!game) {
        console.warn('Game not found in scoreboard — may have ended');
        break;
      }

      await insertSnapshot(game, snapshotCount);      // live_snapshots INSERT
      updateGamesRow(game);                           // games table UPDATE

      const label = game.period === 0 ? 'PRE' : `Q${game.period} ${formatClock(game.gameClock)}`;
      console.log(`[${label}] LAC ${lacScore} - ${oppTricode} ${oppScore} | snapshot #${++snapshotCount} stored`);

      failureCount = 0;
      backoffMs = 12_000;  // reset on success

      if (game.gameStatus === 3) {
        console.log('Game reached Final — triggering finalization...');
        await finalizeGame(gameId);
        break;
      }

    } catch (err) {
      failureCount++;
      backoffMs = Math.min(backoffMs * 2, 60_000);
      console.warn(`[WARN] Poll failed (${failureCount} consecutive): ${(err as Error).message}. Retrying in ${backoffMs}ms...`);
    }

    await sleep(backoffMs);
  }
}
```

### Pattern 2: NBA Live Client (mirrors bdl-client.ts)

```typescript
// scripts/lib/nba-live-client.ts
const NBA_CDN = 'https://cdn.nba.com/static/json/liveData';
const REQUEST_TIMEOUT_MS = 15_000;

export async function fetchScoreboard(): Promise<NBAScoreboardResponse> {
  return nbaGet<NBAScoreboardResponse>('/scoreboard/todaysScoreboard_00.json');
}

export async function fetchBoxscore(gameId: string): Promise<NBABoxscoreResponse> {
  return nbaGet<NBABoxscoreResponse>(`/boxscore/boxscore_${gameId}.json`);
}

export async function fetchPlayByPlay(gameId: string): Promise<NBAPlayByPlayResponse> {
  return nbaGet<NBAPlayByPlayResponse>(`/playbyplay/playbyplay_${gameId}.json`);
}

async function nbaGet<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${NBA_CDN}${path}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`NBA CDN ${res.status}: ${path}`);
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

### Pattern 3: Snapshot INSERT (append-only — no ON CONFLICT)

```typescript
// live_snapshots is append-only — every poll writes a new row
async function insertSnapshot(game: ScoreboardGame, gameDbId: string): Promise<void> {
  await sql`
    INSERT INTO live_snapshots (
      game_id, captured_at, provider_ts,
      period, clock, home_score, away_score, payload
    ) VALUES (
      ${gameDbId}::bigint,
      now(),
      ${game.gameTimeUTC ? new Date(game.gameTimeUTC) : null},
      ${game.period},
      ${formatClock(game.gameClock)},   -- convert "PT04M32.00S" → "4:32"
      ${game.homeTeam.score},
      ${game.awayTeam.score},
      ${sql.json(game)}                 -- full scoreboard game object
    )
  `;
}
```

### Pattern 4: Finalization Box Score Mapping

NBA live boxscore → `game_team_box_scores` / `game_player_box_scores` field mapping:

| NBA Live Field | DB Column |
|----------------|-----------|
| `statistics.fieldGoalsMade` | `fg_made` |
| `statistics.fieldGoalsAttempted` | `fg_attempted` |
| `statistics.threePointersMade` | `fg3_made` |
| `statistics.threePointersAttempted` | `fg3_attempted` |
| `statistics.freeThrowsMade` | `ft_made` |
| `statistics.freeThrowsAttempted` | `ft_attempted` |
| `statistics.reboundsOffensive` | `offensive_reb` |
| `statistics.reboundsDefensive` | `defensive_reb` |
| `statistics.reboundsTotal` | `rebounds` |
| `statistics.assists` | `assists` |
| `statistics.steals` | `steals` |
| `statistics.blocks` | `blocks` |
| `statistics.turnovers` | `turnovers` |
| `statistics.foulsPersonal` | `fouls` |
| `statistics.plusMinusPoints` | `plus_minus` |
| `statistics.minutes` | `minutes` (TEXT — keep ISO 8601 format) |
| `personId` | lookup `players.nba_player_id` |
| `starter === "1"` | `starter` (boolean) |
| `played === "0"` | skip player (DNP) |

### Pattern 5: Game Detection Query

```typescript
// Clippers NBA team_id = 1610612746; resolve to internal team_id at startup
async function findActiveClippersGame(): Promise<{ game_id: string; nba_game_id: string } | null> {
  const LAC_TRICODE = 'LAC';
  // First: check games table for in_progress or soon-starting game
  const [row] = await sql<{ game_id: string; nba_game_id: string }[]>`
    SELECT g.game_id::text, g.nba_game_id::text
    FROM games g
    JOIN teams t ON (t.team_id = g.home_team_id OR t.team_id = g.away_team_id)
    WHERE t.abbreviation = ${LAC_TRICODE}
      AND (
        g.status = 'in_progress'
        OR (g.status = 'scheduled' AND g.start_time_utc <= now() + INTERVAL '30 minutes'
            AND g.start_time_utc >= now() - INTERVAL '30 minutes')
      )
    ORDER BY g.start_time_utc ASC
    LIMIT 1
  `;
  return row ?? null;
}
```

### Pattern 6: app_kv Key Names

Suggested keys for poll-live state tracking:
- `poll-live:last_poll_at` — ISO timestamp of last successful poll
- `poll-live:failure_count` — consecutive failure counter (reset on success)
- `poll-live:game_id` — nba_game_id of currently polled game

These are written via existing `setCheckpoint()` / `getCheckpoint()` from `upserts.ts`.

### Pattern 7: ISO 8601 Clock Parsing

The NBA live JSON `gameClock` and player `statistics.minutes` use ISO 8601 duration format. Must parse at the application layer:

```typescript
// "PT04M32.00S" → "4:32" (for display and live_snapshots.clock)
export function parseNBAClock(isoClock: string): string {
  if (!isoClock) return '0:00';
  const match = isoClock.match(/PT(\d+)M([\d.]+)S/);
  if (!match) return '0:00';
  const min = parseInt(match[1]!, 10);
  const sec = Math.floor(parseFloat(match[2]!));
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

// "PT04M32.00S" → total seconds elapsed in period (for ScoringEvent.event_time_seconds)
// A 12-minute quarter: elapsed = (12 * 60) - remaining_seconds
export function clockToSecondsRemaining(isoClock: string): number {
  const match = isoClock.match(/PT(\d+)M([\d.]+)S/);
  if (!match) return 0;
  return parseInt(match[1]!, 10) * 60 + Math.floor(parseFloat(match[2]!));
}
```

### Pattern 8: sync-schedule Implementation

`sync-schedule.ts` queries BDL `/games` with `team_ids[]=...` (LAC's BDL team ID) for a date window (last 7 days + next 30 days) and upserts status/score updates to the `games` table. Uses existing `upsertGames()` from `upserts.ts`. Follows the same `fetchAll` + progress logging pattern as `backfill.ts`.

BDL LAC team_id: query the `teams` table by `abbreviation = 'LAC'` to get `nba_team_id` at runtime.

### Anti-Patterns to Avoid
- **setInterval for polling:** Use `async while(true)` + `await sleep()` — prevents overlapping fetch calls when NBA CDN is slow
- **Storing live insights in DB:** Per project decision, live insights are transient; only the snapshot payload is stored
- **Treating `gameClock` as display-ready string:** Must parse ISO 8601 format first
- **Using `player.played === false`:** The `played` field is a string `"0"` / `"1"`, not a boolean; filter DNPs with `player.played === "1"`
- **Fetching boxscore to track live scores:** The scoreboard endpoint is lighter and sufficient for polling; boxscore is only needed for finalization

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Scoring run detection | Custom algorithm | `detectScoringRun()` in `src/lib/insights/live.ts` | Already built, tested, and correct |
| Clutch situation detection | Custom logic | `isClutchSituation()` in `src/lib/insights/live.ts` | Already built, tested, and correct |
| DB client | Any ORM or new client | `sql` from `scripts/lib/db.ts` | Project standard (Phase 04-01 decision) |
| HTTP client with retry | Custom fetch wrapper | Mirror `bdl-client.ts` pattern in `nba-live-client.ts` | Proven pattern; timeout, error handling, abort all done |
| Upsert helpers | Raw SQL per script | Extend `scripts/lib/upserts.ts` | Existing pattern keeps all upserts in one place |
| Box score aggregation | Application-side math | Read from NBA live JSON `statistics` (team-level totals provided) | NBA live boxscore includes team aggregate statistics directly — unlike BDL which required player-level aggregation |

**Key insight:** Unlike the BDL source (which required aggregating player stats to get team totals), the NBA live boxscore provides `homeTeam.statistics` and `awayTeam.statistics` as pre-computed team-level aggregates. Use those directly for `game_team_box_scores`.

---

## Common Pitfalls

### Pitfall 1: gameClock Is ISO 8601, Not "MM:SS"
**What goes wrong:** Storing `"PT04M32.00S"` directly into `live_snapshots.clock` (TEXT); the Phase 9 API and Phase 11 UI expect `"4:32"`.
**Why it happens:** The scoreboard and boxscore endpoints use ISO 8601 duration strings, not human-readable format.
**How to avoid:** Parse via `parseNBAClock()` before any DB write or display logic.
**Warning signs:** Clock values in snapshots containing "PT" prefix.

### Pitfall 2: player.started / player.played Are Strings, Not Booleans
**What goes wrong:** `if (!player.played)` matches `"0"` correctly but also matches `""` — safe. But `player.starter === true` always false since it's `"1"` or `"0"`.
**How to avoid:** Use `player.played === "1"` and `player.starter === "1"` explicitly.

### Pitfall 3: Finalization Before NBA API Has Player Data
**What goes wrong:** Fetching the boxscore immediately after `gameStatus === 3` may return zero or incomplete player rows — NBA API has a lag of ~1-5 minutes after games end.
**Why it happens:** NBA CDN updates game status to Final before all player statistics are computed.
**How to avoid:** Per the locked decision — finalization retries up to 3 times with 60s delay when player box score rows are absent. Check `boxscore.homeTeam.players.some(p => p.played === "1")` before writing.

### Pitfall 4: Snapshot INSERT vs. Upsert Confusion
**What goes wrong:** Adding `ON CONFLICT` to `live_snapshots` INSERT breaks the append-only design.
**Why it happens:** Developer reflex from seeing all other tables using upserts.
**How to avoid:** `live_snapshots` is intentionally append-only (one row per poll, no deduplication). Plain `INSERT`, no `ON CONFLICT`.

### Pitfall 5: games.start_time_utc May Be NULL
**What goes wrong:** The pre-game detection window query comparing `g.start_time_utc <= now() + INTERVAL '30 minutes'` fails silently for games where `start_time_utc IS NULL`.
**Why it happens:** BDL backfill may not populate `start_time_utc` if the field wasn't mapped.
**How to avoid:** Verify `start_time_utc` is populated by `sync-schedule.ts` BDL upsert. Fall back to date-only matching (`game_date = CURRENT_DATE`) for games with null start time.

### Pitfall 6: Polling the Wrong Game
**What goes wrong:** LAC plays a game but `games` table has stale status from last sync; poll-live finds no candidate and exits.
**Why it happens:** `sync-schedule.ts` was not run before `poll-live`.
**How to avoid:** Document the game-night playbook: run `sync-schedule` first, then `poll-live`. The log message "No active Clippers game found." should suggest running sync-schedule.

### Pitfall 7: NBA CDN Rate Limiting / CORS
**What goes wrong:** NBA CDN returns 403 or rate-limits aggressive polling.
**Why it happens:** CDN may have bot detection; 12-second cadence is conservative but occasional spikes (retry storms) could trigger.
**How to avoid:** Exponential backoff up to 60s ceiling is the correct mitigation. Don't retry immediately on failure. The 12s base cadence is well within what NBA.com itself uses for its own score displays.

---

## Code Examples

### Scoreboard → LiveSnapshot Conversion
```typescript
// Source: verified from cdn.nba.com live scoreboard JSON
function scoreboardGameToLiveSnapshot(game: ScoreboardGame): Partial<LiveSnapshot> {
  return {
    game_id: game.gameId,  // nba_game_id — resolve to internal game_id for DB
    period: game.period,
    clock: parseNBAClock(game.gameClock),  // "PT04M32.00S" → "4:32"
    home_score: game.homeTeam.score,
    away_score: game.awayTeam.score,
    home_team_id: String(game.homeTeam.teamId),
    away_team_id: String(game.awayTeam.teamId),
    recent_scoring: [],  // populated from play-by-play if needed
  };
}
```

### Finalization: Boxscore Player to DB Row
```typescript
// Source: verified NBA live boxscore player statistics field names
function playerStatToBoxScoreRow(player: BoxscorePlayer) {
  if (player.played !== "1") return null;  // skip DNPs
  const s = player.statistics;
  return {
    nba_player_id: player.personId,
    starter: player.starter === "1",
    minutes: s.minutes,             // keep ISO 8601 — matches game_player_box_scores.minutes TEXT column
    points: s.points,
    rebounds: s.reboundsTotal,
    assists: s.assists,
    steals: s.steals,
    blocks: s.blocks,
    turnovers: s.turnovers,
    fouls: s.foulsPersonal,
    plus_minus: s.plusMinusPoints,
    fg_made: s.fieldGoalsMade,
    fg_attempted: s.fieldGoalsAttempted,
    fg3_made: s.threePointersMade,
    fg3_attempted: s.threePointersAttempted,
    ft_made: s.freeThrowsMade,
    ft_attempted: s.freeThrowsAttempted,
    offensive_reb: s.reboundsOffensive,
    defensive_reb: s.reboundsDefensive,
    raw_payload: JSON.stringify(player),
  };
}
```

### Finalization: Team Statistics (use NBA-provided aggregates directly)
```typescript
// Source: verified NBA live boxscore team statistics field names
// Note: unlike BDL, NBA live JSON provides team-level totals directly
function teamStatsToBoxScoreRow(team: BoxscoreTeam, isHome: boolean) {
  const s = team.statistics;
  return {
    is_home: isHome,
    points: s.points,
    rebounds: s.reboundsTotal,
    assists: s.assists,
    steals: s.steals,
    blocks: s.blocks,
    turnovers: s.turnovers,
    fouls: s.foulsPersonal,
    fg_made: s.fieldGoalsMade,
    fg_attempted: s.fieldGoalsAttempted,
    fg3_made: s.threePointersMade,
    fg3_attempted: s.threePointersAttempted,
    ft_made: s.freeThrowsMade,
    ft_attempted: s.freeThrowsAttempted,
    offensive_reb: s.reboundsOffensive,
    defensive_reb: s.reboundsDefensive,
    raw_payload: JSON.stringify(team.statistics),
  };
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| BDL for box scores | NBA live JSON for post-game box scores | Phase 04 re-scope (2026-03-06) | NBA live JSON is the authoritative source; finalize-games script is the mechanism |
| Player-level stat aggregation for team totals (BDL) | Direct team statistics from NBA boxscore endpoint | Phase 7 design | Simpler finalization — no need to aggregate from players |

---

## Open Questions

1. **Does `games.start_time_utc` get populated by backfill/sync-schedule?**
   - What we know: `backfill.ts` maps BDL `g.date` → `game_date` but BDL game objects may have a time field not currently mapped
   - What's unclear: Whether `start_time_utc` is populated for upcoming games in the DB
   - Recommendation: `sync-schedule.ts` should explicitly map BDL game start time to `start_time_utc`; poll-live should fall back to `game_date = CURRENT_DATE` if `start_time_utc IS NULL`

2. **Should `recent_scoring` in LiveSnapshot be populated from play-by-play?**
   - What we know: `generateLiveInsights()` requires `recent_scoring: ScoringEvent[]`; play-by-play endpoint provides the data needed to build this
   - What's unclear: Whether fetching play-by-play on every poll (an extra HTTP call) is acceptable overhead, vs. deriving scoring deltas from consecutive snapshots
   - Recommendation: Fetch play-by-play on each poll and extract the last N scoring actions. The endpoint is public and fast. Scoring run detection requires individual event sequences, not just delta totals.

3. **BDL LAC team ID for sync-schedule**
   - What we know: `teams` table has `nba_team_id` from BDL, and `abbreviation = 'LAC'`
   - What's unclear: BDL's team_id for LAC (may differ from NBA's `1610612746`)
   - Recommendation: `sync-schedule.ts` should look up BDL team_id at runtime via `SELECT nba_team_id FROM teams WHERE abbreviation = 'LAC'` rather than hardcoding

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.0.18 |
| Config file | `vitest.config.ts` — includes `scripts/lib/insights/**/*.test.ts` and `src/lib/insights/**/*.test.ts` |
| Quick run command | `npx vitest run` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LIVE-08 | Scoring run >= 8 detected | unit | `npx vitest run --reporter=verbose` | ✅ `scripts/lib/insights/live.test.ts` |
| LIVE-09 | Clutch situation detected (last 5min Q4/OT, margin ≤ 8) | unit | `npx vitest run --reporter=verbose` | ✅ `scripts/lib/insights/live.test.ts` |
| LIVE-01 | Active Clippers game detection logic | unit | `npx vitest run` | ❌ Wave 0 — new test needed |
| LIVE-06 | 12s poll cadence | manual-only | run `npm run poll-live` and observe log timestamps | N/A — timing is runtime behavior |
| LIVE-07 | Snapshot stored on every poll | integration (manual) | Query `SELECT count(*) FROM live_snapshots` before/after poll | N/A — requires live DB |
| LIVE-12 | Failure → serve last snapshot + backoff | unit | Test backoff calculation function | ❌ Wave 0 — new test needed |

**Note:** LIVE-06, LIVE-07 are runtime integration behaviors that cannot be meaningfully unit tested. They are verified by running `npm run poll-live` against a real game or mock game.

### Sampling Rate
- **Per task commit:** `npx vitest run`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `scripts/lib/nba-live-client.test.ts` — unit tests for `parseNBAClock()` and `clockToSecondsRemaining()` (pure functions, easily testable)
- [ ] `scripts/poll-live.test.ts` (or `scripts/lib/poll-live-logic.test.ts`) — unit tests for game detection query builder and backoff calculation; test file covers LIVE-01 and LIVE-12

*(Existing `live.test.ts` covers LIVE-08 and LIVE-09 fully — those tests are already green)*

---

## Sources

### Primary (HIGH confidence)
- `https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json` — live fetch; verified field names, gameStatus values, gameClock format, LAC teamId
- `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_0022400001.json` — live fetch; verified homeTeam/awayTeam/players/statistics structure
- `https://cdn.nba.com/static/json/liveData/playbyplay/playbyplay_0022400001.json` — live fetch; verified actions array structure (clock, teamId, actionType, scoreHome/Away)
- Project source code (`scripts/lib/bdl-client.ts`, `scripts/lib/upserts.ts`, `src/lib/insights/live.ts`, `docs/DB_SCHEMA.sql`) — direct read; highest confidence for existing patterns

### Secondary (MEDIUM confidence)
- `github.com/swar/nba_api` documentation — confirms player statistics field names (fieldGoalsMade, threePointersMade, minutesCalculated, personId); corroborates live fetch findings
- WebSearch results confirming gameStatus 1/2/3 semantic values (scheduled/in-progress/final)

### Tertiary (LOW confidence)
- None — all critical claims verified against live endpoints or project source

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies; all tools already in project
- NBA live JSON field names: HIGH — verified by fetching live endpoints
- Architecture: HIGH — mirrors proven existing script patterns exactly
- Pitfalls: MEDIUM-HIGH — based on verified API quirks (ISO 8601 clock, string booleans) and established NBA API community knowledge
- gameStatus values: HIGH — confirmed 1/2/3 from live endpoint + multiple community sources

**Research date:** 2026-03-06
**Valid until:** 2026-06-06 (NBA CDN structure is stable; field names rarely change mid-season)
