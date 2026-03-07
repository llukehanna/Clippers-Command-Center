'use client'

import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function LiveDot() {
  const { data } = useSWR('/api/live', fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  // Show dot only when source is live and data is not stale
  const isLive = data?.meta?.source === 'live' && !data?.meta?.stale

  if (!isLive) return null

  return (
    <span
      className="relative flex h-2 w-2"
      aria-label="Live game in progress"
      role="status"
    >
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
    </span>
  )
}
