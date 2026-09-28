// Server-side data access for pages. Pages ask for the same paths the API
// routes serve, but the request is dispatched straight to the route's data
// loader (src/lib/data/*) — no HTTP hop, no dependency on NEXT_PUBLIC_BASE_URL.
// Returns null on any non-2xx result so pages can render a designed error state.

import { loadHome } from '@/src/lib/data/home'
import { loadSchedule } from '@/src/lib/data/schedule'
import { loadPlayers } from '@/src/lib/data/players'
import { loadPlayer } from '@/src/lib/data/player'
import { loadInsights } from '@/src/lib/data/insights'
import { loadHistorySeasons } from '@/src/lib/data/history-seasons'
import { loadHistoryGames } from '@/src/lib/data/history-games'
import { loadHistoryGame } from '@/src/lib/data/history-game'
import { okBody, type ApiResult } from '@/src/lib/data/result'

type Loader = (match: RegExpMatchArray, url: URL) => Promise<ApiResult>

const ROUTES: Array<[RegExp, Loader]> = [
  [/^\/api\/home$/, () => loadHome()],
  [/^\/api\/schedule$/, (_, url) => loadSchedule(url)],
  [/^\/api\/players$/, (_, url) => loadPlayers(url)],
  [/^\/api\/players\/([^/]+)$/, (m, url) => loadPlayer(decodeURIComponent(m[1]), url)],
  [/^\/api\/insights$/, (_, url) => loadInsights(url)],
  [/^\/api\/history\/seasons$/, () => loadHistorySeasons()],
  [/^\/api\/history\/games$/, (_, url) => loadHistoryGames(url)],
  [/^\/api\/history\/games\/([^/]+)$/, (m) => loadHistoryGame(decodeURIComponent(m[1]))],
]

export async function getJson<T>(path: string): Promise<T | null> {
  const url = new URL(path, 'http://ccc.local')
  for (const [pattern, load] of ROUTES) {
    const match = url.pathname.match(pattern)
    if (!match) continue
    try {
      return okBody(await load(match, url)) as T | null
    } catch (err) {
      console.error(`[getJson ${path}]`, err)
      return null
    }
  }
  throw new Error(`getJson: no loader for ${path}`)
}
