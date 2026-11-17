# History Archive, Part 1: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink the database, then load every Clippers game since 1970–71, every league game since 1996–97, and league season totals since 1946–47 from the Kaggle dataset. The History pages then work for every era, with era team names.

**Architecture:**
- A one-off cleanup script nulls the unused player `raw_payload` and compacts the table. It ships as its own PR first.
- A local import script streams the Kaggle CSVs. It maps NBA.com IDs to our balldontlie-keyed `teams` and `players`, writes lean rows into the existing game and box-score tables, and builds three new season tables plus `team_era_names`.
- Three downstream changes:
  - `compute-stats` limits pre-2019 work to Clippers games.
  - The record book starts each stat where it became reliable.
  - The History API and UI carry era names and abbreviations.

**Tech Stack:** TypeScript, tsx scripts, `postgres` (porsager), Next.js 16 app router, Vitest, and `csv-parse` (new devDependency, used only by the import script).

**Spec:** `docs/superpowers/specs/2026-11-17-history-archive-games-design.md`. Read it first.

## Global Constraints

- **Stats nobody recorded are `null`, never `0`.** A blank CSV cell becomes `null`. A season total is `null` if any of that player's games that season lack the stat.
- **Player `raw_payload` is never written again.** Team `raw_payload` stays, because `history-game.ts` reads `periods` from it. Kaggle team rows get exactly `{"source":"kaggle"}`.
- **Scope of the import:**
  - Clippers franchise ID is `1610612746`. Clippers games load from season `1970` (1970–71).
  - League per-game rows load from season `1996`.
  - Season tables cover `1946` and later.
  - Preseason and All-Star games are never written.
- **Never overwrite existing data:** games whose `nba_game_id` already has player box scores are skipped. 2019+ data from the live pipeline is never overwritten.
- **Storage guard:** before each season, stop if the projected size would exceed 85% of `--cap-mb` (default `512`).
- **Load order:**
  1. Clippers games 1970–2018.
  2. The 2019–20 gaps.
  3. The season tables.
  4. League seasons, newest first, 2018 down to 1996.
- **`app_kv 'history:backfilled_through'`** = the oldest league season that loaded completely (at least 700 regular-season games with box scores). It is never hard-coded.
- **Record-book first seasons:**

  | First season | Stats |
  |---|---|
  | 1970 | pts, FG, FT, team_pts, margin, opp_pts_low, team streaks |
  | 1973 | reb, ast, team_ast |
  | 1979 | fg3m, team_fg3m |
  | 1983 | stl, blk, tov |

- **Old teams:** an era tricode that isn't one of today's 30 shows the neutral `TeamLogo` fallback badge with that tricode. Names use the era's short name ("vs SuperSonics").
- **No `.js` suffix** on imports in modules that `app/` routes import, or `next build` breaks. Scripts under `scripts/` keep their existing `.js` suffixes. Run `npm run build` before merging.
- **Migrations:**
  - Each lives in `Docs/migrations/` (capital D in git) and is idempotent.
  - Mirror it in `docs/DB_SCHEMA.sql`.
  - It's applied to prod with the `db-migrate.yml` workflow.
- **Integration tests** run against a throwaway Docker Postgres on port **55499**, never 55432:
  ```bash
  docker run -d --rm --name ccc-fixture-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=fixture -p 127.0.0.1:55499:5432 postgres:16
  ```

## Review Focus

1. **Blank vs zero.** A 1972 row with an empty `steals` cell must store `NULL` and render `—`. A real `0` must store `0`. Owner: Task 4 test `keeps blank cells null and real zeros zero`.
2. **2019–20 games already stored under a legacy balldontlie `nba_game_id`.** Inserting the Kaggle copy hits `uq_games_date_home_away`. The import must reuse that row (and backfill its NBA ID), not crash or duplicate. Owner: Task 7 test `reuses a game stored under a legacy id`.
3. **Two players with the same name and no birthdate**, for example two "Charles Smith" rows. They must be reported, never merged. Owner: Task 5 test `reports same-name players without birthdates as ambiguous`.
4. **Seasons with only Clippers games** (1970–95) must never count as league seasons. That covers `league_season` highs and `resolveRecordsStart`. Owner: Task 9 tests.
5. **Interrupting and re-running the import** must leave no duplicate rows and must not rewrite seasons that are already complete. Owner: Task 7 test `is idempotent across a re-run`.

---

## PR 1: Storage cleanup (merge and run before anything else)

### Task 1: Null the player `raw_payload`, compact the table, and remove the legacy writer

**Files:**
- Create: `scripts/cleanup-player-raw-payload.ts`
- Create: `scripts/lib/id-batches.ts`
- Test: `scripts/lib/id-batches.test.ts`
- Modify: `scripts/lib/upserts.ts`: delete `upsertBoxScoresForGame` (lines 345–473; nothing calls it) and any imports it alone used
- Modify: `package.json`: add the script `"cleanup-player-raw-payload": "node --env-file-if-exists=.env.local node_modules/.bin/tsx scripts/cleanup-player-raw-payload.ts"`

