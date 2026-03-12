'use client'

// components/home/ScheduleTable.tsx
// Client Component — schedule table for upcoming games using BoxScoreTable.
// Must be 'use client' because BoxScoreTable is a client component.

import { BoxScoreTable, BoxScoreColumn, BoxScoreRow } from '@/components/box-score/BoxScoreTable'
import { formatGameDate, formatGameTime } from '@/src/lib/home-utils'

interface GameOdds {
  spread: string | null
  moneyline: string | null
  over_under: string | null
}

interface ScheduleGame {
  game_id: number
  game_date: string
  start_time_utc: string | null
  opponent_abbr: string
  home_away: 'home' | 'away'
  odds: GameOdds | null
}

interface ScheduleTableProps {
  games: ScheduleGame[]
}

export function ScheduleTable({ games }: ScheduleTableProps) {
  if (!games || games.length === 0) return null

  const baseColumns: BoxScoreColumn[] = [
    { key: 'opponent', label: 'Opponent' },
    { key: 'date', label: 'Date' },
    { key: 'time', label: 'Time', numeric: false },
    { key: 'location', label: 'H/A', numeric: false },
  ]

  // Always include odds columns — show '—' when unavailable (SCHED-04)
  const oddsColumns: BoxScoreColumn[] = [
    { key: 'spread', label: 'Spread', numeric: true },
    { key: 'ml', label: 'ML', numeric: true },
    { key: 'ou', label: 'O/U', numeric: true },
  ]

  const columns = [...baseColumns, ...oddsColumns]

  const rows: BoxScoreRow[] = games.map((g) => {
    const row: BoxScoreRow = {
      id: String(g.game_id),
      opponent: g.opponent_abbr,
      date: formatGameDate(g.game_date),
      time: formatGameTime(g.start_time_utc),
      location: g.home_away === 'home' ? 'Home' : 'Away',
      spread: g.odds?.spread ?? '—',
      ml: g.odds?.moneyline ?? '—',
      ou: g.odds?.over_under ?? '—',
    }

    return row
  })

  return (
    <div className="overflow-x-auto">
      <BoxScoreTable columns={columns} rows={rows} maxHeight="max-h-none" />
    </div>
  )
}
