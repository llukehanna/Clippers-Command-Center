'use client'

import * as React from 'react'
import useSWR from 'swr'
import { livePollInterval } from '@/src/lib/live-utils'
import type { LivePayload } from '@/src/lib/ui/types'

/** Shape returned by the /api/live endpoint */
export type LiveDashboardPayload = LivePayload

const FETCH_TIMEOUT_MS = 15_000

// When each payload reached this device (device clock), recorded by the
// fetcher: render code can't read the clock, and /live's spoiler sync needs to
// know when a payload arrived, not when the page next re-rendered. Keyed by
// the payload object, which SWR keeps (and hands to every reader) as long as
// the data is unchanged, so a stamp never changes once set.
const receivedAt = new WeakMap<LivePayload, number>()

/** When `payload` reached this device (ms, device clock); undefined if it didn't come from the fetcher. */
export function payloadReceivedAt(payload: LivePayload): number | undefined {
  return receivedAt.get(payload)
}

// Abort hung requests so the page can't sit on its loading skeleton forever.
const fetcher = (url: string): Promise<LivePayload> =>
  fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json() as Promise<LivePayload>
    })
    .then((payload) => {
      if (payload && typeof payload === 'object') receivedAt.set(payload, Date.now())
      return payload
    })

export interface UseLiveDataOptions {
  /**
   * Which polling budget to follow (src/lib/live-utils.ts, spec §6.2):
   * - 'chip' (default): a flat 30 s while LIVE/DATA_DELAYED. Every page mounts
   *   the TopBar, so this is what keeps the site's Vercel request volume from
   *   scaling with page views.
   * - 'cadence': follows the game-night runner's adaptive cadence (2–30 s by
   *   game phase, clamped to ≥ 4 s). Only the /live page — the one place a fan
   *   is actually watching live — opts into this.
   */
  follow?: 'cadence' | 'chip'
}

/**
 * Shared live feed — the TopBar and the Live page read the same SWR key, but
 * each hook instance keeps its own refresh timer (SWR schedules polling per
 * hook, not per key), so the TopBar's slower 'chip' cadence never throttles
 * the /live page's 'cadence' polling, or vice versa — see live-utils.test.ts
 * and the Live v2 plan 1 report for the SWR internals this relies on.
 * SWR pauses polling while the tab is hidden and refetches on focus.
 */
export function useLiveData(options: UseLiveDataOptions = {}) {
  const follow = options.follow ?? 'chip'
  // Stable identity: SWR's polling effect depends on `refreshInterval` and
  // clears/re-arms its timer whenever it changes, so an inline arrow would
  // reset the countdown on every render (and /live re-renders every 5 s).
  const refreshInterval = React.useCallback((d?: LivePayload) => livePollInterval(d, follow), [follow])
  return useSWR<LivePayload>('/api/live', fetcher, {
    refreshInterval,
    revalidateOnFocus: true,
    dedupingInterval: 2_000,
  })
}
