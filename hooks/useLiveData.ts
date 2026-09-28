'use client'

import useSWR from 'swr'
import type { LivePayload } from '@/src/lib/ui/types'

/** Shape returned by the /api/live endpoint */
export type LiveDashboardPayload = LivePayload

const FETCH_TIMEOUT_MS = 15_000
const LIVE_POLL_MS = 12_000
const IDLE_POLL_MS = 300_000

// Abort hung requests so the page can't sit on its loading skeleton forever.
const fetcher = (url: string): Promise<LivePayload> =>
  fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  })

/** Shared live feed — the TopBar and the Live page read the same SWR key. */
export function useLiveData() {
  return useSWR<LivePayload>('/api/live', fetcher, {
    // Poll fast only while a game is (or may be) in progress; back off when idle.
    refreshInterval: (d) => (d?.state === 'NO_ACTIVE_GAME' ? IDLE_POLL_MS : LIVE_POLL_MS),
    revalidateOnFocus: true,
    dedupingInterval: 6_000,
  })
}
