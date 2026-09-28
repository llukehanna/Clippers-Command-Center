# DATA_DICTIONARY.md

This dictionary describes the purpose, keys, and key fields for each MVP table in **Clippers Command Center (CCC)**.

All tables live in the default `public` schema.

---

## seasons

Stores season boundaries and labels.

**Primary key**
- `season_id` (SMALLINT): season start year (e.g., 2024 for 2024–25)

**Key fields**
- `label`: human label (`"2024-25"`)
- `start_date`, `end_date`: optional range

---

## teams

Canonical team records.

**Primary key**
- `team_id` (BIGSERIAL)

**Unique keys**
- `nba_team_id`: provider team ID

**Key fields**
- `abbreviation`: `"LAC"`
- `name`, `city`
- `conference`, `division`
- `is_active`

---

## players

Canonical player records.

**Primary key**
- `player_id` (BIGSERIAL)

**Unique keys**
- `nba_player_id`: provider player ID

**Key fields**
- `display_name`
- `position`
- `height_in`, `weight_lb`, `birthdate`
- `is_active`

---

## player_team_stints

Tracks roster membership over time.

**Primary key**
- `stint_id`

**Foreign keys**
- `player_id` → players
- `team_id` → teams
- `season_id` → seasons (optional)

**Key fields**
- `start_date`, `end_date`: nullable boundaries
- `jersey_number`

---

## games

Stores schedule + game state for all ingested league games.

**Primary key**
- `game_id`

**Unique keys**
- `nba_game_id`: provider game ID

**Foreign keys**
- `season_id` → seasons
- `home_team_id`, `away_team_id` → teams

**Key fields**
- `game_date`
- `start_time_utc`
- `status`: `"scheduled" | "in_progress" | "final"` (provider-specific string allowed)
- `home_score`, `away_score`
- `period`, `clock`
- `is_playoffs`
- `arena`

---

## game_team_box_scores

Final (or near-final) per-team box score lines per game.

**Primary key**
- `game_team_box_score_id`

**Unique**
- (`game_id`, `team_id`)

**Foreign keys**
- `game_id` → games
- `team_id` → teams

**Key fields**
- Standard counting stats (points, rebounds, assists, etc.)
- Shooting splits (FG/3PT/FT)
- `raw_payload` for provider-specific fields

---

## game_player_box_scores

Final (or near-final) per-player box score lines per game.

**Primary key**
- `game_player_box_score_id`

**Unique**
- (`game_id`, `player_id`)

**Foreign keys**
- `game_id` → games
- `team_id` → teams
- `player_id` → players

**Key fields**
- `starter`
- `minutes` stored as provider string (e.g., `"34:12"`) for MVP simplicity
- Standard counting stats and shooting
- `plus_minus`
- `raw_payload`

---

## live_snapshots

Dense snapshots captured during live games (polling roughly every ~12 seconds). Since Live v2, one compact row per period end and one at final (`payload.reason`), not one per poll.

**Primary key**
- `snapshot_id`

**Foreign keys**
- `game_id` → games

**Key fields**
- `captured_at`: CCC capture time
- `provider_ts`: provider time if present
- `period`, `clock`, `home_score`, `away_score` extracted for query speed
- `payload`: the full snapshot JSON for replay/debugging

---

## live_state

The game-night runner's latest derived state for a game — one row per game, rewritten whenever anything a fan would see changes and at least every 15 seconds. `/api/live` reads this row.

| Column | Meaning |
|---|---|
| `game_id` | `games.game_id` (primary key) |
| `seq` | Increments by one per saved change; a restarted runner continues from the stored value, and older writes are ignored |
| `state` | `LiveStateDoc` (`src/lib/types/live-state.ts`): score, clock, line score, both box scores, last 15 plays, recent scoring, other games, `observed_at` (time of the newest real play), `fetched_at`, `cadence` `{phase, next_ms}` |
| `fetched_at` | When the runner built the state; `/api/live` treats the game as delayed when this is older than `max(30 s, cadence.next_ms + 20 s)` |

---

