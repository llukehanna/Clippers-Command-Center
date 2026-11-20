// Every id a dynamic page route can be prerendered for. Read through getJson,
// so at build time they come from the payload cache (and fail closed); each
// throws when its list payload is missing rather than prerendering nothing.

import { getJson } from '@/src/lib/ui/api'
import { HISTORY_FILTERS } from '@/src/lib/urls'
import { allowsAllSeasons, ERAS, MOVE_TYPES, PATH_SAFE_PERSON_KEY } from '@/src/lib/franchise/display'
import { calendarSeasonId } from '@/src/lib/season'
import { playedGames, type HistoryGame } from '@/src/lib/ui/season'
import type { MovesPayload, PeoplePayload, PlayersPayload, SchedulePayload } from '@/src/lib/ui/types'

type SeasonsPayload = { seasons: Array<{ season_id: number }> }
type GamesPayload = { games: HistoryGame[] }

async function required<T>(path: string): Promise<T> {
  const data = await getJson<T>(path)
  if (data == null) throw new Error(`prebuild params: ${path} returned no data`)
  return data
}

const unique = (ids: string[]) => [...new Set(ids)]

const BATCH = 10

/** Runs fn over items ten at a time (spares the DB pool on a cold cache). */
async function inBatches<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += BATCH) out.push(...(await Promise.all(items.slice(i, i + BATCH).map(fn))))
  return out
}

/**
 * The first path segment of every string in a payload that starts with
 * `prefix` and whose segment matches `segment` (walks the JSON generically,
 * so it doesn't depend on payload shape).
 */
