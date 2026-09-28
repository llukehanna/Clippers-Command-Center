'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { TeamLogo } from '@/components/ui/team-mark'
import { StatusDot } from '@/components/ui/status-dot'
import { clockLabel, periodLabel } from '@/src/lib/ui/live'
import type { ScoreSide } from '@/components/game/Scoreboard'

/**
 * Slim score bar that slides in under the top bar once the main scoreboard
 * (the sentinel) scrolls out of view.
 */
export function StickyScore({
  sentinel,
  lac,
  opp,
  period,
  clock,
  delayed,
}: {
  sentinel: React.RefObject<HTMLElement | null>
  lac: ScoreSide
  opp: ScoreSide
  period: number | null
  clock: string | null
  delayed: boolean
}) {
  const [visible, setVisible] = React.useState(false)
  const [top, setTop] = React.useState(0)

  React.useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const header = document.querySelector('header')
    const measure = () => setTop(header?.getBoundingClientRect().height ?? 0)
    measure()
    window.addEventListener('resize', measure)
    const io = new IntersectionObserver(([entry]) => setVisible(!entry.isIntersecting && entry.boundingClientRect.top < 0), {
      threshold: 0,
    })
    io.observe(el)
    return () => {
      io.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [sentinel])

  return (
    <div
      aria-hidden={!visible}
      className={cn(
        'fixed inset-x-0 z-30 border-b border-line bg-[rgba(8,13,24,0.9)] backdrop-blur-xl transition-[transform,opacity] duration-500 ease-premium',
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-3 opacity-0',
      )}
      style={{ top }}
    >
      <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-4 px-3.5 py-2 sm:px-[22px]">
        <div className="flex items-center gap-4 tabular-nums">
          <span className="flex items-center gap-2 text-[15px] font-semibold">
            <TeamLogo abbr={lac.abbr} size="xs" /> {lac.score ?? '—'}
          </span>
          <span className="text-dim">–</span>
          <span className="flex items-center gap-2 text-[15px] font-semibold">
            {opp.score ?? '—'} <TeamLogo abbr={opp.abbr} size="xs" />
          </span>
        </div>
        <span className="flex items-center gap-2 font-mono text-[12px] text-mute tabular-nums">
          <StatusDot tone={delayed ? 'warn' : 'live'} />
          {periodLabel(period)} {clockLabel(clock)}
        </span>
      </div>
    </div>
  )
}
