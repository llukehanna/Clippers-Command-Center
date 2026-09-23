'use client'

import useSWR from 'swr'
import type { MetaEnvelope } from '@/src/lib/api-utils'

/** Shape returned by the /api/live endpoint */
export interface LiveDashboardPayload {
  meta: MetaEnvelope
  /** ISO timestamp of when the last real snapshot was captured — only present during DATA_DELAYED */
  snapshot_captured_at?: string
  // Game data and other fields are present when a game is active
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

const FETCH_TIMEOUT_MS = 15_000
const LIVE_POLL_MS = 12_000
const IDLE_POLL_MS = 300_000

// Abort hung requests so the page can't sit on its loading skeleton forever.
const fetcher = (url: string): Promise<LiveDashboardPayload> =>
  fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  })

export function useLiveData() {
  return useSWR<LiveDashboardPayload>('/api/live', fetcher, {
    // Poll fast only while a game is (or may be) in progress; back off when idle.
    refreshInterval: (d) => (d?.state === 'NO_ACTIVE_GAME' ? IDLE_POLL_MS : LIVE_POLL_MS),
    revalidateOnFocus: true,
    dedupingInterval: 6_000,
  })
}
