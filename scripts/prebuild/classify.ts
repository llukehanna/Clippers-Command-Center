// Cache classification for the build-time payload cache: decides how long a
// cached loader result may be reused. Pure (no DB, no fs) so it is unit-tested;
// scripts/prebuild/invalidate.ts builds the context from the database.

import { createHash } from 'node:crypto'
import type { CachedPayload } from '@/src/lib/prebuild/payload-cache'

export type CacheClass = 'volatile' | 'weekly' | 'settled'

export interface ClassifyContext {
  /** season_id of the season the site currently displays (start year; 2025 = 2025-26). */
  currentSeasonId: number
  /** Clippers game ids played in the last 14 days or not yet final. */
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

// /api/franchise/people is volatile (the default): it decides which person pages
// exist, and those are linked from payloads that refresh every build.
const WEEKLY_PATHS = new Set([
  '/api/franchise/draft',
  '/api/franchise/honors',
  '/api/franchise/front-office',
  '/api/history/seasons',
])

function seasonNum(raw: string | null): number | null {
  return raw !== null && /^\d+$/.test(raw) ? Number(raw) : null
}

export function classify(path: string, ctx: ClassifyContext): CacheClass {
  const url = new URL(path, 'http://ccc.local')
  const p = url.pathname
  const q = url.searchParams
  let m: RegExpMatchArray | null

  if ((m = p.match(/^\/api\/history\/games\/([^/]+)(?:\/story)?$/))) {
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
    const s = seasonNum(q.get('season'))
    if (s !== null && s < ctx.currentSeasonId && !q.has('player_id')) return 'settled'
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

export function shouldDrop(entry: CachedPayload, ctx: ClassifyContext, now: Date): boolean {
  const cls = classify(entry.path, ctx)
  if (cls === 'volatile') return true
  const ageDays = (now.getTime() - new Date(entry.fetchedAt).getTime()) / 86_400_000
  return !(ageDays <= ttlDays(entry.path, cls))
}