**Interfaces:**
- Produces: `idBatches(minId: number, maxId: number, size: number): Array<[number, number]>`, inclusive ranges that cover min..max.

- [ ] **Step 1: Write the failing test**, `scripts/lib/id-batches.test.ts`:
  ```ts
  it('covers the range in inclusive batches', () => {
    expect(idBatches(1, 25, 10)).toEqual([[1, 10], [11, 20], [21, 25]]);
  });
  it('returns nothing for an empty range', () => {
    expect(idBatches(10, 9, 5)).toEqual([]);
  });
  ```
- [ ] **Step 2:** `npx vitest run scripts/lib/id-batches` → FAIL (module not found).
- [ ] **Step 3: Implement `idBatches`.** Then write the cleanup script:
  - With `--dry-run`, print table and database size and the count of rows with `raw_payload IS NOT NULL`, then exit.
  - Otherwise, run `UPDATE game_player_box_scores SET raw_payload = NULL WHERE game_player_box_score_id BETWEEN $1 AND $2 AND raw_payload IS NOT NULL` per batch of 20,000 IDs, then `VACUUM FULL game_player_box_scores` (outside a transaction), and print sizes before and after.
  - Refuse to run when `app_kv 'live:last_poll_at'` is within the last 30 minutes, so it never runs during a game.
- [ ] **Step 4:** `npx vitest run scripts/lib/id-batches` → PASS.
- [ ] **Step 5: Confirm nothing reads player `raw_payload`.** Run `grep -rn "raw_payload" app src scripts | grep -v "\.test\."`. The remaining hits should be odds, team box scores and `upserts.ts:548` (which writes NULL). There should be no reads of `game_player_box_scores.raw_payload`.
- [ ] **Step 6: Run the checks.** `npm test && npm run build` → both pass.
- [ ] **Step 7: Commit, open the PR, and merge once CI is green**, per the CCC shipping rule.
  ```bash
  git add scripts/cleanup-player-raw-payload.ts scripts/lib/id-batches.ts scripts/lib/id-batches.test.ts scripts/lib/upserts.ts package.json
  git commit -m "chore(db): cleanup script for unused player raw_payload; drop legacy bdl box upsert"
  ```
- [ ] **Step 8: Run against prod, outside a game window.**
  1. Back up: `pg_dump "$DATABASE_URL" -t game_player_box_scores -Fc -f ~/ccc-backups/gpbs-2026-11-17.dump` (create `~/ccc-backups` first; this is outside the repo).
  2. `npm run cleanup-player-raw-payload -- --dry-run`, then `npm run cleanup-player-raw-payload`.
  3. Expected: the table goes from about 215 MB to about 30 MB, and the database from about 381 MB to about 205 MB. Paste the before and after figures into the PR.

---

## PR 2: Game history

### Task 2: Shared NBA team IDs and the era table

**Files:**
- Create: `scripts/lib/nba-teams.ts`. Move `NBA_TEAM_IDS` here from `scripts/lib/espn-live-client.ts`, and have `espn-live-client.ts` re-import it.
- Create: `scripts/lib/history/team-eras.ts`
- Test: `scripts/lib/history/team-eras.test.ts`

**Interfaces:**
- Produces:
  - `NBA_TEAM_IDS: Record<string, number>` (tricode → NBA franchise ID).
  - `TRICODE_BY_NBA_ID: Record<number, string>`.
  - `interface TeamEra { franchiseTricode: string; firstSeason: number; lastSeason: number | null; abbreviation: string; city: string; name: string }`.
  - `TEAM_ERAS: TeamEra[]`.
  - `resolveEra(franchiseTricode: string, seasonId: number): TeamEra | null`.

`TEAM_ERAS` covers every franchise from 1970 on. `franchiseTricode` is the current tricode. Among them:
- BUF Braves 1970–77, SDC Clippers 1978–83, LAC 1984–.
- SEA SuperSonics –2007, then OKC.
- CIN Royals –1971, KCO Kansas City-Omaha Kings 1972–74, KCK Kings 1975–84, then SAC.
- SDR San Diego Rockets –1970, then HOU.
- SFW San Francisco Warriors –1970, then GSW.
- BAL Bullets –1972, CAP Capital Bullets 1973, WSB Washington Bullets 1974–96, then WAS.
- NYN 1976, NJN 1977–2011, then BKN.
- NOJ New Orleans Jazz 1974–78, then UTA.
- VAN Grizzlies 1995–2000, then MEM.
- CHH Hornets 1988–2001, NOH 2002–04, NOK 2005–06, NOH 2007–12, then NOP.
- CHA Bobcats 2004–13, then CHA Hornets.

