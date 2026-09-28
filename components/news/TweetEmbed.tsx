'use client'

import * as React from 'react'

declare global {
  interface Window {
    twttr?: { widgets: { load: (el?: HTMLElement) => Promise<unknown> } }
  }
}

const WIDGETS_SRC = 'https://platform.twitter.com/widgets.js'
let widgetsPromise: Promise<void> | null = null

function loadWidgets(): Promise<void> {
  if (window.twttr?.widgets) return Promise.resolve()
  widgetsPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = WIDGETS_SRC
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('widgets.js failed to load'))
    document.head.appendChild(s)
  })
  return widgetsPromise
}

/**
 * Real X post via X's free embed widget. The script loads only when the post
 * scrolls near the viewport; if it can't render (deleted post, blocked script),
 * the fallback shows instead. The blockquote is created imperatively because
 * widgets.js replaces it — React never renders or diffs it.
 */
export function TweetEmbed({ url, fallback }: { url: string; fallback: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    let cancelled = false
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        const quote = document.createElement('blockquote')
        quote.className = 'twitter-tweet'
        quote.setAttribute('data-theme', 'dark')
        quote.setAttribute('data-dnt', 'true')
        const a = document.createElement('a')
        a.href = url
        quote.appendChild(a)
        el.replaceChildren(quote)
        loadWidgets()
          .then(() => window.twttr!.widgets.load(el))
          .then(() => new Promise((r) => setTimeout(r, 1500)))
          .then(() => {
            if (!cancelled && !el.querySelector('iframe')) setFailed(true)
          })
          .catch(() => {
            if (!cancelled) setFailed(true)
          })
      },
      { rootMargin: '300px' },
    )
    io.observe(el)
    return () => {
      cancelled = true
      io.disconnect()
    }
  }, [url])

  if (failed) return <>{fallback}</>
  return <div ref={ref} className="min-h-[140px] [&_.twitter-tweet]:my-0!" />
}
