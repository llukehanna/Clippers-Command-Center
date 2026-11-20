// Canonical in-app URLs for path-based page variants. Every variant is its own
// prerendered path (no query strings), so links go straight to a static page.

export type PlayersMode = 'roster' | 'all-time'
export type PlayersView = 'cards' | 'table'
export type PlayersScope = 'active' | 'all'

/**
 * The players index: `/players` (current roster, cards), `/players/table`,
 * `/players/traded` (incl. traded), `/players/traded/table`, and
 * `/players/all-time` (which has no view or scope of its own).
 */
export function playersHref(o: { mode?: PlayersMode; view?: PlayersView; scope?: PlayersScope } = {}): string {
  if (o.mode === 'all-time') return '/players/all-time'
  return `/players${o.scope === 'all' ? '/traded' : ''}${o.view === 'table' ? '/table' : ''}`
}

/** A player's profile: the default season, or one Clippers season. */
export function playerHref(id: string | number, season?: number | null): string {
  const base = `/players/${encodeURIComponent(String(id))}`
  return season == null ? base : `${base}/season/${season}`
}

export type HistoryVenue = 'all' | 'home' | 'away'
export type HistoryResult = 'all' | 'W' | 'L'
/** A History season's venue × result filter, as one path segment (`all` has none). */
export type HistoryFilter = 'all' | 'home' | 'away' | 'wins' | 'losses' | 'home-wins' | 'home-losses' | 'away-wins' | 'away-losses'

/** Every filter that has its own path (all but `all`). */
export const HISTORY_FILTERS = ['home', 'away', 'wins', 'losses', 'home-wins', 'home-losses', 'away-wins', 'away-losses'] as const satisfies readonly HistoryFilter[]

const RESULT_WORD = { W: 'wins', L: 'losses' } as const

/** The filter for a venue and a result. */
export function historyFilter(homeAway: HistoryVenue, result: HistoryResult): HistoryFilter {
  if (result === 'all') return homeAway
  return homeAway === 'all' ? RESULT_WORD[result] : `${homeAway}-${RESULT_WORD[result]}`
}

/** The venue and result a filter segment stands for; null when it isn't one. */
export function parseHistoryFilter(s: string): { homeAway: HistoryVenue; result: HistoryResult } | null {
  for (const homeAway of ['all', 'home', 'away'] as const) {
    for (const result of ['all', 'W', 'L'] as const) {
      if (historyFilter(homeAway, result) === s) return { homeAway, result }
    }
  }
  return null
}

/** A History season: `/history/season/<id>`, or one filter of it. */
export function historyHref(seasonId: string | number, filter: HistoryFilter = 'all'): string {
  const base = `/history/season/${encodeURIComponent(String(seasonId))}`
  return filter === 'all' ? base : `${base}/${filter}`
}
