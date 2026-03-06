-- docs/DB_SCHEMA.sql
-- Clippers Command Center (CCC)
-- PostgreSQL schema (MVP)
--
-- Goals:
-- - Support 3+ seasons of full-league historical data
-- - Support live polling snapshots (~12s) for Clippers games
-- - Support derived/advanced stats and rolling windows
-- - Support a "provable" insight system (stored proof query + result snapshot)
-- - Support Vegas odds integration via provider adapters

BEGIN;

-- Recommended extensions (enable as available)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- Core reference tables
-- =============================================================================

CREATE TABLE IF NOT EXISTS seasons (
  season_id        SMALLINT PRIMARY KEY, -- e.g., 2024 for 2024-25 season start year
  label            TEXT NOT NULL,         -- e.g., "2024-25"
  start_date       DATE,
  end_date         DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teams (
  team_id          BIGSERIAL PRIMARY KEY,
  nba_team_id      INTEGER UNIQUE NOT NULL,      -- canonical NBA team id from data provider
  abbreviation     TEXT NOT NULL,                -- e.g., "LAC"
  name             TEXT NOT NULL,                -- e.g., "Clippers"
  city             TEXT,                         -- e.g., "Los Angeles"
  conference       TEXT,                         -- "East" / "West" (nullable if provider differs)
  division         TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teams_abbrev ON teams (abbreviation);

CREATE TABLE IF NOT EXISTS players (
  player_id        BIGSERIAL PRIMARY KEY,
  nba_player_id    INTEGER UNIQUE NOT NULL,      -- canonical NBA player id from provider
  first_name       TEXT NOT NULL,
  last_name        TEXT NOT NULL,
  display_name     TEXT NOT NULL,                -- "Kawhi Leonard"
  position         TEXT,                         -- "G", "F", "C", etc.
  height_in        SMALLINT,
  weight_lb        SMALLINT,
  birthdate        DATE,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_players_last_name ON players (last_name);

-- Roster membership can change across seasons and even within season.
CREATE TABLE IF NOT EXISTS player_team_stints (
  stint_id         BIGSERIAL PRIMARY KEY,
  player_id        BIGINT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
  team_id          BIGINT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
  season_id        SMALLINT REFERENCES seasons(season_id),
  start_date       DATE,
  end_date         DATE,
  jersey_number    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stints_player ON player_team_stints (player_id);
CREATE INDEX IF NOT EXISTS idx_stints_team ON player_team_stints (team_id);
CREATE INDEX IF NOT EXISTS idx_stints_season ON player_team_stints (season_id);

-- =============================================================================
-- Games (historical + schedule)
-- =============================================================================

-- We store all league games for ingested seasons so Clippers context can use league comparisons.
CREATE TABLE IF NOT EXISTS games (
  game_id          BIGSERIAL PRIMARY KEY,
  nba_game_id      BIGINT UNIQUE NOT NULL,       -- provider's game id
  season_id        SMALLINT REFERENCES seasons(season_id),
  game_date        DATE NOT NULL,                -- local date (arena time). time stored separately.
  start_time_utc   TIMESTAMPTZ,                  -- scheduled tipoff if known
  status           TEXT NOT NULL,                -- "scheduled" | "in_progress" | "final" | provider-specific
  home_team_id     BIGINT NOT NULL REFERENCES teams(team_id),
  away_team_id     BIGINT NOT NULL REFERENCES teams(team_id),

  home_score       SMALLINT,
  away_score       SMALLINT,

  period           SMALLINT,                     -- current period if in progress
  clock           TEXT,                          -- provider clock string if in progress (e.g., "05:32")
  is_playoffs      BOOLEAN NOT NULL DEFAULT FALSE,
  arena           TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_games_teams_distinct CHECK (home_team_id <> away_team_id)
);

CREATE INDEX IF NOT EXISTS idx_games_date ON games (game_date);
CREATE INDEX IF NOT EXISTS idx_games_season ON games (season_id);
CREATE INDEX IF NOT EXISTS idx_games_home ON games (home_team_id);
CREATE INDEX IF NOT EXISTS idx_games_away ON games (away_team_id);

-- =============================================================================
-- Box score: per-team per-game + per-player per-game (historical/final)
-- =============================================================================

CREATE TABLE IF NOT EXISTS game_team_box_scores (
  game_team_box_score_id BIGSERIAL PRIMARY KEY,
  game_id          BIGINT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  team_id          BIGINT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
  is_home          BOOLEAN NOT NULL,
  minutes          SMALLINT,                     -- team minutes (often 240 regulation)
  points           SMALLINT,
  rebounds         SMALLINT,
  assists          SMALLINT,
  steals           SMALLINT,
  blocks           SMALLINT,
  turnovers        SMALLINT,
  fouls           SMALLINT,

  fg_made          SMALLINT,
  fg_attempted     SMALLINT,
  fg3_made         SMALLINT,
  fg3_attempted    SMALLINT,
  ft_made          SMALLINT,
  ft_attempted     SMALLINT,

  offensive_reb    SMALLINT,
  defensive_reb    SMALLINT,

  raw_payload      JSONB,                        -- store provider-specific stats safely
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_game_team UNIQUE (game_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_team_box_game ON game_team_box_scores (game_id);
CREATE INDEX IF NOT EXISTS idx_team_box_team ON game_team_box_scores (team_id);

CREATE TABLE IF NOT EXISTS game_player_box_scores (
  game_player_box_score_id BIGSERIAL PRIMARY KEY,
  game_id          BIGINT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  team_id          BIGINT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
  player_id        BIGINT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
  starter          BOOLEAN,
  minutes          TEXT,                         -- keep provider format (e.g., "34:12"); can parse later
  points           SMALLINT,
  rebounds         SMALLINT,
  assists          SMALLINT,
  steals           SMALLINT,
  blocks           SMALLINT,
  turnovers        SMALLINT,
  fouls            SMALLINT,
  plus_minus       SMALLINT,

  fg_made          SMALLINT,
  fg_attempted     SMALLINT,
  fg3_made         SMALLINT,
  fg3_attempted    SMALLINT,
  ft_made          SMALLINT,
  ft_attempted     SMALLINT,

  offensive_reb    SMALLINT,
  defensive_reb    SMALLINT,

  raw_payload      JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_game_player UNIQUE (game_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_player_box_game ON game_player_box_scores (game_id);
CREATE INDEX IF NOT EXISTS idx_player_box_player ON game_player_box_scores (player_id);
CREATE INDEX IF NOT EXISTS idx_player_box_team ON game_player_box_scores (team_id);

-- =============================================================================
-- Live snapshots (polling every ~12 seconds during active Clippers games)
-- =============================================================================

-- Store dense snapshots for later debugging + replay. Keep extracted fields for query speed.
CREATE TABLE IF NOT EXISTS live_snapshots (
  snapshot_id      BIGSERIAL PRIMARY KEY,
  game_id          BIGINT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  captured_at      TIMESTAMPTZ NOT NULL,          -- when CCC captured it
  provider_ts      TIMESTAMPTZ,                   -- if provider includes a timestamp
  period           SMALLINT,
  clock            TEXT,
  home_score       SMALLINT,
  away_score       SMALLINT,
  payload          JSONB NOT NULL,                -- full snapshot payload
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_live_snapshots_game_time ON live_snapshots (game_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_snapshots_captured ON live_snapshots (captured_at DESC);

-- =============================================================================
-- Derived / advanced stats
-- =============================================================================

-- Per team per game derived metrics (can be computed after final box score or incrementally)
CREATE TABLE IF NOT EXISTS advanced_team_game_stats (
  advanced_team_game_stat_id BIGSERIAL PRIMARY KEY,
  game_id          BIGINT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  team_id          BIGINT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,

  possessions      REAL,
  pace             REAL,
  off_rating       REAL,
  def_rating       REAL,
  net_rating       REAL,

  efg_pct          REAL,
  ts_pct           REAL,
  tov_pct          REAL,
  reb_pct          REAL,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_adv_team_game UNIQUE (game_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_adv_team_game_team ON advanced_team_game_stats (team_id);
CREATE INDEX IF NOT EXISTS idx_adv_team_game_game ON advanced_team_game_stats (game_id);

-- Per player per game derived metrics (optional MVP but table reserved)
CREATE TABLE IF NOT EXISTS advanced_player_game_stats (
  advanced_player_game_stat_id BIGSERIAL PRIMARY KEY,
  game_id          BIGINT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id        BIGINT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
  team_id          BIGINT REFERENCES teams(team_id),

  usage_rate       REAL,
  ts_pct           REAL,
  efg_pct          REAL,
  ast_rate         REAL,
  reb_rate         REAL,
  tov_rate         REAL,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_adv_player_game UNIQUE (game_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_adv_player_game_player ON advanced_player_game_stats (player_id);
CREATE INDEX IF NOT EXISTS idx_adv_player_game_game ON advanced_player_game_stats (game_id);

-- Rolling windows (ex: last 5, last 10) for fast dashboard rendering.
CREATE TABLE IF NOT EXISTS rolling_team_stats (
  rolling_team_stat_id BIGSERIAL PRIMARY KEY,
  team_id          BIGINT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
  season_id        SMALLINT REFERENCES seasons(season_id),
  window_games     SMALLINT NOT NULL,             -- e.g., 5, 10
  as_of_game_date  DATE NOT NULL,                 -- rolling window end date
  off_rating       REAL,
  def_rating       REAL,
  net_rating       REAL,
  pace             REAL,
  efg_pct          REAL,
  ts_pct           REAL,
  tov_pct          REAL,
  reb_pct          REAL,
  record_wins      SMALLINT,
  record_losses    SMALLINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_rolling_team UNIQUE (team_id, season_id, window_games, as_of_game_date)
);

CREATE INDEX IF NOT EXISTS idx_rolling_team_lookup ON rolling_team_stats (team_id, season_id, window_games, as_of_game_date DESC);

CREATE TABLE IF NOT EXISTS rolling_player_stats (
  rolling_player_stat_id BIGSERIAL PRIMARY KEY,
  player_id        BIGINT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
  team_id          BIGINT REFERENCES teams(team_id),
  season_id        SMALLINT REFERENCES seasons(season_id),
  window_games     SMALLINT NOT NULL,
  as_of_game_date  DATE NOT NULL,
  points           REAL,
  rebounds         REAL,
  assists          REAL,
  ts_pct           REAL,
  efg_pct          REAL,
  minutes          REAL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_rolling_player UNIQUE (player_id, season_id, window_games, as_of_game_date)
);

CREATE INDEX IF NOT EXISTS idx_rolling_player_lookup ON rolling_player_stats (player_id, season_id, window_games, as_of_game_date DESC);

-- =============================================================================
-- Odds (Vegas)
-- =============================================================================

-- Store odds snapshots. We keep provider and captured_at so you can switch providers later.
CREATE TABLE IF NOT EXISTS odds_snapshots (
  odds_snapshot_id BIGSERIAL PRIMARY KEY,
  game_id          BIGINT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  provider         TEXT NOT NULL,                 -- e.g., "theoddsapi", "sportsdataio"
  captured_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Standard markets (nullable if provider doesn't supply)
  spread_home      REAL,
  spread_away      REAL,
  moneyline_home   INTEGER,
  moneyline_away   INTEGER,
  total_points     REAL,

  -- Additional metadata
  market_type      TEXT,                          -- optional, e.g., "pregame", "live"
  raw_payload      JSONB,

  CONSTRAINT uq_odds_snapshot UNIQUE (game_id, provider, captured_at)
);

CREATE INDEX IF NOT EXISTS idx_odds_game_time ON odds_snapshots (game_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_odds_provider_time ON odds_snapshots (provider, captured_at DESC);

-- =============================================================================
-- Provable insight system
-- =============================================================================

-- Insights are generated facts that the UI rotates through.
-- "Provable" = every insight stores a proof query and snapshot of proof results.
CREATE TABLE IF NOT EXISTS insights (
  insight_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope            TEXT NOT NULL,                 -- "live" | "between_games" | "historical"
  team_id          BIGINT REFERENCES teams(team_id),   -- usually Clippers
  game_id          BIGINT REFERENCES games(game_id),   -- nullable for macro insights
  player_id        BIGINT REFERENCES players(player_id), -- nullable
  season_id        SMALLINT REFERENCES seasons(season_id),

  category         TEXT NOT NULL,                 -- "milestone" | "streak" | "run" | "comparison" | ...
  headline         TEXT NOT NULL,                 -- short text displayed
  detail           TEXT,                          -- optional 1-line support text for UI
  importance       SMALLINT NOT NULL DEFAULT 50,  -- 0..100 ranking for selection
  is_active        BOOLEAN NOT NULL DEFAULT TRUE, -- whether eligible for rotation
  valid_from       TIMESTAMPTZ,                   -- optional lifecycle for live insights
  valid_to         TIMESTAMPTZ,

  -- Proof & traceability
  proof_sql        TEXT NOT NULL,                 -- SQL statement used to prove the claim
  proof_params     JSONB,                         -- parameter values (ids, dates, etc.)
  proof_result     JSONB NOT NULL,                -- captured result snapshot that supports the claim
  proof_hash       TEXT,                          -- optional hash of proof_sql+params+result

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_insights_scope ON insights (scope);
CREATE INDEX IF NOT EXISTS idx_insights_game ON insights (game_id);
CREATE INDEX IF NOT EXISTS idx_insights_team ON insights (team_id);
CREATE INDEX IF NOT EXISTS idx_insights_player ON insights (player_id);
CREATE INDEX IF NOT EXISTS idx_insights_importance ON insights (importance DESC);
CREATE INDEX IF NOT EXISTS idx_insights_active_scope ON insights (is_active, scope);

-- Unique index on proof_hash to enable ON CONFLICT (proof_hash) deduplication in upserts.
-- WHERE proof_hash IS NOT NULL allows NULL proof_hash rows to coexist without conflicting.
CREATE UNIQUE INDEX IF NOT EXISTS uq_insights_proof_hash
  ON insights (proof_hash)
  WHERE proof_hash IS NOT NULL;

-- Optional: enforce "provable" proof_result is present (already NOT NULL) and proof_sql is present.
-- Application must ensure proofs are correct; DB ensures data exists.

-- =============================================================================
-- Lightweight app settings / caching (optional but useful)
-- =============================================================================

CREATE TABLE IF NOT EXISTS app_kv (
  key             TEXT PRIMARY KEY,
  value           JSONB NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
