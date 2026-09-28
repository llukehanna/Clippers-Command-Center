-- Docs/migrations/2026-10-insights-v2-data.sql
-- Insights v2, plan 1: play-by-play derived tables and the record book.
-- Idempotent (IF NOT EXISTS); one transaction. Apply with the "DB Migrate"
-- workflow (file = 2026-10-insights-v2-data.sql).
BEGIN;

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

COMMIT;
