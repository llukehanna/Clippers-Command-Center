'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const LINKS = [
  { href: '/home', label: 'Home' },
  { href: '/live', label: 'Live' },
  { href: '/players', label: 'Players' },
  { href: '/schedule', label: 'Schedule' },
  { href: '/history', label: 'History' },
] as const

export function NavLinks({ isLive, className }: { isLive: boolean; className?: string }) {
  const pathname = usePathname() ?? ''
  return (
    <nav
      aria-label="Main"
      className={cn('flex gap-0.5 overflow-x-auto rounded-full border border-line bg-white/[0.025] p-[3px] no-scrollbar', className)}
    >
      {LINKS.map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-[13.5px] transition-[color,background-color] duration-300 ease-premium sm:flex-none sm:px-3.5',
              active
                ? 'bg-ink-3 text-text shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_0_0_1px_var(--line)]'
                : 'text-mute hover:bg-white/[0.04] hover:text-text',
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
