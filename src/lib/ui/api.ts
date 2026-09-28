// Server-side data access for pages. Pages ask for the same paths the API
// routes serve, but the request is dispatched straight to the route's data
// loader (src/lib/data/*) — no HTTP hop, no dependency on NEXT_PUBLIC_BASE_URL.
// Returns null on any non-2xx result so pages can render a designed error state.
//
// Results are cached for DATA_TTL_SECONDS (keyed by path) so tab switches
// render from memory instead of re-running the same queries: the underlying
// data only changes when the pipeline syncs. The Live page does not use this
// module — it polls /api/live on its own cadence.

import { loadHome } from '@/src/lib/data/home'
import { loadSchedule } from '@/src/lib/data/schedule'
import { loadPlayers } from '@/src/lib/data/players'
import { loadPlayer } from '@/src/lib/data/player'
import { loadInsights } from '@/src/lib/data/insights'
import { loadMedia } from '@/src/lib/data/media'
import { loadHistorySeasons } from '@/src/lib/data/history-seasons'
import { loadHistoryGames } from '@/src/lib/data/history-games'
import { loadHistoryGame } from '@/src/lib/data/history-game'
import { unstable_cache } from 'next/cache'
import { type ApiResult } from '@/src/lib/data/result'

type Loader = (match: RegExpMatchArray, url: URL) => Promise<ApiResult>

const ROUTES: Array<[RegExp, Loader]> = [
  [/^\/api\/home$/, () => loadHome()],
  [/^\/api\/schedule$/, (_, url) => loadSchedule(url)],
  [/^\/api\/players$/, (_, url) => loadPlayers(url)],
  [/^\/api\/players\/([^/]+)$/, (m, url) => loadPlayer(decodeURIComponent(m[1]), url)],
  [/^\/api\/insights$/, (_, url) => loadInsights(url)],
  [/^\/api\/media$/, (_, url) => loadMedia(url)],
  [/^\/api\/history\/seasons$/, () => loadHistorySeasons()],
  [/^\/api\/history\/games$/, (_, url) => loadHistoryGames(url)],
  [/^\/api\/history\/games\/([^/]+)$/, (m) => loadHistoryGame(decodeURIComponent(m[1]))],
]

const DATA_TTL_SECONDS = 60

class LoaderError extends Error {}

/** Runs the matching loader; throws on non-2xx so failures are never cached. */
async function load(path: string): Promise<unknown> {
  const url = new URL(path, 'http://ccc.local')
  for (const [pattern, loader] of ROUTES) {
    const match = url.pathname.match(pattern)
    if (!match) continue
    const result = await loader(match, url)
    if (result.status < 200 || result.status >= 300) throw new LoaderError(`${path} → ${result.status}`)
    return result.body
  }
  throw new Error(`getJson: no loader for ${path}`)
}

const cachedLoad = unstable_cache(load, ['ccc-get-json'], { revalidate: DATA_TTL_SECONDS, tags: ['ccc-data'] })

export async function getJson<T>(path: string): Promise<T | null> {
  try {
    return (await cachedLoad(path)) as T
  } catch (err) {
    if (!(err instanceof LoaderError)) console.error(`[getJson ${path}]`, err)
    return null
  }
}
