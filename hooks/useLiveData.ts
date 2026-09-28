'use client'

import useSWR from 'swr'
import { livePollInterval } from '@/src/lib/live-utils'
import type { LivePayload } from '@/src/lib/ui/types'

/** Shape returned by the /api/live endpoint */
export type LiveDashboardPayload = LivePayload

const FETCH_TIMEOUT_MS = 15_000

// Abort hung requests so the page can't sit on its loading skeleton forever.
const fetcher = (url: string): Promise<LivePayload> =>
  fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  })

/**
 * Shared live feed — the TopBar and the Live page read the same SWR key.
 * Polls at the cadence the game-night runner advertises (2–30 s by game phase,
 * clamped to ≥ 4 s because the CDN caches /api/live for 2 s); 5 min when idle.
 * SWR pauses polling while the tab is hidden and refetches on focus.
 */
export function useLiveData() {
  return useSWR<LivePayload>('/api/live', fetcher, {
    refreshInterval: (d) => livePollInterval(d),
    revalidateOnFocus: true,
    dedupingInterval: 2_000,
  })
}
