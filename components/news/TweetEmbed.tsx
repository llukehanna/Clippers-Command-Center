'use client'

import * as React from 'react'

declare global {
  interface Window {
    twttr?: { widgets?: { load: (el?: HTMLElement) => Promise<unknown> } }
  }
}

const WIDGETS_SRC = 'https://platform.twitter.com/widgets.js'
/** Give up on the embed (and keep the text card) if no iframe has appeared by then. */
export const EMBED_DEADLINE_MS = 8000

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
 * widgets.js inserts a placeholder iframe (visibility: hidden, 0×0) for every
 * post straight away and removes it again when the post doesn't exist, so a
 * bare iframe proves nothing. The post has rendered once X marks its iframe
 * visible and sizes it.
 */
function hasRenderedIframe(container: HTMLElement): boolean {
  const iframe = container.querySelector('iframe')
  return !!iframe && iframe.style.visibility === 'visible' && parseFloat(iframe.style.height) > 0
}

/**
 * Real X post via X's free embed widget. The fallback text card renders by
 * default (server render, no JS, while loading). When the slot scrolls near
 * the viewport, widgets.js renders the post into a separate container that
 * stays visually hidden until a rendered iframe appears in it (a
 * MutationObserver watches it); then the fallback is removed and the embed
 * shown. No rendered iframe within EMBED_DEADLINE_MS (deleted post, blocked
 * script) → the fallback stays. The blockquote is created
 * imperatively because widgets.js replaces it — React never renders or diffs
 * the embed container's children.
 */
export function TweetEmbed({ url, fallback }: { url: string; fallback: React.ReactNode }) {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const embedRef = React.useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = React.useState(false)

  React.useEffect(() => {
    const root = rootRef.current
    const embed = embedRef.current
    if (!root || !embed) return
    let cancelled = false
    let mutations: MutationObserver | null = null
    let deadline: ReturnType<typeof setTimeout> | undefined

    const stopWaiting = () => {
      mutations?.disconnect()
      mutations = null
      clearTimeout(deadline)
    }
    const checkForIframe = () => {
      if (cancelled || !hasRenderedIframe(embed)) return
      stopWaiting()
      setLoaded(true)
    }

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
        embed.replaceChildren(quote)

        mutations = new MutationObserver(checkForIframe)
        mutations.observe(embed, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
        deadline = setTimeout(stopWaiting, EMBED_DEADLINE_MS)

        loadWidgets()
          .then(() => {
            const widgets = window.twttr?.widgets
            if (cancelled || !widgets) {
              stopWaiting()
              return
            }
            return widgets.load(embed)
          })
          .then(checkForIframe)
          .catch(stopWaiting)
      },
      { rootMargin: '300px' },
    )
    io.observe(root)
    return () => {
      cancelled = true
      io.disconnect()
      stopWaiting()
    }
  }, [url])

  return (
    <div ref={rootRef}>
      {!loaded && fallback}
      <div
        ref={embedRef}
        aria-hidden={loaded ? undefined : true}
        className={loaded ? '[&_.twitter-tweet]:my-0!' : 'invisible h-0 overflow-hidden [&_.twitter-tweet]:my-0!'}
      />
    </div>
  )
}
