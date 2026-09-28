'use client'

import Link from 'next/link'
import { TeamLogo } from '@/components/ui/team-mark'
import { useLiveData } from '@/hooks/useLiveData'
import { resolveLiveState } from '@/src/lib/ui/live'
import { NavLinks } from './NavLinks'
import { LiveStatus } from './LiveStatus'
import { OPEN_PALETTE_EVENT } from './CommandPalette'

export function TopBar() {
  const { data } = useLiveData()
  const state = resolveLiveState(data)
  const isLive = state === 'LIVE' || state === 'DATA_DELAYED'

  return (
    <header data-topbar className="sticky top-0 z-40 px-2 pt-[calc(env(safe-area-inset-top,0px)+8px)] sm:px-[14px] sm:pt-[calc(env(safe-area-inset-top,0px)+12px)]">
      <div className="glass-bar mx-auto grid max-w-[1320px] grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2.5 rounded-[22px] px-3 py-2.5 sm:px-4 md:grid-cols-[1fr_auto_1fr] md:rounded-full md:py-2">
        <Link href="/home" className="flex min-w-0 items-center gap-2.5 justify-self-start rounded-lg" aria-label="Clippers Command Center home">
          <TeamLogo abbr="LAC" size="sm" />
          <span className="truncate text-[15px] font-semibold tracking-[-0.01em]">Command Center</span>
        </Link>

        <div className="col-span-2 row-start-2 md:col-span-1 md:col-start-2 md:row-start-1">
          <NavLinks isLive={isLive} />
        </div>

        <div className="flex items-center justify-self-end gap-3">
          <LiveStatus state={state} data={data} />
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))}
            className="glass-track press flex items-center gap-2 rounded-full py-1.5 pl-3 pr-1.5 text-[13px] text-mute transition-colors duration-300 hover:text-text"
            aria-label="Search players and games"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx="7" cy="7" r="4.75" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="hidden lg:inline">Search</span>
            <kbd className="hidden rounded-full bg-white/[0.07] px-2 py-0.5 font-mono text-[10.5px] text-mute shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] sm:inline">⌘K</kbd>
          </button>
        </div>
      </div>
    </header>
  )
}
