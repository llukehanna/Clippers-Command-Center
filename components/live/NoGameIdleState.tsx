'use client'

import useSWR from 'swr'
import { cn } from '@/lib/utils'

interface NoGameIdleStateProps {
  className?: string
}

interface NextGame {
  game_date?: string | null
  start_time_utc?: string | null
  opponent_abbr?: string | null
  home_away?: 'home' | 'away' | string | null
}

interface HomePayload {
  next_game?: NextGame | null
}

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })

function formatNextGame(game: NextGame): string {
  const opponent = game.opponent_abbr ?? 'TBD'
  const isHome = game.home_away === 'home'

  let dateStr = ''
  if (game.start_time_utc) {
    const d = new Date(game.start_time_utc)
    if (!isNaN(d.getTime())) {
      // Always Pacific time so SSR (UTC) and client render identically
      dateStr = d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Los_Angeles',
        timeZoneName: 'short',
      })
    }
  }
  if (!dateStr && game.game_date) {
    const d = new Date(game.game_date + 'T12:00:00')
    dateStr = isNaN(d.getTime())
      ? game.game_date
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const matchup = isHome ? `${opponent} @ LAC` : `LAC @ ${opponent}`
  return dateStr ? `Next: ${matchup} — ${dateStr}` : `Next: ${matchup}`
}

export function NoGameIdleState({ className }: NoGameIdleStateProps) {
  const { data } = useSWR<HomePayload>('/api/home', fetcher, {
    refreshInterval: 0,
    revalidateOnFocus: false,
  })

  const nextGame = data?.next_game ?? null
  // Only claim offseason once /api/home has answered with no next game
  const isOffseason = data !== undefined && nextGame === null

  return (
    <div
      className={cn(
        'min-h-[60vh] flex flex-col items-center justify-center px-6 text-center',
        className
      )}
    >
      <h1 className="text-2xl font-semibold text-foreground tracking-tight">
        No live Clippers game right now
      </h1>

      {nextGame && (
        <p className="ccc-body mt-3 text-muted-foreground">
          {formatNextGame(nextGame)}
        </p>
      )}

      {isOffseason && (
        <p className="ccc-body mt-3 text-muted-foreground">
          No upcoming games scheduled — the regular season tips off in October.
        </p>
      )}

      <p className="ccc-body mt-2 text-muted-foreground">
        Live stats and insights appear here automatically during games.
      </p>
    </div>
  )
}
