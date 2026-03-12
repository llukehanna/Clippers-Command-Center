export interface GameItem {
  game_id: string
  game_date: string
  opponent_abbr: string
  home_away: 'home' | 'away'
  result: 'W' | 'L' | null
  final_score: { team: number; opp: number } | null
  status: string
}

export interface SeasonRecord {
  overall: string // "42-40"
  home: string    // "22-19"
  away: string    // "20-21"
}

export function computeSeasonRecord(games: GameItem[]): SeasonRecord {
  const finished = games.filter((g) => g.result !== null)
  const w = finished.filter((g) => g.result === 'W').length
  const home = finished.filter((g) => g.home_away === 'home')
  const homeW = home.filter((g) => g.result === 'W').length
  const away = finished.filter((g) => g.home_away === 'away')
  const awayW = away.filter((g) => g.result === 'W').length
  return {
    overall: `${w}-${finished.length - w}`,
    home: `${homeW}-${home.length - homeW}`,
    away: `${awayW}-${away.length - awayW}`,
  }
}

export function detectOT(status: string | null | undefined): boolean {
  if (!status) return false
  return status.includes('OT')
}