## advanced_team_game_stats

Derived metrics per team per game.

**Primary key**
- `advanced_team_game_stat_id`

**Unique**
- (`game_id`, `team_id`)

**Foreign keys**
- `game_id` → games
- `team_id` → teams

**Key fields**
- `possessions`, `pace`
- `off_rating`, `def_rating`, `net_rating`
- `efg_pct`, `ts_pct`, `tov_pct`, `reb_pct`

---

## advanced_player_game_stats

Derived metrics per player per game (reserved for MVP+).

**Primary key**
- `advanced_player_game_stat_id`

**Unique**
- (`game_id`, `player_id`)

**Foreign keys**
- `game_id` → games
- `player_id` → players
- `team_id` → teams (optional)

**Key fields**
- `usage_rate`
- `ts_pct`, `efg_pct`
- `ast_rate`, `reb_rate`, `tov_rate`

---

## rolling_team_stats

Rolling window aggregates (last 5, last 10, etc.) used for fast dashboard rendering.

**Primary key**
- `rolling_team_stat_id`

**Unique**
- (`team_id`, `season_id`, `window_games`, `as_of_game_date`)

**Foreign keys**
- `team_id` → teams
- `season_id` → seasons

**Key fields**
- Ratings and efficiency metrics
- `record_wins`, `record_losses`

---

## rolling_player_stats

Rolling window aggregates for player trends.

**Primary key**
- `rolling_player_stat_id`

**Unique**
- (`player_id`, `season_id`, `window_games`, `as_of_game_date`)

**Foreign keys**
- `player_id` → players
- `team_id` → teams (optional)
- `season_id` → seasons

**Key fields**
- `points`, `rebounds`, `assists`, `minutes` (as floats/averages)
- `ts_pct`, `efg_pct`

---

## odds_snapshots

Odds snapshots by provider. Designed to support provider swapping.

**Primary key**
- `odds_snapshot_id`

**Unique**
- (`game_id`, `provider`, `captured_at`)

**Foreign keys**
- `game_id` → games

**Key fields**
- `spread_home`, `spread_away`
- `moneyline_home`, `moneyline_away`
- `total_points`
- `market_type` (optional: `"pregame"` / `"live"`)
- `raw_payload` for provider fields

---

## insights

The “provable” fact system used for rotating wow-facts and contextual alerts.

**Primary key**
- `insight_id` (UUID)

**Foreign keys**
- `team_id` → teams (often Clippers)
- `game_id` → games (nullable for macro insights)
- `player_id` → players (nullable)
- `season_id` → seasons (nullable)

**Key fields**
- `scope`: `"live" | "between_games" | "historical"`
- `category`: `"milestone" | "streak" | "run" | "comparison" | ...`
- `headline`: short display text
- `detail`: optional second line
- `importance`: 0–100 ranking used by selection algorithm
- `valid_from`, `valid_to`: optional lifecycle for live insights
- `is_active`

**Proof fields (required for provable insights)**
- `proof_sql`: SQL statement that proves the claim
- `proof_params`: JSON parameters used by the query
- `proof_result`: JSON snapshot of returned results supporting the claim
- `proof_hash`: optional hash of proof package

---

## app_kv

Small key-value store for caching app state, ingestion cursors, last-run times, etc.

**Primary key**
- `key`

**Key fields**
- `value` (JSONB)
- `updated_at`

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

