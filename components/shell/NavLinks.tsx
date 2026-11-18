'use client'

import { useRef } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { useLens } from '@/hooks/useLens'
import { NAV_LINKS, matchesTab, useNavTabs } from '@/hooks/useNavTabs'

/**
 * Main tabs in the top bar (tablet and up; phones use MobileTabBar). Fully
 * prefetched so a switch renders from the client cache, and optimistic: the
 * lens moves to the clicked tab immediately, before the page arrives.
 */
export function NavLinks({ isLive, className }: { isLive: boolean; className?: string }) {
  const { pathname, current, onSelect } = useNavTabs()
  const ref = useRef<HTMLElement>(null)
  const lens = useLens(ref, current)

  return (
    <nav ref={ref} aria-label="Main" className={cn('glass-track relative flex rounded-full p-[3px] gap-0.5', className)}>
      <span aria-hidden className="lens pointer-events-none absolute left-0 top-0 rounded-full" style={lens} />
      {NAV_LINKS.map(({ href, label }) => {
        const active = current === href
        return (
          <Link
            key={href}
            href={href}
            prefetch
            data-active={active}
            aria-current={matchesTab(pathname, href) ? 'page' : undefined}
            onClick={() => onSelect(href)}
            className={cn(
              'press relative z-10 flex items-center justify-center gap-2 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13.5px] transition-colors duration-300 ease-premium',
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