Task 7 checks this list against every (franchise, season) pair in `Games.csv` and fails on any gap, so a missing era can't slip through.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it('names the Clippers by era', () => {
    expect(resolveEra('LAC', 1975)).toMatchObject({ abbreviation: 'BUF', city: 'Buffalo', name: 'Braves' });
    expect(resolveEra('LAC', 1980)).toMatchObject({ abbreviation: 'SDC', city: 'San Diego', name: 'Clippers' });
    expect(resolveEra('LAC', 2026)).toMatchObject({ abbreviation: 'LAC', name: 'Clippers' });
  });
  it('names relocated opponents by era', () => {
    expect(resolveEra('OKC', 1979)).toMatchObject({ abbreviation: 'SEA', name: 'SuperSonics' });
    expect(resolveEra('SAC', 1980)).toMatchObject({ abbreviation: 'KCK', name: 'Kings' });
  });
  it('has no overlapping or gapped eras per franchise from 1970', () => {
    for (const tri of Object.keys(NBA_TEAM_IDS))
      for (let s = 1970; s <= 2026; s++) {
        // Franchises that didn't exist yet in that season (e.g. Toronto before 1995) are skipped.
        if (franchiseStartSeason(tri) > s) continue;
        expect(resolveEra(tri, s), `${tri} ${s}`).not.toBeNull();
      }
  });
  ```
  Export `franchiseStartSeason(tri): number` from `team-eras.ts` for this test: the first season of the franchise's earliest era.
- [ ] **Step 2:** `npx vitest run scripts/lib/history/team-eras` → FAIL.
- [ ] **Step 3:** Implement `team-eras.ts` and `nba-teams.ts`, and update the `espn-live-client.ts` import.
- [ ] **Step 4:** `npx vitest run scripts/lib/history scripts/lib/espn-live-client` → PASS.
- [ ] **Step 5: Commit:** `feat(history): NBA team id map and franchise era table`.

### Task 3: Schema for the season tables and era names

**Files:**
- Create: `Docs/migrations/2026-11-history-archive.sql`
- Modify: `docs/DB_SCHEMA.sql`: append the same DDL

**Interfaces:**
- Produces these tables, used by Tasks 7, 10 and 11:
  - **`team_era_names`**:
    - Columns: `team_id BIGINT REFERENCES teams`, `first_season_id SMALLINT NOT NULL`, `last_season_id SMALLINT` (null = current), `abbreviation TEXT NOT NULL`, `city TEXT NOT NULL`, `name TEXT NOT NULL`.
    - PK `(team_id, first_season_id)`.
  - **`team_seasons`**:
    - Key columns: `season_id SMALLINT NOT NULL`, `nba_franchise_id INTEGER NOT NULL`, `team_id BIGINT REFERENCES teams` (nullable), `city TEXT`, `name TEXT NOT NULL`, `abbreviation TEXT`.
    - Record columns: `wins SMALLINT`, `losses SMALLINT`, `playoff_round SMALLINT` (0 = missed, 1–4 = reached the first round through the Finals), `won_title BOOLEAN`.
    - Stat columns: `games SMALLINT` plus regular-season totals (`points, fg_made, fg_attempted, fg3_made, fg3_attempted, ft_made, ft_attempted, rebounds, offensive_reb, defensive_reb, assists, steals, blocks, turnovers, fouls`) and the same set prefixed `opp_`. All `INTEGER`, nullable.
    - PK `(season_id, nba_franchise_id)`.
  - **`player_seasons`**:
    - Key columns: `season_id SMALLINT NOT NULL`, `season_type TEXT NOT NULL CHECK (season_type IN ('regular','playoffs'))`, `nba_person_id INTEGER NOT NULL`, `player_id BIGINT REFERENCES players` (nullable), `display_name TEXT NOT NULL`, `nba_franchise_id INTEGER` (null for the `TOT` row), `team_abbreviation TEXT NOT NULL` (era abbreviation, or `'TOT'`).
    - Stat columns: `games SMALLINT NOT NULL`, `games_started SMALLINT`, `minutes NUMERIC(7,1)`, then the team stat set, all nullable `INTEGER`.
    - Unique `(season_id, season_type, nba_person_id, team_abbreviation)`, and an index on `player_id`.
  - **`league_season_averages`**:
    - Columns: `season_id SMALLINT PRIMARY KEY`, `teams SMALLINT`, `games INTEGER`, per-team-game averages `ppg, rpg, apg, spg, bpg, tpg, fg_pct, fg3_pct, ft_pct, fg3a_per_game` (all `NUMERIC(6,3)`, nullable), `pace NUMERIC(6,2)` (nullable), and `ortg NUMERIC(6,2)` (nullable).
  - `INSERT INTO seasons (season_id, label)` for 1946–2018, with `ON CONFLICT DO NOTHING`.

- [ ] **Step 1: Write the migration.** Use `CREATE TABLE IF NOT EXISTS` throughout, with a header comment in the style of `2026-10-preseason.sql`.
- [ ] **Step 2: Apply it twice to the fixture DB:**
  ```bash
  psql postgres://postgres:postgres@127.0.0.1:55499/fixture -v ON_ERROR_STOP=1 -f docs/DB_SCHEMA.sql
  psql postgres://postgres:postgres@127.0.0.1:55499/fixture -v ON_ERROR_STOP=1 -f Docs/migrations/2026-11-history-archive.sql
  ```
  Run the second command once more. Expected: both runs exit 0.
- [ ] **Step 3: Commit:** `feat(db): history archive tables (team_era_names, team_seasons, player_seasons, league_season_averages)`.

### Task 4: Kaggle CSV reading and row mapping

**Files:**
- Modify: `package.json`: add the devDependency `csv-parse`
- Create: `scripts/lib/history/kaggle.ts`
- Create: `scripts/lib/__fixtures__/kaggle/Games.csv`, `PlayerStatistics.csv` and `Players.csv`. These are 3–6 hand-written rows each, covering a 1972 Braves game, a 2005 non-Clippers game, an All-Star game and a preseason game.
- Test: `scripts/lib/history/kaggle.test.ts`

**Interfaces:**
- Produces:
  - `streamCsv(path: string): AsyncIterable<Record<string, string>>`
  - `assertHeaders(file: string, headers: string[], required: string[]): void`: throws `Missing columns in <file>: a, b (found: …)`.
  - `type KaggleGame = { nbaGameId: number; seasonId: number; gameDate: string; homeFranchiseId: number; awayFranchiseId: number; homeScore: number; awayScore: number; isPlayoffs: boolean; homeCity: string; homeName: string; awayCity: string; awayName: string }`
  - `parseGame(row): KaggleGame | null`: returns `null` for preseason, All-Star and any game type other than regular, play-in or playoffs.
  - `type KagglePlayerGame = { nbaGameId: number; personId: number; firstName: string; lastName: string; isHome: boolean; starter: boolean | null; minutes: string | null; points; rebounds; assists; steals; blocks; turnovers; fouls; plusMinus; fgMade; fgAttempted; fg3Made; fg3Attempted; ftMade; ftAttempted; offReb; defReb }`. Every stat is `number | null`.
  - `parsePlayerGame(row): KagglePlayerGame`
  - `seasonIdOfGame(nbaGameId: number): number`
  - `minutesToClock(decimalMinutes: string): string | null`

Before writing `REQUIRED_*`, check the column names against the downloaded files (Task 12, step 1). The research summarized them without opening them.

- [ ] **Step 1: Write the failing tests** (values taken from the fixtures):
  ```ts
  it('keeps blank cells null and real zeros zero', () => {
    const p = parsePlayerGame(row({ steals: '', blocks: '0' }));
    expect(p.steals).toBeNull();
    expect(p.blocks).toBe(0);
  });
  it('converts decimal minutes to MM:SS and blank to null', () => {
    expect(minutesToClock('34.5')).toBe('34:30');
    expect(minutesToClock('')).toBeNull();
  });
  it('derives the season from the game id', () => {
    expect(seasonIdOfGame(27200123)).toBe(1972);
    expect(seasonIdOfGame(22501199)).toBe(2025);
  });
  it('skips preseason and All-Star games', () => {
    expect(parseGame(allStarRow)).toBeNull();
    expect(parseGame(preseasonRow)).toBeNull();
  });
  it('names missing columns', () => {
    expect(() => assertHeaders('Games.csv', ['gameId'], ['gameId', 'gameDate']))
      .toThrow('Missing columns in Games.csv: gameDate');
  });
  ```
- [ ] **Step 2:** `npx vitest run scripts/lib/history/kaggle` → FAIL.
- [ ] **Step 3: Implement.** `streamCsv` uses `csv-parse` with `{ columns: true, relax_column_count: true }` on `fs.createReadStream`. Every numeric cell goes through one helper: `'' → null`, otherwise `Number`.
- [ ] **Step 4:** `npx vitest run scripts/lib/history/kaggle` → PASS.
- [ ] **Step 5: Commit:** `feat(history): Kaggle CSV reader and row mappers`.

### Task 5: Player matching

**Files:**
- Create: `scripts/lib/history/match-players.ts`
- Test: `scripts/lib/history/match-players.test.ts`

**Interfaces:**
- Consumes: `normalizePersonName` from `scripts/lib/player-match.ts`.
- Produces:
  - `type KagglePerson = { personId: number; firstName: string; lastName: string; birthdate: string | null }`
  - `type DbPlayer = { player_id: string; nba_person_id: number | null; display_name: string; birthdate: string | null }`
  - `matchPlayers(people: KagglePerson[], db: DbPlayer[]): { matched: Map<number, string>; backfillNbaId: Array<{ player_id: string; nba_person_id: number }>; toCreate: KagglePerson[]; ambiguous: Array<{ person: KagglePerson; candidates: string[] }> }`

Matching rules, in order (spec §2):
1. Exact `nba_person_id`.
2. Normalized name plus equal birthdate.
3. Normalized name alone, only when exactly one DB row has that name, at most one Kaggle person has that name, and neither side has a conflicting birthdate.
4. No candidate → `toCreate`.
5. Two or more candidates → `ambiguous`.

A DB row is used by at most one person.

- [ ] **Step 1: Write the failing tests:**
  - `matches on nba_person_id first`
  - `matches name + birthdate and queues the NBA id backfill`
  - `matches a unique name without birthdate`
  - `reports same-name players without birthdates as ambiguous`: two DB rows named "Charles Smith", no birthdates → `ambiguous[0].candidates.length === 2`, and nothing in `matched`.
  - `never assigns one DB row to two people`
  - `creates unknown players`
- [ ] **Step 2:** `npx vitest run scripts/lib/history/match-players` → FAIL.
- [ ] **Step 3:** Implement `matchPlayers`.
- [ ] **Step 4:** `npx vitest run scripts/lib/history/match-players` → PASS.
- [ ] **Step 5: Commit:** `feat(history): player matching for Kaggle import`.

### Task 6: Season totals and the official-record check

**Files:**
- Create: `scripts/lib/history/season-totals.ts`
- Create: `scripts/lib/history/franchise-records.ts`: `FRANCHISE_RECORDS: Array<{ seasonId: number; wins: number; losses: number }>`, the official regular-season W-L for 1970–2025, hand-entered.
- Test: `scripts/lib/history/season-totals.test.ts`

**Interfaces:**
- Consumes: `KaggleGame` and `KagglePlayerGame` (Task 4), and `resolveEra` (Task 2).
- Produces:
  - `aggregatePlayerSeasons(games: KaggleGame[], rows: KagglePlayerGame[]): PlayerSeasonRow[]`
  - `aggregateTeamSeasons(games: KaggleGame[], rows: KagglePlayerGame[]): TeamSeasonRow[]`
  - `leagueAverages(teamSeasons: TeamSeasonRow[]): LeagueAverageRow[]`
  - `compareFranchiseRecords(teamSeasons: TeamSeasonRow[]): Array<{ seasonId: number; computed: string; official: string }>`, which returns mismatches only.
  - Row types mirror the Task 3 columns in camelCase.

Rules:
- A stat total is `null` if any counted game has `null` for it.
- `gamesStarted` is `null` if any game has `starter === null`.
- Mid-season trades produce one row per franchise plus a `TOT` row.
- `playoffRound` is the deepest round with a playoff game: round = 1 + the series digit in the game ID's round position. Verify this against the 1997 and 2021 playoffs.
- `wonTitle` = won the last game of round 4.
- `pace` and `ortg` are `null` when turnovers or offensive rebounds are `null`.

- [ ] **Step 1: Write the failing tests:**
  - `nulls a season total when any game lacks the stat`: two games, steals `[2, null]` → `steals: null`, `points` summed.
  - `splits a traded player into per-team rows plus TOT`
  - `counts wins and losses from final scores`
  - `reports a W-L mismatch against the official record`
  - `has an official record for every Clippers season 1970–2025`: `FRANCHISE_RECORDS.length === 56`, seasons contiguous.
- [ ] **Step 2:** `npx vitest run scripts/lib/history/season-totals` → FAIL.
- [ ] **Step 3:** Implement both files.
- [ ] **Step 4:** `npx vitest run scripts/lib/history/season-totals` → PASS.
- [ ] **Step 5: Commit:** `feat(history): season aggregation and franchise record check`.

### Task 7: The import script

**Files:**
- Create: `scripts/import-kaggle-history.ts`
- Create: `scripts/lib/history/import-plan.ts`: pure helpers for load order and the guard
- Create: `scripts/lib/history/write.ts`: database writers
- Test: `scripts/lib/history/import-plan.test.ts` and `scripts/lib/history/import.integration.test.ts` (skipped unless `FIXTURE_DATABASE_URL` is set, like `pipeline.integration.test.ts`)
- Modify: `package.json`: add `"import-kaggle-history"` in the same style as `backfill-history`
- Modify: `.gitignore`: add `/data/`

**Interfaces:**
- Consumes: Tasks 2, 4, 5 and 6.
- Produces:
  - `planLoad(seasonsInFile: number[]): Array<{ seasonId: number; scope: 'clippers' | 'league' }>`: the spec's load order.
  - `guardAllows(currentBytes: number, estimatedBytes: number, capMb: number): boolean`: true when `current + estimate <= 0.85 × capMb × 1024²`.
  - `estimateBytes(playerRows: number, teamRows: number): number`: `playerRows × 250 + teamRows × 300`.
  - `writeSeasonGames(tx, games: KaggleGame[], playerRows: KagglePlayerGame[], ids: { teamIdByFranchise: Map<number, string>; playerIdByPerson: Map<number, string> }): Promise<{ inserted: number; skipped: number; reused: number }>`.

Behavior:
- **Flags:**
  - `--dir=` (required).
  - `--dry-run`: no writes. Prints, per season, the games and rows it would write, the bytes estimate, the unmatched and ambiguous players, any era gaps and any W-L mismatches. Writes `data/import-report.json`.
  - `--from=` and `--to=`.
  - `--only=games|seasons`.
  - `--cap-mb=` (default 512).
- **Before writing:** run `assertHeaders` on each file. Fail if any (franchise, season) in `Games.csv` from 1970 on has no `resolveEra`.
- **Players:** run `matchPlayers` once over everyone the selected games reference. Insert `toCreate` with `is_active = false`, apply `backfillNbaId`, and skip rows for ambiguous people (their games still load).
- **Era names:** upsert `team_era_names` from `TEAM_ERAS`.
- **Seasons:** upsert `seasons` rows.
- **Per season, in `planLoad` order,** one transaction:
  1. Check the guard (`pg_database_size`). Stop cleanly with a summary if it fails.
  2. Upsert `all_games` on `nba_game_id`. If a row already exists on `(game_date, home_team_id, away_team_id)` under a different `nba_game_id`, reuse it and set its `nba_game_id` to the NBA ID.
  3. Skip games that already have player box scores.
  4. Insert team box scores (summed from player rows; `raw_payload = '{"source":"kaggle"}'`) and player box scores (`raw_payload` NULL).
- **Season tables:** rebuild them with a full replace inside one transaction.
- **At the end:** set `history:backfilled_through` (Global Constraints), then run `compute-stats` and `build-record-book` through `execFileSync`, as `backfill-history.ts` does. Print the final size.

- [ ] **Step 1: Write the failing unit tests:**
  - `orders Clippers seasons first, then league seasons newest first`: `planLoad([1970, 1996, 1997, 2018, 2019])` → `1970 clippers, 1996 clippers, 1997 clippers, 2018 clippers, 2019 league, 2018 league, 1997 league, 1996 league`. The 2019 league step fills gaps only.
  - `stops at 85 percent of the cap`: `guardAllows(400 MB, 40 MB, 512) === false`, `guardAllows(300 MB, 40 MB, 512) === true`.
- [ ] **Step 2: Write the failing integration tests** (fixture DB with the schema plus the Task 3 migration, seeded with `teams` rows for LAC and two opponents, and one LAC game stored under legacy `nba_game_id = 17195500` on a date that matches a fixture Kaggle game):
  - `imports a 1972 Braves game with nulls preserved`: the steals cell is `NULL`, and the team row's `raw_payload->>'source' = 'kaggle'`.
  - `reuses a game stored under a legacy id`: a single `all_games` row for that date and those teams, now with the NBA ID.
  - `is idempotent across a re-run`: running twice leaves the same row counts.
  - `never writes preseason or All-Star games`.
- [ ] **Step 3:** `npx vitest run scripts/lib/history/import-plan` → FAIL. Then `FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55499/fixture npx vitest run scripts/lib/history/import` → FAIL.
- [ ] **Step 4:** Implement `import-plan.ts`, `write.ts` and the script.
- [ ] **Step 5:** Run both test commands from Step 3 → PASS. Then `npm test` → PASS.
- [ ] **Step 6: Commit:** `feat(history): Kaggle history import script`.

### Task 8: Keep the nightly jobs off old games

**Files:**
- Modify: `scripts/compute-stats.ts:282-290`
- Modify: `scripts/backfill-periods.ts:22-33`
- Test: extend `scripts/lib/history/import.integration.test.ts`

**Interfaces:** none new.

- **compute-stats:** add `AND (g.season_id >= ${FULL_ROLLING_FIRST_SEASON} OR lac.team_id IN (g.home_team_id, g.away_team_id))` to the games query, with `JOIN teams lac ON lac.abbreviation = 'LAC'`.
- **backfill-periods:** skip team rows whose `raw_payload->>'source' = 'kaggle'`. Without this, the nightly post-game job would retry about 4,400 old games against cdn.nba.com forever.

- [ ] **Step 1: Write the failing integration test** `computes advanced stats only for Clippers games before 2019`. After the import plus `compute-stats`, a 2005 non-Clippers fixture game has no `advanced_team_game_stats` rows, and a 1985 Clippers game does.
- [ ] **Step 2:** Run the fixture test → FAIL.
- [ ] **Step 3:** Make both query edits.
- [ ] **Step 4:** Run the fixture test → PASS. Then `grep -n "source" scripts/backfill-periods.ts` should show the new filter.
- [ ] **Step 5: Commit:** `fix(stats): limit pre-2019 derived stats to Clippers games; periods backfill skips Kaggle rows`.

### Task 9: Record book eras

**Files:**
- Modify: `scripts/lib/record-book/highs.ts`
- Modify: `scripts/lib/record-book/records-start.test.ts`
- Test: `scripts/lib/record-book/highs.test.ts`

**Interfaces:**
- Produces:
  - `HighSpec.firstSeason: number`, required on every spec.
  - `STAT_FIRST_SEASON: Record<string, number>`, using the values in Global Constraints.

Changes:
- `buildHighsSql` adds `AND s.game_date >= '<firstSeason>-08-01'` to its outer `WHERE`.
- The `league_season` sources add `AND g.season_id IN (SELECT season_id FROM games GROUP BY season_id HAVING COUNT(*) >= ${MIN_COMPLETE_GAMES})`, importing `MIN_COMPLETE_GAMES` from `records-start.ts`.
- Quarter and half highs (play-by-play) take `firstSeason: 1996`.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it('starts steals and blocks at 1983-84 and points at 1970-71', () => {
    const stl = HIGH_SPECS.find((s) => s.scope === 'lac_player' && s.statKey === 'stl')!;
    const pts = HIGH_SPECS.find((s) => s.scope === 'lac_player' && s.statKey === 'pts')!;
    expect(buildHighsSql(stl)).toContain(`s.game_date >= '1983-08-01'`);
    expect(buildHighsSql(pts)).toContain(`s.game_date >= '1970-08-01'`);
  });
  it('builds league-season highs only from complete league seasons', () => {
    for (const s of HIGH_SPECS.filter((x) => x.scope === 'league_season'))
      expect(s.source).toContain('HAVING COUNT(*) >= 700');
  });
  ```
  In `records-start.test.ts`, add `never counts a Clippers-only season as complete`: coverage `[{season_id: 1975, games_with_box: 82}, {season_id: 1996, games_with_box: 1189}]` → `1996`.
