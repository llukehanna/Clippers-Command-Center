# History Archive, Part 1: Storage Cleanup and Game History (Design Spec)

*2026-11-17. The first of three history projects. Part 2 covers player history (an all-time roster and career profiles). Part 3 covers transactions (draft, lottery, trades, signings and salaries). Each part gets its own spec.*

## Why

The app has two jobs. The first is a command center for following the current season. The second is a deep archive of Clippers history. That second half is mostly missing right now:

- Clippers games only go back to 2019–20, and 2019–20 is only partly loaded: 54 Clippers games and 720 league games.
- Former players have empty profiles.
- There's no draft or transaction history at all.

Luke wants a fan to be able to look up a specific old game, look up a specific former player, or browse franchise eras. Any of the three should work.

This part loads the game data that everything else builds on, and frees up the storage it needs.

## Goals

1. Load every Clippers game from 1970–71 (the Buffalo Braves) to the present, with player box scores for both teams.
2. Load every league game from 1996–97 to the present with player box scores. 2019 onward is already loaded except for the 2019–20 gaps.
3. Load league season totals from 1946–47 to the present: team seasons with standings, player seasons, and league averages.
4. Make the History page, its season picker and the game page work for every loaded season, using each era's team names.
5. Stay within Neon's free tier. Shrink the current database before adding anything.

## Non-goals

- Player pages, an all-time roster and career views. That's Part 2, which reads this part's data.
- Transactions, the draft, contracts and the lottery. That's Part 3.
- Play-by-play for old games. It's about 0.4 GB for Clippers games alone and about 5 GB league-wide. It's deferred, and will probably live as static files on Cloudflare R2.
- Per-game league rows before 1996–97. The research found that game-level league records from before 1983–84 are unreliable, because steals, blocks, turnovers and minutes are incomplete. Season totals cover league ranks and comparisons instead.
- A recurring sync from Kaggle. The import runs once. The existing nightly job keeps handling the current season.

## Anti-goals (it fails even if it technically works)

- **An old game shows `0` for a stat nobody recorded.** For example, 0 steals in 1972. Untracked stats must show as `—`.
- **A 1975 game reads "LAC vs OKC".** It should read "Buffalo Braves vs Seattle SuperSonics".
- **The import silently pushes Neon past its storage cap.** Writes would start failing in the middle of a live game.
- **Insights start making claims from incomplete eras**, such as "first time since 1972" built on patchy data.
- **The import damages current-season data** or the live pipeline.

## Constraints and research findings

- **Storage:** the database is 381 MB.
  - About 175 MB of that is `game_player_box_scores.raw_payload`, a roughly 1 KB JSON copy of each row. Nothing reads it, and `scripts/lib/upserts.ts:548` already writes NULL there for new rows.
  - `game_team_box_scores.raw_payload` is different: `history-game.ts` reads it for line scores, so it stays.
  - Neon's free tier is now reportedly 1 GB per project and 20 GB per account ([neon.com/pricing](https://neon.com/pricing)). It was 0.5 GB when this project started. We don't know which cap this project is on, so the plan budgets for 0.5 GB and checks the real cap before importing.
