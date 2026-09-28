import { BoxScoreTable, BoxScoreColumn, BoxScoreRow } from '@/components/box-score/BoxScoreTable'

interface GameLogRow {
  game_id: string
  game_date: string
  opp: string
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
    date: r.game_date,
    opp: r.opp,
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
