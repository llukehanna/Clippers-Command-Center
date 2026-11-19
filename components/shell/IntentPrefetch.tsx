'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Matches next.config.ts staleTimes.dynamic: a prefetch older than this is refetched. */
const FRESH_MS = 60_000
/** Hover must rest this long before prefetching, so sweeping across a table doesn't fetch every row. */
const HOVER_DWELL_MS = 70

type PrefetchArg = Parameters<ReturnType<typeof useRouter>['prefetch']>[1]
const FULL = { kind: 'full' } as unknown as PrefetchArg

/** The in-app page a target points at: links, and table rows that navigate (data-href). */
function hrefOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  const el = target.closest<HTMLElement>('a[href], [data-href]')
  if (!el || el.closest('[data-no-prefetch]')) return null
  const raw = el instanceof HTMLAnchorElement ? el.getAttribute('href') : el.dataset.href
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/api/')) return null
  if (el instanceof HTMLAnchorElement && (el.target === '_blank' || el.hasAttribute('download'))) return null
  const path = raw.split('#')[0]
  if (!path || path === window.location.pathname + window.location.search) return null
  return path
}

/**
 * Prefetches a page in full the moment someone shows intent to open it: a
 * resting hover, a finger touching down, or keyboard focus. Detail pages
 * (players, games) aren't prefetched from the viewport, since lists hold
 * dozens of them; this starts their render 100–400 ms before the click lands,
 * so the page is usually ready when it does.
 */
export function IntentPrefetch() {
  const router = useRouter()

  useEffect(() => {
    const seen = new Map<string, number>()
    const go = (href: string | null) => {
      if (!href) return
      const now = Date.now()
      const at = seen.get(href)
      if (at && now - at < FRESH_MS) return
      seen.set(href, now)
      try {
        router.prefetch(href, FULL)
      } catch {
        // Prefetch is best-effort.
      }
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    let pendingHref: string | null = null
    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const href = hrefOf(e.target)
      if (href === pendingHref) return
      clearTimeout(timer)
      pendingHref = href
      if (href) timer = setTimeout(() => go(href), HOVER_DWELL_MS)
    }
    const onDown = (e: PointerEvent) => go(hrefOf(e.target))
    const onFocus = (e: FocusEvent) => go(hrefOf(e.target))

    document.addEventListener('pointerover', onOver, { passive: true })
    document.addEventListener('pointerdown', onDown, { passive: true, capture: true })
    document.addEventListener('focusin', onFocus)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointerdown', onDown, { capture: true })
      document.removeEventListener('focusin', onFocus)
    }
  }, [router])

  return null
}