- [ ] **Step 2:** `npx vitest run scripts/lib/record-book` → FAIL.
- [ ] **Step 3:** Implement the changes.
- [ ] **Step 4:** `npx vitest run scripts/lib/record-book` → PASS. The existing `passes exactly the parameters each query references` test must still pass, so add no new bind parameters.
- [ ] **Step 5: Commit:** `feat(record-book): start each stat where it became reliable; league highs only from complete seasons`.

### Task 10: History API carries era names

**Files:**
- Modify: `src/lib/data/history-seasons.ts`
- Modify: `src/lib/data/history-games.ts`
- Modify: `src/lib/data/history-game.ts`
- Modify: `src/lib/ui/season.ts`
- Test: `src/lib/api-history.test.ts`, following its existing `vi.mock('./db.js')` pattern

**Interfaces:**
- Produces these API fields, which Task 11 relies on:
  - seasons: `{ season_id, label, team_name: string }`, the Clippers' era name for that season, e.g. "Buffalo Braves".
  - games: each game adds `opponent_name: string` and `lac_abbr: string`, and `opponent_abbr` becomes the era abbreviation.
  - game: `home_team` and `away_team` each gain `name: string`, and their `abbreviation` becomes the era abbreviation.
  - `HistoryGame` in `src/lib/ui/season.ts` gains `opponent_name?: string; lac_abbr?: string`.