Per-quarter lines for both teams in Clippers games. Team points follow the score (match the line score). Team `reb` counts player rebounds only (team rebounds are excluded; the box score's team total may include them).

- `period_team_stats`: only `ast` is nullable — NULL for `stats_pbp` games (no assist credits in that feed).
- `period_player_stats`: `ast`, `stl`, `blk` are NULL for `stats_pbp` games (`stl`/`blk` exist only on this table).

## clutch_stats

Last 5:00 of the 4th/OT with the margin ≤ 5 before each event. `player_id` NULL = team line.

## pbp_events

Normalized events for current-season Clippers games (live receipts, replay) and games flagged `keep`. Past seasons are pruned by `ingest-pbp`. A feed whose last score differs from the game's final score is not written (counted `incomplete`, retried later).

**Primary key** — `(game_id, event_num)`; **unique** — `(game_id, action_number)`

- `event_num`: 1-based feed order. It may shift while a game is live (the provider inserts or deletes actions); the rewrite at final is authoritative.
- `action_number`: stable provider id — cdn `actionNumber`, stats.nba.com v3 `actionId` (v3's own `actionNumber` repeats). Use it to identify an event across polls.
- `action_type`, `sub_type`: raw provider values (`''` if missing), e.g. cdn `3pt` / `Jump Shot`, v3 `Made Shot` / `Jump Shot`
- `kind`: normalized `fg | ft | rebound | turnover | steal | block | other`; `made`, `shot_value`, `points` (score change), `score_home`, `score_away`
- `keep`: survives season-rollover pruning (`--keep-raw`)

## rb_game_highs

Record book, rebuilt nightly by `scripts/build-record-book.ts`. Regular season only.

**Primary key** — `(scope, scope_id, stat_key, rank)`

- `scope`: `lac_team`, `lac_player` (any Clipper), `player_career` / `player_season` (players with a Clippers game in the last 3 seasons), `league_season`
- `scope_id`: `''`, a `player_id`, a `season_id`, or `player_id:season_id`
- `stat_key`: `pts reb ast fg3m stl blk`, team `team_pts team_fg3m team_ast margin opp_pts_low team_q_pts`, player `q_pts half_pts`
- `rank` 1 = best (for `opp_pts_low`, fewest points allowed); ties broken by earliest date

## rb_streaks

Every qualifying streak for relevant players and the Clippers (regular season; breaks on a miss or a team change). `is_active` = reaches the entity's latest game. Keys: `scoring_20`, `scoring_30`, `rebounding_10`, `threes_3`, `hot_shooting`, `double_double` (min 3–4 games), `wins`, `losses` (min 3).

## media_items

News articles and social posts (`scripts/sync-media.ts`), retained 7 days. External content, not "verified" insights.

**Primary key**
- `media_id` (UUID)

**Unique keys**
- `dedup_key`: `'article:<title key>'` | `'reddit:<id>'` | `'tweet:<id>'` | `'bsky:<uri>'`

**Key fields**
- `kind`: `'article' | 'reddit' | 'tweet' | 'bluesky'`. `'tweet'` may be a real X post linked from Reddit (`embed_url` set, `dedup_key` `'tweet:<id>'`) or an insider screenshot post detected from an r/LAClippers title like `"[Insider Name] ..."` (`embed_url` NULL, `dedup_key` still `'reddit:<id>'`, `author` is the insider's name, not the Reddit poster) — see `insiderPost` in `scripts/lib/media/reddit.ts`.
- `source`: `'ESPN'`, `'LA Times'`, `'r/LAClippers'`, `'Bluesky'`, ...
- `engagement`, `comments`: reddit score / bluesky likes + reposts; NULL for articles and for r/LAClippers posts fetched via the RSS path (no credentials — see `feed_rank`)
- `priority`: lower wins de-duplication when the same story is upserted from two sources
- `feed_rank`: nullable; 1 = top of the source's hot list at the last fetch. Set for Reddit posts (both the RSS and OAuth paths); NULL for articles and Bluesky. Reddit's public RSS feed carries no score/comment counts, so posts carry their hot-list position instead — cleared (`clearFeedRanks`) before each Reddit upsert so a post that falls out of the hot list doesn't keep a stale rank.

---

## app_kv keys (insights)

- `insights.records_start`: `{ season_id, label }` — first season of complete league records; frames say "since {label}"
- `insights.pbp_records_start`: `{ season_id, label }` — first season of complete play-by-play records (quarter/half highs, runs, clutch): the contiguous run of seasons where ≥ 95% of Clippers regular-season finals have a `game_flow` row, ending at the latest such season. Written by `build-record-book`; deleted when no season qualifies
- `history:backfilled_through`: earliest season `backfill-history` finished cleanly
