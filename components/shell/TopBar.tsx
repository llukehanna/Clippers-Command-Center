'use client'

import Link from 'next/link'
import { TeamLogo } from '@/components/ui/team-mark'
import { useLiveData } from '@/hooks/useLiveData'
import { gameIsOn, resolveLiveState } from '@/src/lib/ui/live'
import { NavLinks } from './NavLinks'
import { LiveStatus } from './LiveStatus'
import { OPEN_PALETTE_EVENT } from './CommandPalette'

export function TopBar() {
  const { data } = useLiveData()
  const state = resolveLiveState(data)
  const isLive = gameIsOn(data)

  return (
    <header data-topbar className="sticky top-0 z-40 px-2 pt-[calc(env(safe-area-inset-top,0px)+8px)] sm:px-[14px] sm:pt-[calc(env(safe-area-inset-top,0px)+12px)]">
      <div className="glass-bar mx-auto grid max-w-[1320px] grid-cols-[1fr_auto] items-center gap-x-4 rounded-full py-1.5 pl-3 pr-1.5 sm:px-4 sm:py-2 md:grid-cols-[1fr_auto_1fr]">
        <Link href="/home" className="flex min-w-0 items-center gap-2.5 justify-self-start rounded-lg" aria-label="Clippers Command Center home">
          <TeamLogo abbr="LAC" size="sm" />
          <span className="truncate text-[15px] font-semibold tracking-[-0.01em] md:max-lg:hidden">Command Center</span>
        </Link>

        {/* Phones navigate from MobileTabBar at the bottom. */}
        <div className="hidden md:block">
          <NavLinks isLive={isLive} />
        </div>

        <div className="flex items-center justify-self-end gap-3">
          {isLive && <LiveStatus state={state} data={data} />}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))}
            className="glass-track press flex h-10 w-10 items-center justify-center gap-2 rounded-full text-[13px] text-mute transition-colors duration-300 hover:text-text md:h-auto md:w-auto md:justify-start md:py-1.5 md:pl-3 md:pr-1.5"
            aria-label="Search players, games and trades"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" className="md:h-3.5 md:w-3.5" fill="none" aria-hidden>
              <circle cx="7" cy="7" r="4.75" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="hidden lg:inline">Search</span>
            <kbd className="hidden rounded-full bg-white/[0.07] px-2 py-0.5 font-mono text-[10.5px] text-mute shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] md:inline">⌘K</kbd>
          </button>
        </div>
      </div>
    </header>
  )
}