- Era lookup, for alias `t` and season `g.season_id`:
  ```sql
  LEFT JOIN team_era_names e ON e.team_id = t.team_id
   AND g.season_id >= e.first_season_id
   AND (e.last_season_id IS NULL OR g.season_id <= e.last_season_id)
  ```
  Fall back with `COALESCE(e.abbreviation, t.abbreviation)` and `COALESCE(e.name, t.name)`. Modules under `src/` import without a `.js` suffix.

- [ ] **Step 1: Write the failing tests** with mocked rows:
  - `returns the era opponent name and abbreviation`: a 1979 game against SEA → `opponent_abbr: 'SEA'`, `opponent_name: 'SuperSonics'`, `lac_abbr: 'SDC'`.
  - `labels seasons with the Clippers era name`.
- [ ] **Step 2:** `npx vitest run src/lib/api-history` → FAIL.
- [ ] **Step 3:** Implement the joins and fields.
- [ ] **Step 4:** `npx vitest run src/lib/api-history` → PASS.
- [ ] **Step 5: Commit:** `feat(history-api): era team names and abbreviations`.

### Task 11: History UI for old eras

**Files:**
- Modify: `components/history/SeasonSelect.tsx`
- Modify: `components/history/GameList.tsx`
- Modify: `components/history/SeasonStrip.tsx`
- Modify: `app/history/[game_id]/page.tsx`
- Modify: `app/history/page.tsx`: pass `team_name` through to `SeasonSelect`
- Modify: `src/lib/ui/teams.ts`
- Test: `src/lib/ui/teams.test.ts` (create) and `src/lib/ui/season-groups.test.ts` (create)

