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
const CADENCE_DATA_DELAYED_POLL_MS = 15_000
const CHIP_LIVE_POLL_MS = 30_000

/**
 * Which polling budget a `useLiveData` caller follows (spec §6.2). Every page
 * mounts the TopBar, so it must stay cheap ('chip'); only the /live page
 * follows the runner's fast cadence ('cadence').
 */
export type LiveFollowMode = 'cadence' | 'chip'

/**
 * SWR refresh interval for /api/live.
 * - 'cadence' (the /live page): follows the cadence the runner advertises,
 *   clamped to 4-30 s; backs off to a flat 15 s while DATA_DELAYED (the feed
 *   itself is behind, so polling at full speed just repeats stale reads).
 * - 'chip' (the TopBar — mounted on every page): a flat 30 s while a game is
 *   LIVE or DATA_DELAYED, never the fast cadence, so the chip doesn't
 *   multiply the site's request volume by every page view.
 * NO_ACTIVE_GAME (5 min) and final (60 s) are the same in both modes.
 */
export function livePollInterval(
  d?: { state: string; game?: { status?: string } | null; cadence?: { next_ms: number } | null },
  mode: LiveFollowMode = 'cadence'
): number {
  if (!d) return DEFAULT_LIVE_POLL_MS
  if (d.state === 'NO_ACTIVE_GAME') return IDLE_POLL_MS
  if (d.game?.status === 'final') return FINAL_POLL_MS

  if (mode === 'chip') {
    return d.state === 'LIVE' || d.state === 'DATA_DELAYED' ? CHIP_LIVE_POLL_MS : DEFAULT_LIVE_POLL_MS
  }

  if (d.state === 'DATA_DELAYED') return CADENCE_DATA_DELAYED_POLL_MS
  const hint = d.cadence?.next_ms
  return hint ? Math.min(Math.max(hint, MIN_LIVE_POLL_MS), MAX_LIVE_POLL_MS) : DEFAULT_LIVE_POLL_MS
}
