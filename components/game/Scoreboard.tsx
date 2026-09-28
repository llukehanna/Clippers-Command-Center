'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Panel } from '@/components/ui/panel'
import { TeamLogo } from '@/components/ui/team-mark'
import { Chip } from '@/components/ui/chip'
import { StatusDot } from '@/components/ui/status-dot'
import { clockLabel, periodLabel } from '@/src/lib/ui/live'
import { teamName } from '@/src/lib/ui/teams'

export interface ScoreSide {
  abbr: string | null
  name?: string | null
  score: number | null
}

interface ScoreboardProps {
  lac: ScoreSide
  opp: ScoreSide
  lacHome: boolean
  mode: 'live' | 'delayed' | 'final'
  period?: number | null
  clock?: string | null
  /** Final mode: e.g. "Final" / "Final/OT". */
  status?: string | null
  /** Final mode: formatted date line. */
  dateLabel?: string
  children?: React.ReactNode
  className?: string
}

/** Flashes the number briefly whenever it changes. */
function Score({ value, trailing }: { value: number | null; trailing: boolean }) {
  const prev = React.useRef(value)
  const [flash, setFlash] = React.useState(false)
  React.useEffect(() => {
    if (prev.current !== value && prev.current != null) {
      // Visual acknowledgement of a live score change.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFlash(true)
      const id = setTimeout(() => setFlash(false), 1200)
      prev.current = value
      return () => clearTimeout(id)
    }
    prev.current = value
  }, [value])
  return (
    <span
      className={cn(
        'text-[56px] font-semibold leading-[0.9] tracking-[-0.06em] tabular-nums sm:text-[72px] lg:text-[88px]',
        trailing ? 'text-mute' : 'text-text',
        flash && 'flash',
      )}
    >
      {value ?? '—'}
    </span>
  )
}

function Side({ side, meta, trailing, right }: { side: ScoreSide; meta: string; trailing: boolean; right?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between gap-4 sm:justify-start sm:gap-5', right && 'sm:flex-row-reverse')}>
      <div className={cn('flex min-w-0 items-center gap-3 sm:gap-4', right && 'sm:flex-row-reverse sm:text-right')}>
        <TeamLogo abbr={side.abbr} size="lg" priority />
        <div className="min-w-0">
          <div className="truncate text-[17px] font-semibold tracking-[-0.02em] sm:text-[18px]">{side.name ?? teamName(side.abbr)}</div>
          <div className="font-mono text-[11.5px] text-mute">{meta}</div>
        </div>
      </div>
      <Score value={side.score} trailing={trailing} />
    </div>
  )
}

/** Game scoreboard. Clippers always on the left. */
export function Scoreboard({ lac, opp, lacHome, mode, period, clock, status, dateLabel, children, className }: ScoreboardProps) {
  const lacTrails = lac.score != null && opp.score != null && lac.score < opp.score
  const oppTrails = lac.score != null && opp.score != null && opp.score < lac.score
  const ot = mode === 'final' && /OT/i.test(status ?? '')

  return (
    <Panel className={cn('overflow-hidden', className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_260px_at_18%_0%,rgba(65,143,222,0.16),transparent_70%)]"
      />
      <div className="relative grid grid-cols-1 gap-4 px-5 py-5 sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-6 sm:px-8 sm:py-8">
        <div className="order-2 sm:order-1">
          <Side side={lac} meta={lacHome ? 'Home' : 'Away'} trailing={lacTrails} />
        </div>

        <div className="order-1 flex items-center gap-3 sm:order-2 sm:flex-col sm:gap-1.5 sm:text-center">
          {mode === 'final' ? (
            <>
              <span className="font-mono text-[12px] uppercase tracking-[0.16em] text-mute">Final</span>
              {ot && <Chip>OT</Chip>}
              {dateLabel && <span className="font-mono text-[11.5px] text-dim">{dateLabel}</span>}
            </>
          ) : (
            <>
              <Chip tone={mode === 'delayed' ? 'warn' : 'live'}>
                <StatusDot tone={mode === 'delayed' ? 'warn' : 'live'} />
                {mode === 'delayed' ? 'Delayed' : 'Live'}
              </Chip>
              <span className="text-[26px] font-semibold leading-none tracking-[-0.03em] tabular-nums sm:text-[34px]">
                {clockLabel(clock) || '—'}
              </span>
              <span className="font-mono text-[12px] tracking-[0.14em] text-mute">{periodLabel(period)}</span>
            </>
          )}
        </div>

        <div className="order-3">
          <Side side={opp} meta={lacHome ? 'Away' : 'Home'} trailing={oppTrails} right />
        </div>
      </div>
      {children}
    </Panel>
  )
}