**Interfaces:**
- Consumes: the Task 10 fields.
- Produces:
  - `teamName(abbr, eraName?: string | null): string`: returns `eraName` when given, otherwise the current lookup.
  - `groupSeasonsByEra(seasons: Array<{ season_id: number; label: string; team_name: string }>): Array<{ label: string; seasons: … }>`, in `src/lib/ui/season-groups.ts`. Groups are newest first, and each group is labeled `"<team_name> (<first season start year>–<last season end year, 2 digits>)"`, e.g. `"Buffalo Braves (1970–78)"` for seasons 1970–1977. The group holding the latest season gets an open end: `"Los Angeles Clippers (1984–)"`.

UI behavior:
- **`SeasonSelect`** renders one `<optgroup>` per group.
- **`GameList` and `SeasonStrip`** use `teamName(g.opponent_abbr, g.opponent_name)`. `TeamLogo` gets the era `opponent_abbr`, so old tricodes fall back to the neutral badge automatically through the `KNOWN` set. Leave `KNOWN` as it is.
- **Game page:**
  - The Clippers side uses `lac_abbr` and the era name.
  - `LineScore` already hides on empty periods.
  - When `season_id < 1983`, show the note `Box score from historical records; some stats weren't tracked in this era.` under the box score eyebrow, in the existing muted note style.
  - `BoxScore` already renders `null` as `—` and drops the starter split when nobody is a starter. Check that its totals row doesn't sum `null` as `0`. If it does, make a column's total `—` whenever any player cell in that column is `null`.

