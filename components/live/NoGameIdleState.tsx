'use client'

import useSWR from 'swr'
import { cn } from '@/lib/utils'

interface NoGameIdleStateProps {
  className?: string
}

interface HomePayload {
  schedule?: Array<{
    opponent?: string
    home_team?: string
    game_date?: string
    game_time?: string
    home_or_away?: string
  }>
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function formatNextGame(game: NonNullable<HomePayload['schedule']>[0]): string {
  const opponent = game.opponent ?? game.home_team ?? '?'
  const isHome = game.home_or_away === 'home'

  let dateStr = ''
  if (game.game_date) {
    const d = new Date(game.game_date + (game.game_time ? 'T' + game.game_time : ''))
    if (!isNaN(d.getTime())) {
      dateStr = d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      })
    } else {
      dateStr = game.game_date
    }
  }

  const matchup = isHome ? `${opponent} @ LAC` : `LAC @ ${opponent}`
  return dateStr ? `Next: ${matchup} — ${dateStr}` : `Next: ${matchup}`
}

export function NoGameIdleState({ className }: NoGameIdleStateProps) {
  const { data } = useSWR<HomePayload>('/api/home', fetcher, {
    refreshInterval: 0,
    revalidateOnFocus: false,
  })

  const nextGame = data?.schedule?.[0] ?? null

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
        <p className="text-[0.875rem] text-muted-foreground mt-3">
          {formatNextGame(nextGame)}
        </p>
      )}

      <p className="text-[0.9375rem] text-muted-foreground mt-2">
        Live stats and insights appear here automatically during games.
      </p>
    </div>
  )
}
