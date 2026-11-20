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
}

const WEEKLY_PATHS = new Set([
  '/api/franchise/draft',
  '/api/franchise/honors',
  '/api/franchise/front-office',
  '/api/franchise/people',
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
    if (q.has('player')) return 'weekly'
    return 'volatile'
  }

  if (/^\/api\/franchise\/trades\/[^/]+$/.test(p) || WEEKLY_PATHS.has(p)) return 'weekly'

  return 'volatile'
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
