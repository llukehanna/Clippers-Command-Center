// scripts/lib/rolling-windows.ts
// Rolling window computation functions for team and player stats.
// Computes last-N-game averages over advanced_team_game_stats and advanced_player_game_stats,
// then upserts into rolling_team_stats and rolling_player_stats.

import { sql } from './db.js';
import { parseMinutes } from './advanced-stats.js';

// ---- Types ----

interface TeamAdvRow {
  game_id: string;
  off_rating: number | null;
  def_rating: number | null;
  net_rating: number | null;
  pace: number | null;
  efg_pct: number | null;
  ts_pct: number | null;
  tov_pct: number | null;
  reb_pct: number | null;
  game_date: Date;
  is_win: boolean;
}

interface PlayerAdvRow {
  game_id: string;
  ts_pct: number | null;
  efg_pct: number | null;
  game_date: Date;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  minutes: string | null;
}

// ---- Helpers ----

function avgField(rows: TeamAdvRow[], field: keyof TeamAdvRow): number {
  const n = rows.length;
  if (n === 0) return 0;
  return rows.reduce((s, r) => s + ((r[field] as number | null) ?? 0), 0) / n;
}

// ---- Team rolling windows ----

/**
 * Compute rolling windows (5 and 10 games) for a single team in a season.
 * Reads from advanced_team_game_stats joined to games, upserts into rolling_team_stats.
 */
export async function computeTeamRollingWindows(
  teamId: string,
  seasonId: number
): Promise<void> {
  const rows = await sql<TeamAdvRow[]>`
    SELECT
      atgs.game_id::text,
      atgs.off_rating,
      atgs.def_rating,
      atgs.net_rating,
      atgs.pace,
      atgs.efg_pct,
      atgs.ts_pct,
      atgs.tov_pct,
      atgs.reb_pct,
      g.game_date,
      CASE WHEN g.home_team_id = ${teamId}::bigint
           THEN g.home_score > g.away_score
           ELSE g.away_score > g.home_score
      END AS is_win
    FROM advanced_team_game_stats atgs
    JOIN games g ON g.game_id = atgs.game_id
    WHERE atgs.team_id = ${teamId}::bigint
      AND g.season_id = ${seasonId}
    ORDER BY g.game_date ASC
  `;

  if (rows.length === 0) return;

  const WINDOWS = [5, 10];

  for (const window of WINDOWS) {
    for (let i = 0; i < rows.length; i++) {
      if (i + 1 < window) continue; // not enough games yet for this window

      const slice = rows.slice(i + 1 - window, i + 1);
      const asOfDate = rows[i].game_date;

      const wins = slice.filter(r => r.is_win).length;
      const losses = slice.length - wins;

      const avg = {
        off_rating: avgField(slice, 'off_rating'),
        def_rating: avgField(slice, 'def_rating'),
        net_rating: avgField(slice, 'net_rating'),
        pace: avgField(slice, 'pace'),
        efg_pct: avgField(slice, 'efg_pct'),
        ts_pct: avgField(slice, 'ts_pct'),
        tov_pct: avgField(slice, 'tov_pct'),
        reb_pct: avgField(slice, 'reb_pct'),
      };

      await sql`
        INSERT INTO rolling_team_stats (
          team_id, season_id, window_games, as_of_game_date,
          off_rating, def_rating, net_rating, pace,
          efg_pct, ts_pct, tov_pct, reb_pct,
          record_wins, record_losses
        ) VALUES (
          ${teamId}::bigint, ${seasonId}, ${window}, ${asOfDate},
          ${avg.off_rating}, ${avg.def_rating}, ${avg.net_rating}, ${avg.pace},
          ${avg.efg_pct}, ${avg.ts_pct}, ${avg.tov_pct}, ${avg.reb_pct},
          ${wins}, ${losses}
        )
        ON CONFLICT (team_id, season_id, window_games, as_of_game_date) DO UPDATE SET
          off_rating    = EXCLUDED.off_rating,
          def_rating    = EXCLUDED.def_rating,
          net_rating    = EXCLUDED.net_rating,
          pace          = EXCLUDED.pace,
          efg_pct       = EXCLUDED.efg_pct,
          ts_pct        = EXCLUDED.ts_pct,
          tov_pct       = EXCLUDED.tov_pct,
          reb_pct       = EXCLUDED.reb_pct,
          record_wins   = EXCLUDED.record_wins,
          record_losses = EXCLUDED.record_losses
      `;
    }
  }
}

// ---- Player rolling windows ----

/**
 * Compute rolling windows (5 and 10 games) for a single player in a season.
 * Reads from advanced_player_game_stats joined to games and game_player_box_scores,
 * upserts into rolling_player_stats.
 */
export async function computePlayerRollingWindows(
  playerId: string,
  _teamId: string,
  seasonId: number
): Promise<void> {
  const rows = await sql<PlayerAdvRow[]>`
    SELECT
      apgs.game_id::text,
      apgs.ts_pct,
      apgs.efg_pct,
      g.game_date,
      pb.points,
      pb.rebounds,
      pb.assists,
      pb.minutes
    FROM advanced_player_game_stats apgs
    JOIN games g ON g.game_id = apgs.game_id
    JOIN game_player_box_scores pb
      ON pb.game_id = apgs.game_id AND pb.player_id = apgs.player_id
    WHERE apgs.player_id = ${playerId}::bigint
      AND g.season_id = ${seasonId}
    ORDER BY g.game_date ASC
  `;

  if (rows.length === 0) return;

  const WINDOWS = [5, 10];

  for (const window of WINDOWS) {
    for (let i = 0; i < rows.length; i++) {
      if (i + 1 < window) continue;

      const slice = rows.slice(i + 1 - window, i + 1);
      const asOfDate = rows[i].game_date;
      const n = slice.length;

      const avgPoints = slice.reduce((s, r) => s + ((r.points as number | null) ?? 0), 0) / n;
      const avgRebounds = slice.reduce((s, r) => s + ((r.rebounds as number | null) ?? 0), 0) / n;
      const avgAssists = slice.reduce((s, r) => s + ((r.assists as number | null) ?? 0), 0) / n;
      const avgTsPct = slice.reduce((s, r) => s + ((r.ts_pct as number | null) ?? 0), 0) / n;
      const avgEfgPct = slice.reduce((s, r) => s + ((r.efg_pct as number | null) ?? 0), 0) / n;
      const avgMinutes = slice.reduce((s, r) => s + parseMinutes(r.minutes), 0) / n;

      await sql`
        INSERT INTO rolling_player_stats (
          player_id, season_id, window_games, as_of_game_date,
          points, rebounds, assists, ts_pct, efg_pct, minutes
        ) VALUES (
          ${playerId}::bigint, ${seasonId}, ${window}, ${asOfDate},
          ${avgPoints}, ${avgRebounds}, ${avgAssists}, ${avgTsPct}, ${avgEfgPct}, ${avgMinutes}
        )
        ON CONFLICT (player_id, season_id, window_games, as_of_game_date) DO UPDATE SET
          points   = EXCLUDED.points,
          rebounds = EXCLUDED.rebounds,
          assists  = EXCLUDED.assists,
          ts_pct   = EXCLUDED.ts_pct,
          efg_pct  = EXCLUDED.efg_pct,
          minutes  = EXCLUDED.minutes
      `;
    }
  }
}
