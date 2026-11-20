// Every id a dynamic page route can be prerendered for. Read through getJson,
// so at build time they come from the payload cache (and fail closed); each
// throws when its list payload is missing rather than prerendering nothing.

import { getJson } from '@/src/lib/ui/api'
import { playedGames, type HistoryGame } from '@/src/lib/ui/season'
import type { MovesPayload, PlayersPayload, SchedulePayload } from '@/src/lib/ui/types'

async function required<T>(path: string): Promise<T> {
  const data = await getJson<T>(path)
  if (data == null) throw new Error(`prebuild params: ${path} returned no data`)
  return data
}

const unique = (ids: string[]) => [...new Set(ids)]

/** Played (final) Clippers games across every season with history. */
export async function historyGameIds(): Promise<string[]> {
  const { seasons } = await required<{ seasons: Array<{ season_id: number }> }>('/api/history/seasons')
  const lists = await Promise.all(
    seasons.map((s) => required<{ games: HistoryGame[] }>(`/api/history/games?season_id=${s.season_id}&limit=200`)),
  )
  return unique(lists.flatMap((l) => playedGames(l.games).map((g) => String(g.game_id))))
}

/** Upcoming games on the schedule (the game preview pages). */
export async function scheduleGameIds(): Promise<string[]> {
  const { games } = await required<SchedulePayload>('/api/schedule')
  return unique(games.map((g) => String(g.game_id)))
}

/** Every Clippers player, all-time plus this season's roster (incl. traded). */
export async function playerIds(): Promise<string[]> {
  const [allTime, roster] = await Promise.all([
    required<{ players: Array<{ player_id: string }> }>('/api/players/all-time'),
    required<PlayersPayload>('/api/players?include_traded=true'),
  ])
  return unique([...allTime.players, ...roster.players].map((p) => String(p.player_id)))
}

/** Every Clippers trade (the Moves page's all-seasons trade list). */
export async function tradeSlugs(): Promise<string[]> {
  const { moves } = await required<MovesPayload>('/api/franchise/moves?type=trade')
  return unique(moves.filter((m) => m.kind_group === 'trade').map((m) => m.slug))
}
