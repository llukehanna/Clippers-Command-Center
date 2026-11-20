'use client'

import * as React from 'react'
import { useNow } from '@/hooks/useNow'
import { inClockWindow, type ClockWindowSpec } from '@/src/lib/ui/clock'
import { ageLabel, parseTimestamp } from '@/src/lib/ui/time'

/**
 * Shows `children` during a window of time (src/lib/ui/clock.ts). Pages are
 * prerendered, so the build and the first browser render show the build-time
 * arrangement (`initial`); after mount the browser's clock decides.
 */
export function ClockWindow({ children, ...window }: ClockWindowSpec & { children: React.ReactNode }) {
  const now = useNow(60_000)
  return inClockWindow(window, now ? now.getTime() : null) ? <>{children}</> : null
}

/**
 * "3m" since `at`, from the browser's clock, wrapped in `prefix`/`suffix`. The
 * prerendered page can't know the age, so until mount it holds the space
 * without showing a number.
 */
export function TimeAgo({ at, prefix = '', suffix = '' }: { at: string | null | undefined; prefix?: string; suffix?: string }) {
  const now = useNow(30_000)
  if (!parseTimestamp(at)) return null
  const age = now ? ageLabel(at, now) : null
  return (
    <span className={age ? undefined : 'invisible'}>
      {prefix}
      {age ?? '0m'}
      {suffix}
    </span>
  )
}
