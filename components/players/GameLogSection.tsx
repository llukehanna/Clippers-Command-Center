import { BoxScoreTable, BoxScoreColumn, BoxScoreRow } from '@/components/box-score/BoxScoreTable'
import { gameTypeLabel } from '@/src/lib/game-type'

interface GameLogRow {
  game_id: string
  game_date: string
  opp: string
  /** Team the player played for (a mid-season trade shows both teams) */
  team?: string
  game_type?: 'regular' | 'play_in' | 'playoffs'
  home_away: 'home' | 'away'
  MIN: string
  PTS: number
  REB: number
  AST: number
  FG: string
  '3PT': string
  FT: string
  '+/-': number
  ts_pct_computed: number | null
}

interface GameLogSectionProps {
  gameLog: GameLogRow[]
}

const GAME_LOG_COLUMNS: BoxScoreColumn[] = [
  { key: 'date', label: 'Date' },
  { key: 'opp', label: 'Opp' },
  { key: 'ha', label: 'H/A' },
  { key: 'MIN', label: 'MIN', numeric: true },
  { key: 'PTS', label: 'PTS', numeric: true },
  { key: 'REB', label: 'REB', numeric: true },
  { key: 'AST', label: 'AST', numeric: true },
  { key: 'FG', label: 'FG' },
  { key: '3PT', label: '3PT' },
  { key: 'FT', label: 'FT' },
  { key: '+/-', label: '+/-', numeric: true },
]

export function GameLogSection({ gameLog }: GameLogSectionProps) {
  const rows: BoxScoreRow[] = gameLog.map((r) => ({
    id: r.game_id,
    date: new Date(`${r.game_date}T12:00:00Z`).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', timeZone: 'UTC',
    }),
    date__sort: r.game_date,
    opp: [
      r.opp,
      r.team && r.team !== 'LAC' ? `(w/ ${r.team})` : null,
      r.game_type ? gameTypeLabel(r.game_type) : null,
    ].filter(Boolean).join(' '),
    ha: r.home_away === 'home' ? 'H' : 'A',
    MIN: r.MIN,
    PTS: r.PTS,
    REB: r.REB,
    AST: r.AST,
    FG: r.FG,
    '3PT': r['3PT'],
    FT: r.FT,
    '+/-': r['+/-'],
  }))

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Game Log</h2>
      <BoxScoreTable
        columns={GAME_LOG_COLUMNS}
        rows={rows}
        maxHeight="max-h-[400px]"
        className="w-full"
      />
    </div>
  )
}
