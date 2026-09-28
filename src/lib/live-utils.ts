/** Parses "made-attempted" FT string (e.g., "18-24") and returns made count. */
function parseFtMade(ft: string): number {
  const made = parseInt(ft.split('-')[0], 10)
  return isNaN(made) ? 0 : made
}

/**
 * Computes FT made delta: LAC FTM minus opponent FTM.
 * Both params are "made-attempted" strings from box_score.teams[].totals.FT.
 */
export function computeFtEdge(lacFt: string, oppFt: string): number {
  return parseFtMade(lacFt) - parseFtMade(oppFt)
}

/**
 * Returns the next circular index for insight rotation.
 * Extracted as a pure function so rotation logic is testable without jsdom.
 * Imported by hooks/useInsightRotation.ts.
 */
export function getNextIndex(current: number, length: number): number {
  if (length <= 1) return 0
  return (current + 1) % length
}

const MIN_STALE_MS = 30_000
const STALE_GRACE_MS = 20_000
const LEGACY_CADENCE_MS = 12_000

/**
 * How old the runner's live state may get before /api/live calls the feed
 * delayed. The runner rewrites it at least every 15 s and polls at
 * cadence.next_ms, so anything past next_ms + 20 s (min 30 s) means it stopped.
 */
export function staleThresholdMs(cadence?: { next_ms: number } | null): number {
  return Math.max(MIN_STALE_MS, (cadence?.next_ms ?? LEGACY_CADENCE_MS) + STALE_GRACE_MS)
}

const IDLE_POLL_MS = 300_000
const FINAL_POLL_MS = 60_000
const DEFAULT_LIVE_POLL_MS = 12_000
const MIN_LIVE_POLL_MS = 4_000   // the CDN caches /api/live for 2 s; faster polls only re-read the cache
const MAX_LIVE_POLL_MS = 30_000

/** SWR refresh interval for /api/live, following the cadence the runner advertises. */
export function livePollInterval(
  d?: { state: string; game?: { status?: string } | null; cadence?: { next_ms: number } | null }
): number {
  if (!d) return DEFAULT_LIVE_POLL_MS
  if (d.state === 'NO_ACTIVE_GAME') return IDLE_POLL_MS
  if (d.game?.status === 'final') return FINAL_POLL_MS
  const hint = d.cadence?.next_ms
  return hint ? Math.min(Math.max(hint, MIN_LIVE_POLL_MS), MAX_LIVE_POLL_MS) : DEFAULT_LIVE_POLL_MS
}
