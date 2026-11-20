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
