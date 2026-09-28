// src/lib/game-type.ts
// Regular season vs play-in vs playoffs. games.is_playoffs is false for the
// play-in, whose official NBA ids are 005YY…… (stored without leading zeros:
// 50,000,000–59,999,999). Mirrors REGULAR_SEASON in scripts/lib/insights/context.ts.

export type GameType = 'regular' | 'play_in' | 'playoffs';

/** SQL predicate (for games alias `g`): regular-season games only. */
export const REGULAR_SEASON_SQL =
  '(NOT g.is_playoffs AND g.nba_game_id NOT BETWEEN 50000000 AND 59999999)';

/** SQL expression (for games alias `g`) yielding 'regular' | 'play_in' | 'playoffs'. */
export const GAME_TYPE_SQL = `CASE
  WHEN g.is_playoffs THEN 'playoffs'
  WHEN g.nba_game_id BETWEEN 50000000 AND 59999999 THEN 'play_in'
  ELSE 'regular' END`;

export function gameType(nbaGameId: string | number | bigint | null | undefined, isPlayoffs: boolean): GameType {
  if (isPlayoffs) return 'playoffs';
  const n = Number(nbaGameId);
  return n >= 50_000_000 && n <= 59_999_999 ? 'play_in' : 'regular';
}

export function gameTypeLabel(t: GameType): string | null {
  return t === 'playoffs' ? 'Playoffs' : t === 'play_in' ? 'Play-In' : null;
}
