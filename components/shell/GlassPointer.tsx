'use client'

import { useEffect } from 'react'

/**
 * Feeds the pointer position to the glass panel under it (--mx / --my), which
 * drives the specular sheen in globals.css. One delegated, rAF-throttled
 * listener for the whole app; does nothing on touch devices.
 */
export function GlassPointer() {
  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    let frame = 0
    let last: PointerEvent | null = null
    const apply = () => {
      frame = 0
      const e = last
      if (!e) return
      const panel = (e.target as Element | null)?.closest?.('.panel') as HTMLElement | null
      if (!panel) return
      const r = panel.getBoundingClientRect()
      panel.style.setProperty('--mx', `${e.clientX - r.left}px`)
      panel.style.setProperty('--my', `${e.clientY - r.top}px`)
    }
    const onMove = (e: PointerEvent) => {
      last = e
      if (!frame) frame = requestAnimationFrame(apply)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])
  return null
}
