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

Dense snapshots captured during live games (polling roughly every ~12 seconds).

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
