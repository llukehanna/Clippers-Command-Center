// src/lib/legacy-redirect.ts
// Old query-string URLs -> the path-based pages that replaced them (worker.ts
// 301s these before the edge cache), plus the runtime /api allowlist.
// Pure URL in / path out, so it is unit tested in Node.
//
// Every target is a path with no query string, so a target never matches a
// rule again (no loops). Next's `_rsc` flight key is ignored when deciding
// whether a URL is legacy; a legacy URL that carries it still redirects (the
// client follows the 301).

import { historyFilter, historyHref, playerHref, playersHref, type HistoryResult, type HistoryVenue } from './urls'
import { movesHref, parseMoveType, parseMovesSeason } from './franchise/display'

const LEGACY_KEYS: Record<string, readonly string[]> = {
  players: ['mode', 'view', 'scope'],
  player: ['season'],
  history: ['season_id', 'home_away', 'result'],
  franchise: ['season', 'type', 'player'],
  news: ['show'],
}

function hasAny(p: URLSearchParams, keys: readonly string[]): boolean {
  return keys.some((k) => p.has(k))
}

/** The path a legacy query-string URL now lives at, or null when the URL isn't legacy. */
export function legacyRedirect(url: URL): string | null {
  const params = new URLSearchParams(url.search)
  params.delete('_rsc')
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : url.pathname

  if (path === '/players') {
    if (!hasAny(params, LEGACY_KEYS.players)) return null
    return playersHref({
      mode: params.get('mode') === 'all-time' ? 'all-time' : 'roster',
      view: params.get('view') === 'table' ? 'table' : 'cards',
      scope: params.get('scope') === 'all' ? 'all' : 'active',
    })
  }

  const player = /^\/players\/([^/]+)$/.exec(path)
  if (player) {
    if (!hasAny(params, LEGACY_KEYS.player)) return null
    if (['table', 'traded', 'all-time', 'nba'].includes(player[1])) return null
    let id: string
    try {
      id = decodeURIComponent(player[1])
    } catch {
      return null
    }
    const season = params.get('season')
    return playerHref(id, season && /^\d{4}$/.test(season) ? Number(season) : null)
  }

  if (path === '/history') {
    if (!hasAny(params, LEGACY_KEYS.history)) return null
    const seasonId = params.get('season_id')
    if (!seasonId || !/^\d+$/.test(seasonId)) return '/history'
    const homeAway = params.get('home_away')
    const result = params.get('result')
    const venue: HistoryVenue = homeAway === 'home' || homeAway === 'away' ? homeAway : 'all'
    const res: HistoryResult = result === 'W' || result === 'L' ? result : 'all'
    return historyHref(seasonId, historyFilter(venue, res))
  }

  if (path === '/franchise') {
    if (!hasAny(params, LEGACY_KEYS.franchise)) return null
    const rawType = params.get('type')
    const type = rawType == null || rawType === '' ? 'trade' : parseMoveType(rawType)
    if (!type) return '/franchise'
    const playerKey = params.get('player') || null
    const filters = { type, player: playerKey }
    return movesHref({ ...filters, season: parseMovesSeason(params.get('season') ?? undefined, filters) })
  }

  if (path === '/news') {
    if (!hasAny(params, LEGACY_KEYS.news)) return null
    const show = params.get('show')
    return show === 'articles' || show === 'social' ? `/news/${show}` : '/news'
  }

  return null
}

const API_ALLOWLIST = new Set(['/api/live', '/api/cron/poll-live', '/api/media'])

/** Runtime /api routes that may reach the database; every other /api/* is a 404 in the Worker. */
export function apiAllowed(pathname: string): boolean {
  return API_ALLOWLIST.has(pathname)
}

/**
 * Only current-season games are prerendered at /schedule/<id>; for an older
 * game the 404 becomes a redirect to its History page (no database access).
 */
export function scheduleFallback(url: URL, status: number): string | null {
  if (status !== 404) return null
  const m = /^\/schedule\/(\d+)(?:\/ics)?\/?$/.exec(url.pathname)
  return m ? `/history/${m[1]}` : null
}
