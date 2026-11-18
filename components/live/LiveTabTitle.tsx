'use client'

import { useEffect } from 'react'
import { liveTabTitle } from '@/src/lib/ui/live'
import type { LiveGame } from '@/src/lib/ui/types'

/** Puts the score in the browser tab and, until the final, swaps to the red-dot favicon. */
export function LiveTabTitle({ game }: { game: LiveGame }) {
  const title = liveTabTitle(game)

  useEffect(() => {
    const previous = document.title
    const apply = () => {
      if (document.title !== title) document.title = title
    }
    apply()
    // Next's metadata can rewrite <title> after mount; re-assert while live.
    const observer = new MutationObserver(apply)
    observer.observe(document.head, { subtree: true, childList: true, characterData: true })
    return () => {
      observer.disconnect()
      document.title = previous
    }
  }, [title])

  const final = game.status === 'final'
  useEffect(() => {
    if (final) return
    const link = document.createElement('link')
    link.rel = 'icon'
    link.type = 'image/png'
    link.href = '/favicon-live.png'
    link.dataset.live = 'true'
    document.head.appendChild(link)
    return () => link.remove()
  }, [final])

  return null
}
