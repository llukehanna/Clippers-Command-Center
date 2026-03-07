'use client'

import useSWR from 'swr'
import type { LiveDashboardPayload } from '@/src/lib/types/live'

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
