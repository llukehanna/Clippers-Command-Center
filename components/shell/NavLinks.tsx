'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useLens } from '@/hooks/useLens'

const LINKS = [
  { href: '/home', label: 'Home' },
  { href: '/live', label: 'Live' },
  { href: '/players', label: 'Players' },
  { href: '/schedule', label: 'Schedule' },
  { href: '/history', label: 'History' },
  { href: '/news', label: 'News' },
] as const

const matches = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`)

/**
 * Main tabs. Fully prefetched so a switch renders from the client cache, and
 * optimistic: the lens moves to the clicked tab immediately, before the page
 * arrives.
 */
export function NavLinks({ isLive, className }: { isLive: boolean; className?: string }) {
  const pathname = usePathname() ?? ''
  const [pending, setPending] = useState<string | null>(null)
  const ref = useRef<HTMLElement>(null)

  // Navigation finished (or went elsewhere): drop the optimistic tab.
  useEffect(() => {
    // Resetting derived UI state when the route changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPending(null)
  }, [pathname])

  const current = pending ?? LINKS.find((l) => matches(pathname, l.href))?.href ?? null
  const lens = useLens(ref, current)

  return (
    <nav
      ref={ref}
      aria-label="Main"
      className={cn('glass-track relative flex overflow-x-auto rounded-full p-[3px] no-scrollbar sm:gap-0.5', className)}
    >
      <span aria-hidden className="lens pointer-events-none absolute left-0 top-0 rounded-full" style={lens} />
      {LINKS.map(({ href, label }) => {
        const active = current === href
        return (
          <Link
            key={href}
            href={href}
            prefetch
            data-active={active}
            aria-current={matches(pathname, href) ? 'page' : undefined}
            onClick={() => {
              if (!matches(pathname, href)) setPending(href)
            }}
            className={cn(
              'press relative z-10 flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-[7px] py-1.5 text-[13px] sm:gap-2 sm:text-[13.5px] transition-colors duration-300 ease-premium sm:flex-none sm:px-3.5',
              active ? 'text-white' : 'text-mute hover:text-text',
            )}
          >
            {href === '/live' && isLive && (
              <span aria-label="Game in progress" className="h-1.5 w-1.5 rounded-full bg-live shadow-[0_0_0_3px_rgba(224,36,63,0.2)]" />
            )}
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
