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

const TRADE_HREF = '/franchise/trades/'

/** Slugs of every /franchise/trades/<slug> href anywhere in a payload. */
function linkedTradeSlugs(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    if (value.startsWith(TRADE_HREF)) {
      const slug = value.slice(TRADE_HREF.length).split(/[/?#]/)[0]
      if (slug) out.add(decodeURIComponent(slug))
    }
  } else if (Array.isArray(value)) {
    for (const v of value) linkedTradeSlugs(v, out)
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) linkedTradeSlugs(v, out)
  }
  return out
}

const TRADE_BATCH = 10

/**
 * Every trade page the site links to: the Clippers trades, the trades the
 * draft and picks pages link (pick chains run through other teams' trades),
 * and, transitively, every trade those trade pages link. A linked slug whose
 * payload is a 404 is left out (it would 404 at runtime too); errors throw.
 */
export async function tradeSlugs(): Promise<string[]> {
  const [{ moves }, draft, picks] = await Promise.all([
    required<MovesPayload>('/api/franchise/moves?type=trade'),
    required<unknown>('/api/franchise/draft'),
    required<unknown>('/api/franchise/picks'),
  ])
  const seen = new Set(moves.filter((m) => m.kind_group === 'trade').map((m) => m.slug))
  for (const slug of linkedTradeSlugs([draft, picks])) seen.add(slug)

  const found: string[] = []
  let frontier = [...seen]
  while (frontier.length > 0) {
    const next: string[] = []
    for (let i = 0; i < frontier.length; i += TRADE_BATCH) {
      const batch = frontier.slice(i, i + TRADE_BATCH)
      const payloads = await Promise.all(batch.map((slug) => getJson<unknown>(`/api/franchise/trades/${encodeURIComponent(slug)}`)))
      batch.forEach((slug, j) => {
        if (payloads[j] == null) {
          console.warn(`prebuild params: trade ${slug} is linked but has no page; skipped`)
          return
        }
        found.push(slug)
        for (const linked of linkedTradeSlugs(payloads[j])) {
          if (seen.has(linked)) continue
          seen.add(linked)
          next.push(linked)
        }
      })
    }
    frontier = next
  }
  return found
}
