'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { LiveDot } from './LiveDot'

const NAV_ITEMS = [
  { href: '/live', label: 'Live', showDot: true },
  { href: '/home', label: 'Home', showDot: false },
  { href: '/players', label: 'Players', showDot: false },
  { href: '/schedule', label: 'Schedule', showDot: false },
  { href: '/history', label: 'History', showDot: false },
]

export function NavLinks() {
  const pathname = usePathname()

  return (
    <nav className="flex items-center gap-5">
      {NAV_ITEMS.map(({ href, label, showDot }) => {
        const isActive = pathname === href || pathname.startsWith(href + '/')
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-1.5 text-[0.8125rem] font-medium transition-colors duration-150',
              isActive
                ? 'text-foreground border-b border-primary pb-0.5'
                : 'text-[rgba(255,255,255,0.45)] hover:text-foreground'
            )}
          >
            {label}
            {showDot && <LiveDot />}
          </Link>
        )
      })}
    </nav>
  )
}
