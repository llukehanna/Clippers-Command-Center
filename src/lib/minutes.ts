// src/lib/minutes.ts
// Player minutes are stored in the provider's format: NBA box scores use
// ISO-8601 durations ("PT34M12.00S"), older balldontlie rows "34:12" or "34".

/**
 * SQL expression (for game_player_box_scores alias `pb`) converting
 * pb.minutes to seconds; unparseable values (NULL, '', 'DNP') count as 0.
 */
export const MINUTES_SECONDS_SQL = `(CASE
  WHEN pb.minutes ~ '^PT' THEN
      COALESCE(substring(pb.minutes FROM 'PT(\\d+)M')::numeric, 0) * 60
    + COALESCE(substring(pb.minutes FROM '([\\d.]+)S$')::numeric, 0)
  WHEN pb.minutes ~ '^\\d+(:\\d+)?$' THEN
      split_part(pb.minutes, ':', 1)::numeric * 60
    + COALESCE(NULLIF(split_part(pb.minutes, ':', 2), '')::numeric, 0)
  ELSE 0 END)`;
