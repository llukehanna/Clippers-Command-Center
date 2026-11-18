'use client'

import { useRef } from 'react'
import Link from 'next/link'
import { CalendarDays, History, House, Newspaper, Radio, Users, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLens } from '@/hooks/useLens'
import { useLiveData } from '@/hooks/useLiveData'
import { NAV_LINKS, matchesTab, useNavTabs, type NavHref } from '@/hooks/useNavTabs'
import { resolveLiveState } from '@/src/lib/ui/live'

const ICONS: Record<NavHref, LucideIcon> = {
  '/home': House,
  '/live': Radio,
  '/players': Users,
  '/schedule': CalendarDays,
  '/history': History,
  '/news': Newspaper,
}

/**
 * Phone navigation: a floating liquid-glass tab bar in thumb reach, with the
 * same optimistic lens as the desktop tabs. Tapping the current tab scrolls
 * back to the top, like a native app.
 */
export function MobileTabBar() {
  const { pathname, current, onSelect } = useNavTabs()
  const { data } = useLiveData()
  const state = resolveLiveState(data)
  const isLive = state === 'LIVE' || state === 'DATA_DELAYED'
  const ref = useRef<HTMLDivElement>(null)
  const lens = useLens(ref, current)

  return (
    <nav
      aria-label="Main"
      data-tabbar
      className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+8px)] md:hidden"
    >
      <div ref={ref} className="glass-bar relative mx-auto grid max-w-[520px] grid-cols-6 rounded-[26px] p-[5px]">
        <span aria-hidden className="lens pointer-events-none absolute left-0 top-0 rounded-[21px]" style={lens} />
        {NAV_LINKS.map(({ href, label }) => {
          const Icon = ICONS[href]
          const active = current === href
          const here = matchesTab(pathname, href)
          return (
            <Link
              key={href}
              href={href}
              prefetch
              data-active={active}
              aria-current={here ? 'page' : undefined}
              onClick={() => {
                if (pathname === href) window.scrollTo({ top: 0, behavior: 'smooth' })
                onSelect(href)
              }}
              className={cn(
                'press relative z-10 flex min-h-[50px] flex-col items-center justify-center gap-[3px] rounded-[21px] transition-colors duration-300 ease-premium',
                active ? 'text-white' : 'text-mute',
              )}
            >
              <span className="relative">
                <Icon aria-hidden size={21} strokeWidth={active ? 2.1 : 1.7} />
                {href === '/live' && isLive && (
                  <span
                    aria-label="Game in progress"
                    className="pulse-dot absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-live ring-2 ring-[#0a111f] [--dot:#e0243f]"
                  />
                )}
              </span>
              <span className="text-[10.5px] font-medium leading-none tracking-[0.01em]">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
