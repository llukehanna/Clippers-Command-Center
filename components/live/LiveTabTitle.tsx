'use client'

import { useEffect } from 'react'
import { liveTabTitle } from '@/src/lib/ui/live'
import type { LiveGame } from '@/src/lib/ui/types'

/** Puts the live score in the browser tab and swaps to the red-dot favicon. */
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

  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'icon'
    link.type = 'image/svg+xml'
    link.href = '/favicon-live.svg'
    link.dataset.live = 'true'
    document.head.appendChild(link)
    return () => link.remove()
  }, [])

  return null
}
