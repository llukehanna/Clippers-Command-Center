'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

export const NAV_LINKS = [
  { href: '/home', label: 'Home' },
  { href: '/live', label: 'Live' },
  { href: '/players', label: 'Players' },
  { href: '/schedule', label: 'Schedule' },
  { href: '/history', label: 'History' },
  { href: '/franchise', label: 'Franchise' },
  { href: '/news', label: 'News' },
] as const

export type NavHref = (typeof NAV_LINKS)[number]['href']

export const matchesTab = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`)

/**
 * Shared state for the main tabs (top nav and phone tab bar). Optimistic: the
 * clicked tab becomes current immediately, before the page arrives.
 */
export function useNavTabs() {
  const pathname = usePathname() ?? ''
  const [pending, setPending] = useState<string | null>(null)

  // Navigation finished (or went elsewhere): drop the optimistic tab.
  useEffect(() => {
    // Resetting derived UI state when the route changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPending(null)
  }, [pathname])

  const current = pending ?? NAV_LINKS.find((l) => matchesTab(pathname, l.href))?.href ?? null
  const onSelect = (href: string) => {
    if (!matchesTab(pathname, href)) setPending(href)
  }
  return { pathname, current, onSelect }
}
