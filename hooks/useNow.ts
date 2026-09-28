'use client'

import { useEffect, useState } from 'react'

/** Current time, re-rendering every `intervalMs`. Null until mounted (avoids SSR mismatch). */
export function useNow(intervalMs = 30_000): Date | null {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    // Syncing with the clock is the point of this hook.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
