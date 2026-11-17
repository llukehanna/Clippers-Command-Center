-- History archive: season totals and era names.
--
-- Backs the History pages with full-league season totals back to 1946, filled
-- by a local import from a Kaggle NBA dataset (not by the nightly pipeline).
--   team_era_names         city / name / abbreviation per franchise era, from
--                          a static table (era names exist from 1970 only);
--                          upserted by the import.
--   team_seasons           one row per franchise per season, with record,
--                          playoff result, and regular-season totals (own and
--                          opponent). abbreviation is nullable: pre-1970 teams
--                          have none; city and name come from per-game names.
--   player_seasons         per player, season type and franchise totals.
--                          nba_franchise_id 0 is the multi-team 'TOT' row;
--                          team_abbreviation is NULL when no era name exists.
--   league_season_averages per-team-game league averages for each season.
-- Also backfills the seasons table for 1946-2018 so game and season rows can
-- reference it (labels like '1946-47', '1999-00').
--
-- Backward compatible: only adds tables and rows; nothing existing changes.
--
-- Idempotent; safe to re-run.
BEGIN;

CREATE TABLE IF NOT EXISTS team_era_names (
  team_id         BIGINT NOT NULL REFERENCES teams(team_id),
  first_season_id SMALLINT NOT NULL,
  last_season_id  SMALLINT,                 -- NULL = current
  abbreviation    TEXT NOT NULL,
  city            TEXT NOT NULL,
  name            TEXT NOT NULL,
  PRIMARY KEY (team_id, first_season_id)
);

CREATE TABLE IF NOT EXISTS team_seasons (
  season_id        SMALLINT NOT NULL,
  nba_franchise_id INTEGER NOT NULL,
  team_id          BIGINT REFERENCES teams(team_id),
  city             TEXT,
  name             TEXT NOT NULL,
  abbreviation     TEXT,
  wins             SMALLINT,
  losses           SMALLINT,
  playoff_round    SMALLINT,                -- 0 = missed, 1-4 = first round through Finals
  won_title        BOOLEAN,
  games            SMALLINT,
  points           INTEGER,
  fg_made          INTEGER,
  fg_attempted     INTEGER,
  fg3_made         INTEGER,
  fg3_attempted    INTEGER,
  ft_made          INTEGER,
  ft_attempted     INTEGER,
  rebounds         INTEGER,
  offensive_reb    INTEGER,
  defensive_reb    INTEGER,
  assists          INTEGER,
  steals           INTEGER,
  blocks           INTEGER,
  turnovers        INTEGER,
  fouls            INTEGER,
  opp_points       INTEGER,
  opp_fg_made      INTEGER,
  opp_fg_attempted INTEGER,
  opp_fg3_made     INTEGER,
  opp_fg3_attempted INTEGER,
  opp_ft_made      INTEGER,
  opp_ft_attempted INTEGER,
  opp_rebounds     INTEGER,
  opp_offensive_reb INTEGER,
  opp_defensive_reb INTEGER,
  opp_assists      INTEGER,
  opp_steals       INTEGER,
  opp_blocks       INTEGER,
  opp_turnovers    INTEGER,
  opp_fouls        INTEGER,
  PRIMARY KEY (season_id, nba_franchise_id)
);

CREATE TABLE IF NOT EXISTS player_seasons (
  season_id         SMALLINT NOT NULL,
  season_type       TEXT NOT NULL CHECK (season_type IN ('regular','playoffs')),
  nba_person_id     INTEGER NOT NULL,
  player_id         BIGINT REFERENCES players(player_id),
  display_name      TEXT NOT NULL,
  nba_franchise_id  INTEGER NOT NULL,       -- 0 = the multi-team TOT row
  team_abbreviation TEXT,                   -- 'TOT' on TOT rows, era abbreviation when one exists, else NULL
  team_name         TEXT,
  games             SMALLINT NOT NULL,
  games_started     SMALLINT,
  minutes           NUMERIC(7,1),
  points            INTEGER,
  fg_made           INTEGER,
  fg_attempted      INTEGER,
  fg3_made          INTEGER,
  fg3_attempted     INTEGER,
  ft_made           INTEGER,
  ft_attempted      INTEGER,
  rebounds          INTEGER,
  offensive_reb     INTEGER,
  defensive_reb     INTEGER,
  assists           INTEGER,
  steals            INTEGER,
  blocks            INTEGER,
  turnovers         INTEGER,
  fouls             INTEGER,
  UNIQUE (season_id, season_type, nba_person_id, nba_franchise_id)
);
CREATE INDEX IF NOT EXISTS idx_player_seasons_player ON player_seasons (player_id);

CREATE TABLE IF NOT EXISTS league_season_averages (
  season_id     SMALLINT PRIMARY KEY,
  teams         SMALLINT,
  games         INTEGER,
  ppg           NUMERIC(6,3),
  rpg           NUMERIC(6,3),
  apg           NUMERIC(6,3),
  spg           NUMERIC(6,3),
  bpg           NUMERIC(6,3),
  tpg           NUMERIC(6,3),
  fg_pct        NUMERIC(6,3),
  fg3_pct       NUMERIC(6,3),
  ft_pct        NUMERIC(6,3),
  fg3a_per_game NUMERIC(6,3),
  pace          NUMERIC(6,2),
  ortg          NUMERIC(6,2)
);

INSERT INTO seasons (season_id, label)
SELECT y, y || '-' || lpad(((y + 1) % 100)::text, 2, '0')
FROM generate_series(1946, 2018) AS y
ON CONFLICT DO NOTHING;

COMMIT;
