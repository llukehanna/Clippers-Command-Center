'use client'

import { useRouter } from 'next/navigation'
import type { GameItem } from '@/src/lib/history-utils'
import { detectOT } from '@/src/lib/history-utils'

export type { GameItem }

interface GameListTableProps {
  games: GameItem[]
}

export function GameListTable({ games }: GameListTableProps) {
  const router = useRouter()

  if (games.length === 0) {
    return (
      <div className="overflow-y-auto rounded-xl border border-white/[0.06] bg-surface">
        <p className="text-sm text-muted-foreground px-4 py-8 text-center">
          No games match the selected filters.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-y-auto rounded-xl border border-white/[0.06] bg-surface">
      <table className="w-full">
        <thead className="sticky top-0 bg-surface">
          <tr>
            <th className="text-left text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-[0.06em] px-4 h-9">
              Date
            </th>
            <th className="text-left text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-[0.06em] px-4 h-9">
              Opponent
            </th>
            <th className="text-left text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-[0.06em] px-4 h-9">
              H/A
            </th>
            <th className="text-right text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-[0.06em] px-4 h-9">
              Score
            </th>
            <th className="text-center text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-[0.06em] px-4 h-9">
              Result
            </th>
          </tr>
        </thead>
        <tbody>
          {games.map((g) => (
            <tr
              key={g.game_id}
              className="h-9 border-b border-white/[0.04] hover:bg-white/[0.06] transition-colors duration-150 cursor-pointer"
              onClick={() => router.push('/history/' + g.game_id)}
            >
              <td className="text-[0.8125rem] text-foreground px-4 tabular-nums">
                {new Date(g.game_date + 'T12:00:00').toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </td>
              <td className="text-[0.8125rem] text-foreground px-4 font-medium">
                {g.home_away === 'away' ? '@ ' : 'vs '}{g.opponent_abbr}
              </td>
              <td className="text-[0.8125rem] text-muted-foreground px-4">
                {g.home_away === 'home' ? 'Home' : 'Away'}
              </td>
              <td className="text-[0.8125rem] text-foreground px-4 tabular-nums text-right">
                {g.final_score
                  ? `${g.final_score.team}\u2013${g.final_score.opp}`
                  : '\u2014'}
                {g.final_score && detectOT(g.status) && (
                  <span className="ml-1 text-[0.625rem] text-muted-foreground font-medium">OT</span>
                )}
              </td>
              <td className="text-[0.8125rem] px-4 text-center">
                {g.result === 'W' ? (
                  <span className="text-positive font-semibold">W</span>
                ) : g.result === 'L' ? (
                  <span className="text-negative font-semibold">L</span>
                ) : (
                  '\u2014'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