- [ ] **Step 1: Write the failing tests:**
  - `teamName('SEA', 'SuperSonics') === 'SuperSonics'`
  - `teamName('OKC') === 'Thunder'`
  - `groupSeasonsByEra` turns seasons 1976, 1977, 1978, 1984 and 2026 into three groups in order, labeled `Los Angeles Clippers (1984–)`, `San Diego Clippers (1978–79)` and `Buffalo Braves (1976–78)`.
- [ ] **Step 2:** `npx vitest run src/lib/ui` → FAIL.
- [ ] **Step 3:** Implement the changes.
- [ ] **Step 4:** `npx vitest run src/lib/ui` → PASS. Then `npm run build` → PASS.
- [ ] **Step 5: Check the pages** on a local dev server pointed at the fixture DB with imported fixtures:
  - The `/history` season picker shows era groups.
  - A Braves game shows "BUF" and "SEA" badges, `—` for missing steals, no line score, and the era note.
  - A 2025 game is unchanged.
  - Take screenshots of all three.
- [ ] **Step 6: Commit:** `feat(history-ui): era names, grouped season picker, old-era box score handling`.

### Task 12: Run the import and verify (operational)

- [ ] **Step 1 (Luke):** Download the [eoinamoore dataset](https://www.kaggle.com/datasets/eoinamoore/historical-nba-data-and-player-box-scores) and unzip it into `data/kaggle/`. Check its CSV headers against Task 4's `REQUIRED_*`, and fix the mappers if any differ.
- [ ] **Step 2 (Luke):** Check this Neon project's storage cap in the dashboard, and note it for `--cap-mb`.
- [ ] **Step 3: Apply the migration to prod.** Run the `db-migrate.yml` workflow with `file=2026-11-history-archive.sql` and `confirm=migrate`.
- [ ] **Step 4: Dry run.** `npm run import-kaggle-history -- --dir=data/kaggle --dry-run --cap-mb=<cap>`.
  - Expected: about 82 Clippers games for most seasons (fewer in lockout and COVID years), and 1,189–1,320 league games per season from 1996.
  - No era gaps.
  - The ambiguous-player list is reviewed. Fix each by setting `players.nba_person_id` by hand, then re-run the dry run.
  - The total estimate is about 420 MB or less on a 512 MB cap.
- [ ] **Step 5: Real run,** outside a game window, with the same command minus `--dry-run`. It should print the seasons loaded, `backfilled_through`, and the final DB size.
- [ ] **Step 6: Verify:**
  - Spot-check 5 games against Basketball-Reference: one each from 1970–71, 1979–80, 1984–85, 1996–97 and 2005–06. Check the score, the top scorer's line, and which cells are null versus 0.
  - Review the W-L mismatch report; every mismatch should be a known gap.
  - The final DB size should be within 20% of the estimate.
- [ ] **Step 7: Ship.** Open PR 2 with screenshots and the import report summary, merge when CI is green, and confirm the deploy. Then remove the worktree, if one was used.
