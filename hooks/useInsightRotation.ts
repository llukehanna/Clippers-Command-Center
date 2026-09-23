import { useState, useEffect, useRef } from 'react'
import { getNextIndex } from '@/src/lib/live-utils'

const FADE_MS = 200

export function useInsightRotation<T>(items: T[], intervalMs = 8000) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [visible, setVisible] = useState(true)
  const itemCount = items.length
  // Latest count for the fade callback, which may outlive the effect that scheduled it
  const countRef = useRef(itemCount)
  const fadeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    countRef.current = itemCount
  }, [itemCount])

  // Clear any pending fade on unmount only — a pending fade must still complete
  // when the interval restarts, otherwise `visible` would stick at false.
  useEffect(() => {
    return () => {
      if (fadeTimeout.current) clearTimeout(fadeTimeout.current)
    }
  }, [])

  useEffect(() => {
    if (itemCount <= 1) return // no rotation if 0 or 1 item
    const id = setInterval(() => {
      setVisible(false)
      if (fadeTimeout.current) clearTimeout(fadeTimeout.current)
      fadeTimeout.current = setTimeout(() => {
        fadeTimeout.current = null
        setActiveIndex((prev) => getNextIndex(prev, countRef.current))
        setVisible(true)
      }, FADE_MS)
    }, intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, itemCount])

  // Clamp when the list shrinks below the current index
  const clampedIndex = itemCount === 0 ? 0 : Math.min(activeIndex, itemCount - 1)

  return { activeIndex: clampedIndex, visible, items }
}
