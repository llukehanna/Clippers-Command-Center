'use client'

import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

interface LensRect {
  x: number
  y: number
  w: number
  h: number
  glide: boolean
}

/**
 * Position of the glass "lens" behind the active item of a pill group.
 * The active item is the child marked data-active="true". Returns a style for
 * an absolutely positioned lens element; it glides when the active item
 * changes and snaps (no animation) on first paint and on resize.
 */
export function useLens(container: RefObject<HTMLElement | null>, activeKey: string | null): CSSProperties {
  const [rect, setRect] = useState<LensRect | null>(null)

  useLayoutEffect(() => {
    const el = container.current
    if (!el) return
    const measure = (glide: boolean) => {
      const active = el.querySelector<HTMLElement>('[data-active="true"]')
      setRect((prev) =>
        active
          ? { x: active.offsetLeft, y: active.offsetTop, w: active.offsetWidth, h: active.offsetHeight, glide: glide && prev !== null }
          : null,
      )
    }
    measure(true)
    // ResizeObserver fires once on observe; skip it so the glide isn't cancelled.
    let initial = true
    const ro = new ResizeObserver(() => {
      if (initial) {
        initial = false
        return
      }
      measure(false)
    })
    // Watch the items too: their widths change when the web font swaps in,
    // even though the container's own size doesn't.
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)
    let cancelled = false
    document.fonts?.ready.then(() => {
      if (!cancelled) measure(false)
    })
    return () => {
      cancelled = true
      ro.disconnect()
    }
  }, [activeKey, container])

  if (!rect) return { opacity: 0 }
  const ease = 'cubic-bezier(0.32, 0.72, 0, 1)'
  return {
    width: rect.w,
    height: rect.h,
    transform: `translate3d(${rect.x}px, ${rect.y}px, 0)`,
    opacity: 1,
    transition: rect.glide ? `transform 420ms ${ease}, width 420ms ${ease}` : 'none',
  }
}
