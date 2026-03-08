'use client'

import { Surface } from '@/components/ui/surface'
import { TeamLogoWithAbbr } from '@/components/ui/team-logo'
import { cn } from '@/lib/utils'
import { formatClock } from '@/src/lib/format'

interface LiveScoreboardProps {
  game: {
    period: number
    clock: string
    home: { abbreviation: string | null; score: number }
    away: { abbreviation: string | null; score: number }
  }
  className?: string
}

function formatPeriod(period: number): string {
  if (period <= 4) return `Q${period}`
  if (period === 5) return 'OT'
  return `${period - 4}OT`
}

function logoSlug(abbr: string | null): string {
  return (abbr ?? 'LAC').toLowerCase()
}

export function LiveScoreboard({ game, className }: LiveScoreboardProps) {
  const awayAbbr = game.away.abbreviation ?? 'LAC'
  const homeAbbr = game.home.abbreviation ?? 'OPP'

  return (
    <Surface variant="scoreboard" className={cn('px-8 py-8', className)}>
      <div className="relative flex items-center justify-between gap-8">
        {/* Away: logo + abbr below, then score */}
        <div className="flex items-center gap-6">
          <TeamLogoWithAbbr abbr={awayAbbr} slug={logoSlug(game.away.abbreviation)} />
          <span className="ccc-hero-stat">{game.away.score}</span>
        </div>

        {/* Center: clock, period, LIVE */}
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border-subtle bg-white/[0.04] px-5 py-3 backdrop-blur-md shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset]">
          <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {formatClock(game.clock)}
          </span>
          <span className="ccc-section-title">{formatPeriod(game.period)}</span>
          <span className="flex items-center gap-1.5 text-[0.6875rem] font-medium uppercase tracking-wider text-primary">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
            Live
          </span>
        </div>

        {/* Home: score, then logo + abbr below */}
        <div className="flex items-center gap-6">
          <span className="ccc-hero-stat">{game.home.score}</span>
          <TeamLogoWithAbbr abbr={homeAbbr} slug={logoSlug(game.home.abbreviation)} />
        </div>
      </div>
    </Surface>
  )
}
