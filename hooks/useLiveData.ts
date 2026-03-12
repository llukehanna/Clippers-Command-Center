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

const fetcher = (url: string): Promise<LiveDashboardPayload> =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  })

export function useLiveData() {
  return useSWR<LiveDashboardPayload>('/api/live', fetcher, {
    refreshInterval: 12_000,
    revalidateOnFocus: true,
    dedupingInterval: 6_000,
  })
}
