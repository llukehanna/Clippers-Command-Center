// scripts/lib/insights/engine/sql.ts
// DB-free SQL fragments shared by detectors and the context loader.
export { REGULAR_SEASON } from '../../sql-fragments.js';

/**
 * Players of `team` as of `asOf` (v1 clippersSeasonPlayers + a date bound):
 * their latest game of the season was for the team (a player traded away is
 * out, one acquired is in), and so was their latest game of the team's latest
 * season — while insights still describe last season, players who have left
 * are dropped. Arguments are the query's placeholders ('$1', '$2', '$4').
 */
export function rosterSubquery(season: string, team: string, asOf: string): string {
  return `(
  SELECT last_game.player_id FROM (
    SELECT DISTINCT ON (cp.player_id) cp.player_id, cp.team_id
    FROM game_player_box_scores cp
    JOIN games cg ON cg.game_id = cp.game_id
    WHERE cg.season_id = ${season}::int AND cg.game_date <= ${asOf}::date
    ORDER BY cp.player_id, cg.game_date DESC, cg.game_id DESC
  ) last_game
  JOIN (
    SELECT DISTINCT ON (np.player_id) np.player_id, np.team_id
    FROM game_player_box_scores np
    JOIN games ng ON ng.game_id = np.game_id
    WHERE ng.game_date <= ${asOf}::date AND ng.season_id = (
      SELECT MAX(tg.season_id) FROM games tg
      JOIN game_player_box_scores tp ON tp.game_id = tg.game_id
      WHERE tp.team_id = ${team}::bigint AND tg.game_date <= ${asOf}::date
    )
    ORDER BY np.player_id, ng.game_date DESC, ng.game_id DESC
  ) latest ON latest.player_id = last_game.player_id
  WHERE last_game.team_id = ${team}::bigint
    AND latest.team_id = ${team}::bigint
)`;
}
