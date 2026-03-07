'use client'

import { cn } from '@/lib/utils'

interface StaleBannerProps {
  stale: boolean
  generatedAt?: string  // ISO timestamp string from meta.generated_at
  className?: string
}

export function StaleBanner({ stale, generatedAt, className }: StaleBannerProps) {
  if (!stale) return null

  const minutesAgo = generatedAt
    ? Math.floor((Date.now() - new Date(generatedAt).getTime()) / 60_000)
    : null

  return (
    <div
      className={cn(
        'w-full bg-highlight/10 border-b border-highlight/30 px-6 py-2 text-xs text-highlight text-center',
        className
      )}
      role="status"
      aria-live="polite"
    >
      Data delayed
      {minutesAgo !== null && minutesAgo >= 1 && ` — last updated ${minutesAgo} min ago`}
    </div>
  )
}
