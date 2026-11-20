// Cache classification for the build-time payload cache: decides how long a
// cached loader result may be reused. Pure (no DB, no fs) so it is unit-tested;
// scripts/prebuild/invalidate.ts builds the context from the database.

import { createHash } from 'node:crypto'
import type { CachedPayload } from '@/src/lib/prebuild/payload-cache'

export type CacheClass = 'volatile' | 'weekly' | 'settled'

export interface ClassifyContext {
  /** season_id of the season the site currently displays (start year; 2025 = 2025-26). */
  currentSeasonId: number
  /**
   * Clippers game ids (preseason included) played in the last 14 days or not
   * yet final: every other game is final and settled.
   */
  recentGameIds: Set<string>
  /** Player ids on the current roster, including traded. */
  rosterIds: Set<string>
  /**
   * Person keys in a move of the latest season with moves: their person-page
   * payloads (/api/franchise/moves?…player=<key>) refresh every build, so a new
   * move shows at once; everyone else's stay weekly.
   */
  currentSeasonPersonKeys: Set<string>
}

// /api/franchise/people and /api/history/seasons are volatile (the default):
// they decide which person, season and game pages exist, so a stale copy would
// leave out a page another (fresh) payload links.
const WEEKLY_PATHS = new Set(['/api/franchise/draft', '/api/franchise/honors', '/api/franchise/front-office'])

function seasonNum(raw: string | null): number | null {
  return raw !== null && /^\d+$/.test(raw) ? Number(raw) : null
}

export function classify(path: string, ctx: ClassifyContext): CacheClass {
  const url = new URL(path, 'http://ccc.local')
  const p = url.pathname
  const q = url.searchParams
  let m: RegExpMatchArray | null

  // A game's history payloads and its preview (/schedule/<id>, which only
  // redirects to /history/<id> once the game is final) settle with the game.
  if ((m = p.match(/^\/api\/history\/games\/([^/]+)(?:\/story)?$/) ?? p.match(/^\/api\/schedule\/([^/]+)$/))) {
    return ctx.recentGameIds.has(decodeURIComponent(m[1])) ? 'volatile' : 'settled'
  }

  if (p === '/api/history/games') {
    const s = seasonNum(q.get('season_id'))
    return s !== null && s < ctx.currentSeasonId ? 'settled' : 'volatile'
  }

  if ((m = p.match(/^\/api\/players\/([^/]+)\/career$/))) {
    return ctx.rosterIds.has(decodeURIComponent(m[1])) ? 'volatile' : 'settled'
  }

  if ((m = p.match(/^\/api\/players\/([^/]+)$/))) {
    if (q.has('season_id')) {
      const s = seasonNum(q.get('season_id'))
      return s !== null && s < ctx.currentSeasonId ? 'settled' : 'volatile'
    }
    if (q.get('lac_only') === 'true') {
      return ctx.rosterIds.has(decodeURIComponent(m[1])) ? 'volatile' : 'settled'
    }
    return 'volatile'
  }

  if (p === '/api/franchise/moves') {
    // A player profile's moves (~865 player pages): fresh every build only for the current roster.
    const playerId = q.get('player_id')
    if (playerId !== null) return ctx.rosterIds.has(playerId) ? 'volatile' : 'weekly'
    const s = seasonNum(q.get('season'))
    if (s !== null && s < ctx.currentSeasonId) return 'settled'
    const player = q.get('player')
    if (player !== null) return ctx.currentSeasonPersonKeys.has(player) ? 'volatile' : 'weekly'
    return 'volatile'
  }

  if (/^\/api\/franchise\/trades\/[^/]+$/.test(p) || WEEKLY_PATHS.has(p)) return 'weekly'

  return 'volatile'
}

/**
 * The person keys in a /api/franchise/moves?type=all&season=latest load (the
 * newest season's moves). Throws on a failed load or an unexpected shape, so
 * the invalidation fails before deleting anything.
 */
export function personKeysInMoves(status: number, body: unknown): Set<string> {
  if (status !== 200) throw new Error(`latest moves load failed: ${status}`)
  const moves = (body as { moves?: unknown }).moves
  if (!Array.isArray(moves)) throw new Error('latest moves payload has no moves array')
  const keys = new Set<string>()
  for (const m of moves as Array<{ people?: unknown }>) {
    if (!Array.isArray(m.people)) throw new Error('latest moves payload has a move without a people array')
    for (const p of m.people as Array<{ person_key?: unknown }>) if (typeof p.person_key === 'string') keys.add(p.person_key)
  }
  return keys
}

/** Days a cached payload may be reused. Deterministic jitter spreads expiry so builds don't all refetch at once. */
export function ttlDays(path: string, cls: CacheClass): number {
  if (cls === 'volatile') return 0
  const jitter = createHash('sha1').update(path).digest().readUInt32BE(0)
  return cls === 'weekly' ? 5 + (jitter % 5) : 60 + (jitter % 31)
}

/**
 * The player ids in a /api/players?include_traded=true load. Throws on a failed
 * load, an unexpected shape, or an empty roster (a broken roster query must not
 * mark every player's career payload as settled).
 */
export function rosterIdsFrom(status: number, body: unknown): Set<string> {
  if (status !== 200) throw new Error(`roster load failed: ${status}`)
  const players = (body as { players?: unknown } | null)?.players
  if (!Array.isArray(players)) throw new Error('roster payload has no players array')
  if (players.length === 0) throw new Error('roster payload is empty')
  return new Set((players as Array<{ player_id: unknown }>).map((p) => String(p.player_id)))
}

export type DropReason = 'volatile' | 'expired' | 'invalid'

/**
 * Why a cached entry is dropped before a build, or null when it is reused.
 * An entry whose path can't be classified (no string path, or a malformed
 * escape that makes classify throw) is 'invalid' and dropped, so one bad file
 * never aborts the sweep.
 */
export function dropReason(entry: CachedPayload, ctx: ClassifyContext, now: Date): DropReason | null {
  if (typeof entry?.path !== 'string') return 'invalid'
  let cls: CacheClass
  try {
    cls = classify(entry.path, ctx)
  } catch {
    return 'invalid'
  }
  if (cls === 'volatile') return 'volatile'
  const ageDays = (now.getTime() - new Date(entry.fetchedAt).getTime()) / 86_400_000
  // A cached non-2xx (e.g. a transient 404) lives a day at most, whatever the class,
  // so it can't keep a page missing for weeks.
  const ok = entry.status >= 200 && entry.status < 300
  const ttl = ok ? ttlDays(entry.path, cls) : Math.min(1, ttlDays(entry.path, cls))
  return ageDays <= ttl ? null : 'expired'
}

export function shouldDrop(entry: CachedPayload, ctx: ClassifyContext, now: Date): boolean {
  return dropReason(entry, ctx, now) !== null
}