- **stats.nba.com is unreachable from Luke's Mac.** It timed out after 20 seconds on 2026-11-17. That rules out `scripts/backfill-history.ts` as the main route; it stays available as an optional second pass that adds detail.
- **The source is the [eoinamoore Kaggle dataset](https://www.kaggle.com/datasets/eoinamoore/historical-nba-data-and-player-box-scores).**
  - License CC0, updated nightly, built from NBA.com.
  - Files: `Games.csv` (11 MB), `PlayerStatistics.csv` (392 MB, every game since 1946–47), `TeamStatistics.csv` (36 MB), and `Players.csv`.
  - It uses NBA.com game, person and team IDs.
  - The author mentions "a few gaps".
  - Luke downloads it by hand, since Kaggle needs a sign-in.
- **Data completeness by era** (from Basketball-Reference's coverage table):
  - Points, FG and FT are complete for every era.
  - Steals and blocks start in 1973–74, turnovers in 1977–78 and 3-pointers in 1979–80; all are patchy at first.
  - Every box-score category is complete from 1983–84.
  - Starters are recorded from 1975–76.
  - There are no quarter-by-quarter scores for older games in this dataset.
- **IDs:**
  - `teams` and `players` are keyed by balldontlie IDs. `teams.nba_team_id` holds 1–30 for current franchises, plus 15 defunct 1940s–50s teams. It does not hold NBA.com's `1610612746`-style IDs.
  - Only 1,217 of 5,635 `players` rows have `nba_person_id`. `scripts/lib/player-match.ts` already normalizes names for matching across sources.
- **How records and insights start:** `resolveRecordsStart` treats a season as "complete" at 700 or more regular-season games with box scores, and uses `app_kv 'history:backfilled_through'` as a floor. Seasons that only have Clippers games (fewer than 100 games) never count, which is what we want.
- **Derived tables are expensive:** `advanced_player_game_stats` is about 170 bytes per row and `rolling_player_stats` is 67 MB for 7 seasons. Computing both for every league game since 1996 would roughly double the import's storage.

## Approaches considered

| Approach | Trade-off | Decision |
|---|---|---|
| **A. Bulk-import the Kaggle CSVs into the existing tables** | Existing pages pick up old seasons with almost no changes. Covers 1970 to 1996, which no live NBA endpoint can. Costs an ID-matching step plus manual download and data checks. | **Chosen (Luke)** |
| B. Run the existing stats.nba.com backfill | Already written, and gives the most detail (starters, quarter scores, tip times). But it's blocked from this machine and can't reach before 1996–97. | Kept as an optional later pass to add detail to 1996-and-later Clippers games |
| C. A separate history store (R2 files or a second Neon project) | Keeps the main DB small, but every page needs a new way to read data. All the data in this part fits without it. | Saved for play-by-play |

## Design

### 0. Storage cleanup (ships first, on its own)

- Set `raw_payload` to NULL on every `game_player_box_scores` row, then run `VACUUM FULL game_player_box_scores` to reclaim the space. Expected result: the table goes from about 215 MB to about 30 MB, and the database to about 205 MB.
- **Before running it:** do a one-time `pg_dump` of the table to a local file, as a safety net.
- **Timing:** `VACUUM FULL` locks the table, so run it outside a game window.
- Confirm by `grep` that no code reads player `raw_payload`. As of today only the team table's copy is read.
- `upsertBoxScoresForGame` in `scripts/lib/upserts.ts` (the old balldontlie path) still writes the full player JSON. Nothing calls it, so delete it, so it can't undo the cleanup.
- Record the size before and after in the PR.

### 1. Schema additions (in `docs/DB_SCHEMA.sql` plus a migration file in `docs/migrations/`)

- **`team_era_names`**: `(team_id, first_season_id, last_season_id, city, name, abbreviation)`.
  - Built from the per-game city and team name in `Games.csv`. For example: Buffalo Braves 1970–77, San Diego Clippers 1978–83, Los Angeles Clippers 1984 on.
  - A SQL function or helper resolves a team's display name for a given season. The History list and game page use it. Current-season screens are unaffected, because the current era name matches `teams`.
- **`seasons`**: add rows for 1946 through 2018. The table currently holds 2019–2026, and `all_games.season_id` points at it.
- **`team_seasons`**:
  - Key: `(season_id, nba_franchise_id)`.
  - Columns: `team_id` (nullable, for defunct franchises with no `teams` row), city and name as written that season, wins, losses, playoff result if available, and regular-season totals for the team and its opponents.
  - About 1,700 rows.
- **`player_seasons`**:
  - One row per player, team, season and season type (regular or playoffs). A player traded mid-season gets one row per team, plus a `TOT` row.
  - Columns: games played, games started (null before 1975–76), and totals. Untracked stats are null, never 0.
  - `player_id` is nullable, with `nba_person_id` and `display_name` always set, because Part 2 decides how far to create `players` rows for non-Clippers players from long ago.
  - Under 60k rows.
- **`league_season_averages`**: one row per season with per-game and per-100-possession league averages (where possessions can be computed). These are used for era context.
- **How the season tables are built:** all three are summed from the Kaggle game rows. No source in this part provides season totals directly.
  - **Wins and losses** come from final scores, which are recorded for every game in every era.
  - **Playoff result** is the deepest round with a playoff game, plus whether the team won the title.
  - **Games started** is the count of `starter = true`. It's null for any season where starters weren't recorded.
  - **Player stat totals:** a stat is null unless it's present for every game the player played that season. A partly tracked stat must not show up as an undercounted total.
  - **Official record check:** the import compares computed Clippers W-L with a short hand-entered list of official franchise records (`scripts/lib/history/franchise-records.ts`, 57 rows). A mismatch is reported as a missing-games gap. The official W-L is not written over the computed one, so the gap stays visible and can be fixed.
- **`players`**: no new columns. `nba_person_id` already exists. Filling it in is part of the import (§2).

### 2. Import script: `scripts/import-kaggle-history.ts` (runs locally)

- **Running it:** `npm run import-kaggle-history -- --dir=<path>`.
  - Luke unzips the dataset into a gitignored folder (`data/kaggle/`).
  - Supported flags: `--dry-run`, which writes nothing and prints counts, storage estimates and unmatched players; `--from`/`--to` to limit the season range; and `--only=games|seasons`.
- **Reading the CSVs:** stream them row by row, because `PlayerStatistics.csv` is 392 MB.
- **What gets loaded:**
  - Every Clippers game (franchise ID `1610612746`) from 1970–71 on, regular season and playoffs.
  - Every league game from 1996–97 on.
  - It skips any game whose `nba_game_id` already has player box scores, so existing 2019-and-later data isn't touched.
  - It fills the 2019–20 gaps.
- **Teams:** a static map from NBA franchise ID to our `teams.team_id` via tricode. The live code already has a tricode → NBA ID table in `scripts/lib/espn-live-client.ts`, so reuse or extract it. Relocated franchises map to their current team row, with the era name coming from `team_era_names`.
- **Players** (`nba_person_id` → `player_id`):
  1. Match exactly on `nba_person_id`.
  2. Otherwise match on normalized name (`player-match.ts`) plus birthdate from `Players.csv`. If birthdate is missing, accept a name match only when it's unique.
  3. Otherwise create a new `players` row with `nba_person_id` set and `is_active = false`.
  4. Ambiguous cases, such as two players with the same name and no birthdate, go to a report file and are skipped. They're never guessed. The dry run lists them so they can be fixed by hand before the real run.
- **Rows written:**
  - `all_games`: status `final`, `is_playoffs` from the game type, `start_time_utc` null when unknown. Preseason and All-Star games are skipped.
  - `game_team_box_scores`: `raw_payload` holds only `{ "source": "kaggle" }`. There are no `periods`, so the game page shows no line score.
  - `game_player_box_scores`: `raw_payload` NULL. `starter` is null where unknown. Untracked stats are null by era. The import must not turn a blank CSV cell into 0 (see the anti-goals). `minutes` is converted to the existing "MM:SS" text format.
- **Idempotency:** writes use the existing upsert conflict keys, one transaction per season, so an interrupted run can simply be re-run.
- **Storage guard:** before each season, check `pg_database_size`. Stop with a clear message if the next season's estimated size would push the database past 85% of a `--cap-mb` value (default 512).
  - **Before the first real run:** Luke checks the project's storage cap on the Neon dashboard. If it's 1 GB, he runs with `--cap-mb=1024`.
  - **If it's still 0.5 GB:** everything except the oldest league per-game seasons fits. The guard stops the import cleanly where it runs out, and the summary says which seasons were skipped.
- **Load order** (so a stop partway through keeps the most valuable data):
  1. Clippers games, 1970 through 2018.
  2. The 2019–20 gaps.
  3. The season tables.
  4. League per-game seasons, newest first (2018–19 back to 1996–97).
- **After the import:**
  - Set `app_kv 'history:backfilled_through'` to the oldest league season that loaded completely, not a hard-coded 1996.
  - Run `compute-stats`.
  - Run `build-record-book`.
  - Records and insights then start at 1996–97, through the existing `resolveRecordsStart`.

### 3. Derived stats scope

- `compute-stats` computes advanced and rolling stats for **Clippers games only** before 2019–20. From 2019 on it stays league-wide, as today.
- `compute-stats` gets a season and team filter in the query that finds games without advanced rows, so it doesn't compute about 125 MB of advanced rows for non-Clippers games nobody displays.
- League ranks for older seasons come from `team_seasons` and `player_seasons` instead.

### 4. Pages

- **History season picker** (`loadHistorySeasons`): lists every season with a final Clippers game, so 1970–71 through 2026–27. With 57 seasons, the select should group them by franchise era (Buffalo, San Diego, Los Angeles). It should not become a 57-item flat list.
- **History list and season strip:** show era team names for both the Clippers and their opponents. Season summary and streaks are unchanged.
- **Old teams' look (Luke):**
  - **Badge:** a team whose era tricode isn't one of today's 30 (BUF, SDC, SEA, KCK, NJN, VAN, …) shows the neutral fallback badge with that era's tricode, never the current franchise's logo. That includes the Clippers' own Buffalo and San Diego years.
  - **Name:** the era's short name, in the same style as today's UI ("vs SuperSonics").
  - **Where the change goes:** `TeamLogo` (`components/ui/team-mark.tsx`) and `teamName()` (`src/lib/ui/teams.ts`) take the era tricode and name from `team_era_names`.
  - **Later:** proper historical logos are a possible future add-on and out of scope here.
- **Game page** (`history/[game_id]`), for old games:
  - Hide the line score when there's no `periods` data, rather than showing an empty grid.
  - Show `—` for null stats.
  - Hide the starters/bench split when `starter` is null.
  - Hide sections with no data (game flow, play-by-play, win probability), rather than showing empty panels.
  - Add a small note, "Box score from historical records; some stats weren't tracked in this era", for games before 1983–84.
- **Insights:** no changes beyond the records-start floor. Add a test that a season with only Clippers games never counts as complete.

### 4b. Record book: start each stat where it became reliable

- **The problem:** today the record book's Clippers single-game highs and team streaks have no season limit. Once the import runs, they'd rebuild back to 1970, and patchy early steals, blocks and 3-pointers would land on the leaderboards.
- **The fix:** each high gets a first counted season.
  - Points, field goals, free throws, team points, margin and team streaks: from 1970–71, when franchise records begin.
  - Rebounds and assists: from 1973–74.
  - 3-pointers made: from 1979–80.
  - Steals, blocks and turnovers: from 1983–84.
- This lives as a `firstSeason` field on each `HIGH_SPECS` entry in `scripts/lib/record-book/highs.ts`, and the highs query applies it.
- Player streaks keep the current "relevant players" scope.
- **What a fan sees:** franchise records for points go back to the Braves, and nothing claims a 1972 steals record.

### 5. Verification

- **Dry run:** row counts per season should be about 82 or more Clippers games for most seasons, and 1,189–1,320 league games per season from 1996. Check the unmatched-player list and the storage estimate.
- **Spot-check** 5 games against Basketball-Reference box scores: 1970–71, 1979–80, 1984–85, 1996–97 and 2005–06. Check the score, the top scorer's line, and which cells are null versus 0.
- **Season check:** Clippers W-L for every season from 1970 should match the franchise's official record.
- **Size:** the database size after import should be within 20% of the estimate (about 420 MB total before derived stats).
- `npm run build` and `npm test` pass, and the pages render for one game from each era.

## Decisions

| Decision | Choice | Who |
|---|---|---|
| Data scope | The list in §Goals | Luke (approved list) |
| Source | Kaggle bulk import (Approach A) | Luke |
| Basketball-Reference | Used only to spot-check data here; scraping is a Part 3 matter | Luke (approved the list, which names BBRef for Part 3) |
| Same tables vs separate archive tables | Same tables, lean rows | Claude (follows from A) |
| Era team names | New `team_era_names` table | Claude |
| Old teams' look | Neutral badge with the era tricode, plus the era's short name; no current logo on old-era teams | Luke |
| Derived stats before 2019 | Clippers games only | Claude (storage) |
| Storage guard default | 512 MB until the real cap is confirmed | Claude |
| Ambiguous player matches | Report and skip, never guess | Claude |
| Season totals before 1996 | Summed from game rows; a stat is null if any game is missing it; W-L checked against a hand list of official records | Claude (builder check) |
| Load order on a small cap | Clippers first, then 2019–20 gaps, season tables, league seasons newest-first | Claude (builder check) |
| Record book in old eras | Each high starts where its stat became reliable | Claude (builder check; follows the anti-goal) |

## Left to the builder

- Exact CSV column names. Check them against the downloaded files; the research summarized them and didn't open them.
- How playoff series and `gameType` values in `Games.csv` map to `is_playoffs`, and which ones (play-in, All-Star, preseason) to skip.
- Whether to extract the tricode → NBA franchise ID map into a shared module or duplicate it.
- The batch size for inserts. Keep each season's transaction under Neon's statement limits.
- The UI for the grouped season picker, within the existing design system (`components/history/SeasonSelect`).
