import { useState, useEffect, useRef } from 'react'
import { getNextIndex } from '@/src/lib/live-utils'

export function useInsightRotation<T>(items: T[], intervalMs = 8000) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [visible, setVisible] = useState(true)
  const pendingItems = useRef<T[]>(items)

  // Store latest items without triggering rotation timer restart
  useEffect(() => {
    pendingItems.current = items
  }, [items])

  useEffect(() => {
    if (items.length <= 1) return // no rotation if 0 or 1 item
    const id = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setActiveIndex((prev) => getNextIndex(prev, pendingItems.current.length))
        setVisible(true)
      }, 200)
    }, intervalMs)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]) // intentionally omits items — rotation timer is independent of SWR refresh

  return { activeIndex, visible, items: pendingItems.current }
}
