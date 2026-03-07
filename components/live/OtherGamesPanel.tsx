'use client'

import { cn } from '@/lib/utils'

interface OtherGame {
  game_id: string
  matchup: string
  home_score: number
  away_score: number
  status: string
  clock?: string
  note?: string
}

interface OtherGamesPanelProps {
  games: OtherGame[] | null | undefined
  className?: string
}

export function OtherGamesPanel({ games, className }: OtherGamesPanelProps) {
  if (!games || games.length === 0) return null

  return (
    <div className={cn('', className)}>
      <p className="text-[0.6875rem] uppercase tracking-widest text-muted-foreground mb-3">
        Around the League
      </p>
      <div>
        {games.map((game) => (
          <div
            key={game.game_id}
            className="flex flex-wrap justify-between py-2 border-b border-white/[0.04] last:border-0"
          >
            <span className="text-[0.8125rem] text-foreground">{game.matchup}</span>
            <span className="text-[0.8125rem] tabular-nums text-muted-foreground">
              {game.away_score}–{game.home_score} · {game.clock ?? game.status}
            </span>
            {game.note && (
              <span className="w-full text-[0.75rem] text-muted-foreground mt-0.5">
                {game.note}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
