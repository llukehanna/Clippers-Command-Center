'use client'

import { Surface } from '@/components/ui/surface'
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
    <div className={cn(className)}>
      <p className="ccc-section-title mb-3">
        Around the League
      </p>
      <Surface variant="card" className="p-5">
        {games.map((game) => (
          <div
            key={game.game_id}
            className="flex flex-wrap justify-between border-b border-border-subtle py-2 last:border-0"
          >
            <span className="ccc-body text-foreground">{game.matchup}</span>
            <span className="ccc-body tabular-nums text-muted-foreground">
              {game.away_score}–{game.home_score} · {game.clock ?? game.status}
            </span>
            {game.note && (
              <span className="ccc-body mt-0.5 w-full text-[0.75rem] text-muted-foreground">
                {game.note}
              </span>
            )}
          </div>
        ))}
      </Surface>
    </div>
  )
}
