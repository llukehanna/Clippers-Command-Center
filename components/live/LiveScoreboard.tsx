'use client'

import { cn } from '@/lib/utils'
import { formatClock } from '@/src/lib/format'

interface LiveScoreboardProps {
  game: {
    period: number
    clock: string
    home: { abbreviation: string; score: number }
    away: { abbreviation: string; score: number }
  }
  className?: string
}

function formatPeriod(period: number): string {
  if (period <= 4) return `Q${period}`
  if (period === 5) return 'OT'
  return `${period - 4}OT`
}

export function LiveScoreboard({ game, className }: LiveScoreboardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-white/[0.06] bg-surface-alt px-8 py-6',
        className
      )}
    >
      <div className="flex items-center justify-between">
        {/* Away team */}
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            {game.away.abbreviation}
          </span>
          <span className="text-5xl font-bold tabular-nums tracking-tight text-foreground">
            {game.away.score}
          </span>
        </div>

        {/* Center: period and clock */}
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {formatPeriod(game.period)}
          </span>
          <span className="text-base text-muted-foreground tabular-nums">
            {formatClock(game.clock)}
          </span>
        </div>

        {/* Home team */}
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            {game.home.abbreviation}
          </span>
          <span className="text-5xl font-bold tabular-nums tracking-tight text-foreground">
            {game.home.score}
          </span>
        </div>
      </div>
    </div>
  )
}
