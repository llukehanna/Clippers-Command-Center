import { StatCard } from '@/components/stat-card/StatCard'
import { computeSeasonRecord } from '@/src/lib/history-utils'
import type { GameItem } from '@/src/lib/history-utils'

interface SeasonSummaryBarProps {
  games: GameItem[]
  netRating?: number | null
}

export function SeasonSummaryBar({ games, netRating }: SeasonSummaryBarProps) {
  const record = computeSeasonRecord(games)

  return (
    <div className="flex gap-3">
      <StatCard label="Overall" value={record.overall} />
      <StatCard label="Home" value={record.home} />
      <StatCard label="Away" value={record.away} />
      <StatCard label="Net Rating" value={netRating != null ? netRating.toFixed(1) : '\u2014'} />
    </div>
  )
}
