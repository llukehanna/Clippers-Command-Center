// Season-level derivations over /api/history/games rows.

export interface HistoryGame {
  game_id: string
  game_date: string
  opponent_abbr: string
  home_away: 'home' | 'away'
  result: 'W' | 'L' | null
  final_score: { team: number; opp: number } | null
  status: string
  game_type?: 'regular' | 'play_in' | 'playoffs'
  overtime_periods?: number | null
}

export interface PlayedGame extends HistoryGame {
  result: 'W' | 'L'
  final_score: { team: number; opp: number }
  margin: number
  ot: boolean
}

const byDate = (a: { game_date: string }, b: { game_date: string }) =>
  a.game_date.localeCompare(b.game_date)

export function playedGames(games: HistoryGame[]): PlayedGame[] {
  return games
    .filter((g): g is HistoryGame & Pick<PlayedGame, 'result' | 'final_score'> => g.result !== null && g.final_score !== null)
    .map((g) => ({
      ...g,
      margin: g.final_score.team - g.final_score.opp,
      ot: g.overtime_periods != null ? g.overtime_periods > 0 : /OT/i.test(g.status ?? ''),
    }))
    .sort(byDate)
}

/** Regular-season games only (play-in and playoff games are excluded from records). */
export function regularSeason<T extends Pick<HistoryGame, 'game_type'>>(games: T[]): T[] {
  return games.filter((g) => !g.game_type || g.game_type === 'regular')
}

export function gameTypeLabel(t: HistoryGame['game_type']): string | null {
  return t === 'playoffs' ? 'Playoffs' : t === 'play_in' ? 'Play-In' : null
}

export function upcomingGames(games: HistoryGame[]): HistoryGame[] {
  return games.filter((g) => g.result === null || g.final_score === null).sort(byDate)
}

export function seasonSummary(played: PlayedGame[]) {
  const tally = (list: PlayedGame[]) => ({
    w: list.filter((g) => g.result === 'W').length,
    l: list.filter((g) => g.result === 'L').length,
  })
  const all = tally(played)
  return {
    wins: all.w,
    losses: all.l,
    home: tally(played.filter((g) => g.home_away === 'home')),
    away: tally(played.filter((g) => g.home_away === 'away')),
    avgMargin: played.length ? played.reduce((s, g) => s + g.margin, 0) / played.length : null,
  }
}

export function streaks(played: PlayedGame[]) {
  let longestWin = 0
  let longestLoss = 0
  let current: { kind: 'W' | 'L'; length: number } | null = null
  for (const g of played) {
    current = current && current.kind === g.result ? { kind: g.result, length: current.length + 1 } : { kind: g.result, length: 1 }
    if (current.kind === 'W') longestWin = Math.max(longestWin, current.length)
    else longestLoss = Math.max(longestLoss, current.length)
  }
  return { longestWin, longestLoss, current }
}

export function previousSeasonId(seasonIds: number[], current: number): number | null {
  const earlier = seasonIds.filter((id) => id < current).sort((a, b) => a - b)
  return earlier.at(-1) ?? null
}
