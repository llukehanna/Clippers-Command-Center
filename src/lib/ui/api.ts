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
import { loadGamePreview } from '@/src/lib/data/game-preview'
import { loadPlayers } from '@/src/lib/data/players'
import { loadPlayer } from '@/src/lib/data/player'
import { loadInsights } from '@/src/lib/data/insights'
import { loadMedia } from '@/src/lib/data/media'
import { loadHistorySeasons } from '@/src/lib/data/history-seasons'
import { loadHistoryGames } from '@/src/lib/data/history-games'
import { loadHistoryGame } from '@/src/lib/data/history-game'
import { loadFranchiseMoves } from '@/src/lib/data/franchise-moves'
import { loadFranchisePeople } from '@/src/lib/data/franchise-people'
import { loadFranchiseDraft } from '@/src/lib/data/franchise-draft'
import { loadFranchiseContracts } from '@/src/lib/data/franchise-contracts'
import { loadFranchisePicks } from '@/src/lib/data/franchise-picks'
import { loadFranchiseFrontOffice } from '@/src/lib/data/franchise-front-office'
import { loadFranchiseHonors } from '@/src/lib/data/franchise-honors'
import { loadFranchiseTrade } from '@/src/lib/data/franchise-trade'
import { loadGameStory } from '@/src/lib/data/game-story'
import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { type ApiResult } from '@/src/lib/data/result'

type Loader = (match: RegExpMatchArray, url: URL) => Promise<ApiResult>

const ROUTES: Array<[RegExp, Loader]> = [
  [/^\/api\/home$/, () => loadHome()],
  [/^\/api\/schedule$/, (_, url) => loadSchedule(url)],
  [/^\/api\/schedule\/([^/]+)$/, (m) => loadGamePreview(decodeURIComponent(m[1]))],
  [/^\/api\/players$/, (_, url) => loadPlayers(url)],
  [/^\/api\/players\/([^/]+)$/, (m, url) => loadPlayer(decodeURIComponent(m[1]), url)],
  [/^\/api\/insights$/, (_, url) => loadInsights(url)],
  [/^\/api\/media$/, (_, url) => loadMedia(url)],
  [/^\/api\/history\/seasons$/, () => loadHistorySeasons()],
  [/^\/api\/history\/games$/, (_, url) => loadHistoryGames(url)],
  [/^\/api\/history\/games\/([^/]+)\/story$/, (m) => loadGameStory(decodeURIComponent(m[1]))],
  [/^\/api\/history\/games\/([^/]+)$/, (m) => loadHistoryGame(decodeURIComponent(m[1]))],
  [/^\/api\/franchise\/moves$/, (_, url) => loadFranchiseMoves(url)],
  [/^\/api\/franchise\/people$/, () => loadFranchisePeople()],
  [/^\/api\/franchise\/draft$/, () => loadFranchiseDraft()],
  [/^\/api\/franchise\/contracts$/, () => loadFranchiseContracts()],
  [/^\/api\/franchise\/picks$/, () => loadFranchisePicks()],
  [/^\/api\/franchise\/front-office$/, () => loadFranchiseFrontOffice()],
  [/^\/api\/franchise\/honors$/, () => loadFranchiseHonors()],
  [/^\/api\/franchise\/trades\/([^/]+)$/, (m) => loadFranchiseTrade(decodeURIComponent(m[1]))],
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

// Next's data cache (works under `next start`/dev). On the Cloudflare Worker
// it is a no-op: the incremental cache there is read-only (open-next.config.ts),
// so the memory layer below does the caching in production.
const cachedLoad = unstable_cache(load, ['ccc-get-json'], { revalidate: DATA_TTL_SECONDS, tags: ['ccc-data'] })

// Per-isolate memory cache of *resolved* results. A Worker isolate serves many
// requests, so a tab switch or a second visit to a game skips the database.
// Only settled values are shared: a pending promise from one request must not
// be awaited by another on Workers (cross-request promises can hang).
const MEMO_MAX = 400
const memo = new Map<string, { at: number; value: unknown }>()

function remember(path: string, value: unknown) {
  if (memo.size >= MEMO_MAX) {
    // Map keeps insertion order: drop the oldest entry.
    const oldest = memo.keys().next().value
    if (oldest !== undefined) memo.delete(oldest)
  }
  memo.set(path, { at: Date.now(), value })
}

/** Test hook: forget everything cached in memory. */
export function clearMemo() {
  memo.clear()
}

// Dedupes within one request (generateMetadata, the page and its image all
// asking for the same path); React clears it between requests.
const loadOnce = cache(async (path: string): Promise<unknown> => {
  const hit = memo.get(path)
  if (hit && Date.now() - hit.at < DATA_TTL_SECONDS * 1000) return hit.value
  const value = await cachedLoad(path)
  remember(path, value)
  return value
})

export async function getJson<T>(path: string): Promise<T | null> {
  try {
    return (await loadOnce(path)) as T
  } catch (err) {
    if (!(err instanceof LoaderError)) console.error(`[getJson ${path}]`, err)
    return null
  }
}
