export interface GameItem {
  game_id: string
  game_date: string
  opponent_abbr: string
  home_away: 'home' | 'away'
  result: 'W' | 'L' | null
  final_score: { team: number; opp: number } | null
  status: string
  /** 'regular' | 'play_in' | 'playoffs'; absent on older payloads (= regular) */
  game_type?: 'regular' | 'play_in' | 'playoffs'
  /** Overtime periods played (0 = regulation) */
  overtime_periods?: number
}

export interface SeasonRecord {
  overall: string // "42-40" — regular season
  home: string    // "22-19"
  away: string    // "20-21"
  /** Play-in + playoffs, "3-4"; null when the team had no postseason games */
  postseason: string | null
}

/** Regular-season record (play-in and playoffs reported separately). */
export function computeSeasonRecord(games: GameItem[]): SeasonRecord {
  const post = games.filter((g) => g.result !== null && (g.game_type ?? 'regular') !== 'regular')
  const postW = post.filter((g) => g.result === 'W').length
  const finished = games.filter((g) => g.result !== null && (g.game_type ?? 'regular') === 'regular')
  const w = finished.filter((g) => g.result === 'W').length
  const home = finished.filter((g) => g.home_away === 'home')
  const homeW = home.filter((g) => g.result === 'W').length
  const away = finished.filter((g) => g.home_away === 'away')
  const awayW = away.filter((g) => g.result === 'W').length
  return {
    overall: `${w}-${finished.length - w}`,
    home: `${homeW}-${home.length - homeW}`,
    away: `${awayW}-${away.length - awayW}`,
    postseason: post.length > 0 ? `${postW}-${post.length - postW}` : null,
  }
}

/** "OT", "2OT", … for a game that went to overtime; null for regulation. */
export function overtimeLabel(game: Pick<GameItem, 'overtime_periods'>): string | null {
  const n = game.overtime_periods ?? 0
  if (n <= 0) return null
  return n === 1 ? 'OT' : `${n}OT`
}