function linkedIds(value: unknown, prefix: string, segment: RegExp, out: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    if (value.startsWith(prefix)) {
      const id = decodeURIComponent(value.slice(prefix.length).split(/[/?#]/)[0])
      if (segment.test(id)) out.add(id)
    }
  } else if (Array.isArray(value)) {
    for (const v of value) linkedIds(v, prefix, segment, out)
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) linkedIds(v, prefix, segment, out)
  }
  return out
}

const linkedTradeSlugs = (value: unknown) => linkedIds(value, '/franchise/trades/', /^.+$/)
/** Internal player ids only: /players/nba/<id> is a redirect route, not a page. */
const linkedPlayerIds = (value: unknown) => linkedIds(value, '/players/', /^\d+$/)

const seasonsWithHistory = async () => (await required<SeasonsPayload>('/api/history/seasons')).seasons.map((s) => s.season_id)
const seasonGames = (seasonId: number) => required<GamesPayload>(`/api/history/games?season_id=${seasonId}&limit=200`)

/** Every season the History season picker offers (the /history/season/<id> pages). */
export async function historySeasonIds(): Promise<string[]> {
  return (await seasonsWithHistory()).map(String)
}

/** The /history/season/<id>/<filter> pages for the given seasons: each with every filter but `all`. */
export function historyFilterParams(seasonIds: string[]): Array<{ season_id: string; filter: string }> {
  return seasonIds.flatMap((season_id) => HISTORY_FILTERS.map((filter) => ({ season_id, filter })))
}

/** Played (final) Clippers games across every season with history. */
export async function historyGameIds(): Promise<string[]> {
  const lists = await inBatches(await seasonsWithHistory(), seasonGames)
  return unique(lists.flatMap((l) => playedGames(l.games).map((g) => String(g.game_id))))
}

/**
 * Upcoming games on the schedule, plus every other game of the current season:
 * a played game's preview page redirects to its history page, and links to it
 * live on in downloaded calendar files and insight cards. Played games go last.
 */
export async function scheduleGameIds(): Promise<string[]> {
  const [{ games }, seasons] = await Promise.all([required<SchedulePayload>('/api/schedule'), seasonsWithHistory()])
  const upcoming = games.map((g) => String(g.game_id))
  const current = seasons.length > 0 ? (await seasonGames(Math.max(...seasons))).games : []
  const played = new Set(playedGames(current).map((g) => String(g.game_id)))
  const rest = current.map((g) => String(g.game_id)).filter((id) => !played.has(id))
  return unique([...upcoming, ...rest, ...played])
}

/** The franchise payloads whose rendered pages link players and trades. */
const FRANCHISE_PAGES = ['draft', 'contracts', 'picks', 'honors', 'front-office', 'people'].map((p) => `/api/franchise/${p}`)

/**
 * Every player page the site links to: all-time Clippers players, this
 * season's roster (incl. traded), and every /players/<id> link on the
 * franchise pages, the trade pages and the per-season moves lists.
 */
export async function playerIds(): Promise<string[]> {
  const [allTime, roster, franchise, trades, latestMoves] = await Promise.all([
    required<{ players: Array<{ player_id: string }> }>('/api/players/all-time'),
    required<PlayersPayload>('/api/players?include_traded=true'),
    Promise.all(FRANCHISE_PAGES.map((p) => required<unknown>(p))),
    tradeClosure(),
    required<MovesPayload>('/api/franchise/moves?type=all&season=latest'),
  ])
  const seasonMoves = await inBatches(latestMoves.seasons, (s) => required<unknown>(`/api/franchise/moves?type=all&season=${s}`))
  const linked = linkedPlayerIds([franchise, [...trades.values()], seasonMoves])
  return unique([...allTime.players.map((p) => String(p.player_id)), ...roster.players.map((p) => String(p.player_id)), ...linked])
}

type CareerSeasons = { seasons: { regular: Array<{ season_id: number }>; playoffs: Array<{ season_id: number }> } }

/**
 * The /players/<id>/season/<season> pages for the given players: every season
 * the profile's season picker (CareerSeasons) links, i.e. each season in the
 * player's Clippers career payload, regular and playoffs. Players with no
 * Clippers seasons (or no career payload; only numeric ids have one) get none.
 */
export async function playerSeasonParams(ids: string[]): Promise<Array<{ player_id: string; season_id: string }>> {
  const numeric = ids.filter((id) => /^\d{1,15}$/.test(id))
  const careers = await inBatches(numeric, (id) => getJson<CareerSeasons>(`/api/players/${id}/career`))
  return numeric.flatMap((player_id, i) => {
    const c = careers[i]
    if (!c) return []
    const seasons = new Set([...c.seasons.regular, ...c.seasons.playoffs].map((s) => s.season_id))
    return [...seasons].sort((a, b) => a - b).map((s) => ({ player_id, season_id: String(s) }))
  })
}

/**
 * Every trade page the site links to, with its payload: the Clippers trades,
 * the trades the draft and picks pages link (pick chains run through other
 * teams' trades), and, transitively, every trade those trade pages link. A
 * linked slug whose payload is a 404 is left out (it would 404 at runtime too);
 * errors throw.
 */
async function tradeClosure(): Promise<Map<string, unknown>> {
  const [{ moves }, draft, picks] = await Promise.all([
    required<MovesPayload>('/api/franchise/moves?type=trade'),
    required<unknown>('/api/franchise/draft'),
    required<unknown>('/api/franchise/picks'),
  ])
  const seen = new Set(moves.filter((m) => m.kind_group === 'trade').map((m) => m.slug))
  for (const slug of linkedTradeSlugs([draft, picks])) seen.add(slug)

  const found = new Map<string, unknown>()
  let frontier = [...seen]
  while (frontier.length > 0) {
    const batch = frontier
    const payloads = await inBatches(batch, (slug) => getJson<unknown>(`/api/franchise/trades/${encodeURIComponent(slug)}`))
    frontier = []
    batch.forEach((slug, j) => {
      if (payloads[j] == null) {
        console.warn(`prebuild params: trade ${slug} is linked but has no page; skipped`)
        return
      }
      found.set(slug, payloads[j])
      for (const linked of linkedTradeSlugs(payloads[j])) {
        if (seen.has(linked)) continue
        seen.add(linked)
        frontier.push(linked)
      }
    })
  }
  return found
}

/** Every trade page the site links to (see tradeClosure). */
export async function tradeSlugs(): Promise<string[]> {
  return [...(await tradeClosure()).keys()]
}

/**
 * Every season a Moves page links for a type, oldest first: the era ribbon
 * links each season from 1970 to the later of the calendar season and the
 * newest season with a move (with or without moves of that type: an empty one
 * shows the empty state), and the season select, the newer/older links and
 * every other season link come from the payload's `seasons`. `seasons` doesn't
 * depend on the type, so the union over the type tabs' payloads is every
 * type's list (and loads the /franchise/moves/<type> pages' payloads).
 */
export async function moveSeasonIds(calendarSeason: number = calendarSeasonId()): Promise<string[]> {
  const lists = await Promise.all(
    MOVE_TYPES.map(async (t) => {
      const path = `/api/franchise/moves?type=${t}&season=latest`
      const { seasons } = await required<Partial<Pick<MovesPayload, 'seasons'>>>(path)
      if (!Array.isArray(seasons) || seasons.length === 0) throw new Error(`prebuild params: ${path} has no seasons`)
      return seasons
    }),
  )
  const listed = lists.flat()
  const last = Math.max(calendarSeason, ...listed)
  const ribbon = Array.from({ length: Math.max(0, last - ERAS[0].first + 1) }, (_, i) => ERAS[0].first + i)
  return [...new Set([...ribbon, ...listed])].sort((a, b) => a - b).map(String)
}

/** The /franchise/moves/<type>/<season> pages for the given seasons: every type, plus `all` where it's offered (Trades). */
export function moveSeasonParams(seasonIds: string[]): Array<{ type: string; season: string }> {
  return [
    ...MOVE_TYPES.flatMap((type) => seasonIds.map((season) => ({ type, season }))),
    ...MOVE_TYPES.filter((type) => allowsAllSeasons({ type, player: null })).map((type) => ({ type, season: 'all' })),
  ]
}

/**
 * Every person in a Clippers move (the people search; every player filter link
 * names one of them), plus anyone in the newest season's moves the people list
 * doesn't have yet (belt and braces: both payloads refresh every build). Throws
 * on a key whose link wouldn't reach its prerendered page (see personSegment)
 * rather than shipping a link that 404s.
 */
export async function personKeys(): Promise<string[]> {
  const [people, latest] = await Promise.all([
    required<PeoplePayload>('/api/franchise/people'),
    required<MovesPayload>('/api/franchise/moves?type=all&season=latest'),
  ])
  const keys = unique([...people.people.map((p) => p.person_key), ...latest.moves.flatMap((m) => m.people.map((p) => p.person_key))])
  const unsafe = keys.filter((k) => !PATH_SAFE_PERSON_KEY.test(k))
  if (unsafe.length > 0) throw new Error(`prebuild params: person keys not safe in a path: ${unsafe.join(', ')}`)
  return keys
}
