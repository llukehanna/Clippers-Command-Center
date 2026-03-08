'use client'

import { NavLinkCapsule } from '@/components/ui/nav-link-capsule'
import { usePathname } from 'next/navigation'
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
    <nav className="flex items-center gap-0.5">
      {NAV_ITEMS.map(({ href, label, showDot }) => {
        const isActive = pathname === href || pathname.startsWith(href + '/')
        return (
          <NavLinkCapsule key={href} href={href} active={isActive}>
            <span className="inline-flex items-center gap-1.5">
              {label}
              {showDot && <LiveDot />}
            </span>
          </NavLinkCapsule>
        )
      })}
    </nav>
  )
}
