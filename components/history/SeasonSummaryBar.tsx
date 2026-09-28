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
      <StatCard label="Regular Season" value={record.overall} />
      <StatCard label="Home" value={record.home} />
      <StatCard label="Away" value={record.away} />
      {record.postseason && <StatCard label="Postseason" value={record.postseason} />}
      <StatCard
        label="Net Rating"
        value={netRating != null ? `${netRating > 0 ? '+' : ''}${netRating.toFixed(1)}` : '\u2014'}
      />
    </div>
  )
}
