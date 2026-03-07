// components/home/NextGameHero.tsx
// Server Component — prominent hero card showing the next upcoming game.

import { formatGameDate, formatGameTime } from '@/src/lib/home-utils'

interface GameOdds {
  spread: string | null
  moneyline: string | null
  over_under: string | null
}

interface NextGameProps {
  game: {
    game_id: number
    game_date: string
    start_time_utc: string | null
    opponent_abbr: string
    home_away: 'home' | 'away'
    odds: GameOdds | null
  } | null
}

export function NextGameHero({ game }: NextGameProps) {
  if (game === null) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-surface px-6 py-5">
        <p className="text-sm text-muted-foreground">No upcoming games scheduled.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-white/[0.06] bg-surface-alt px-6 py-5">
      <p className="text-[0.6875rem] uppercase tracking-widest text-muted-foreground">
        Next Game
      </p>
      <p className="mt-1 text-2xl font-bold text-foreground">
        vs {game.opponent_abbr}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {formatGameDate(game.game_date)} · {formatGameTime(game.start_time_utc)} ·{' '}
        {game.home_away === 'home' ? 'Home' : 'Away'}
      </p>

      {game.odds !== null && (
        <div className="mt-4 flex gap-6">
          <div>
            <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-muted-foreground">
              Spread
            </p>
            <p className="text-sm font-semibold text-foreground tabular-nums">
              {game.odds.spread ?? '—'}
            </p>
          </div>
          <div>
            <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-muted-foreground">
              ML
            </p>
            <p className="text-sm font-semibold text-foreground tabular-nums">
              {game.odds.moneyline ?? '—'}
            </p>
          </div>
          <div>
            <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-muted-foreground">
              O/U
            </p>
            <p className="text-sm font-semibold text-foreground tabular-nums">
              {game.odds.over_under ?? '—'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
