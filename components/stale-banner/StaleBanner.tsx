'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface StaleBannerProps {
  stale: boolean
  generatedAt?: string  // ISO timestamp string from meta.generated_at
  capturedAt?: string   // ISO timestamp of last actual snapshot (preferred over generatedAt)
  className?: string
}

const TICK_MS = 30_000

export function StaleBanner({ stale, generatedAt, capturedAt, className }: StaleBannerProps) {
  // Current time lives in state (ticked every 30s) so render stays pure.
  // null until mounted to avoid server/client hydration mismatch.
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    if (!stale) return
    const tick = () => setNow(Date.now())
    const initial = setTimeout(tick, 0)
    const id = setInterval(tick, TICK_MS)
    return () => {
      clearTimeout(initial)
      clearInterval(id)
    }
  }, [stale])

  if (!stale) return null

  const timeRef = capturedAt ?? generatedAt
  const minutesAgo = timeRef && now !== null
    ? Math.floor((now - new Date(timeRef).getTime()) / 60_000)
    : null

  return (
    <div
      className={cn(
        'bg-amber-950/40 border-b border-amber-800/30 px-6 py-2 flex items-center gap-2',
        className
      )}
      role="status"
      aria-live="polite"
    >
      <span className="text-[0.75rem] text-amber-400">
        Data delayed
        {minutesAgo !== null && minutesAgo >= 1 && ` — last updated ${minutesAgo} min ago`}
      </span>
    </div>
  )
}
