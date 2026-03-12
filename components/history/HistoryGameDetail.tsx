import { BoxScoreTable, BoxScoreColumn, BoxScoreRow } from '@/components/box-score/BoxScoreTable'
import { InsightTileArea } from '@/components/live/InsightTileArea'

const HISTORY_COLUMNS: BoxScoreColumn[] = [
  { key: 'name', label: 'Player', width: 'w-40' },
  { key: 'MIN', label: 'MIN' },
  { key: 'PTS', label: 'PTS', numeric: true },
  { key: 'REB', label: 'REB', numeric: true },
  { key: 'AST', label: 'AST', numeric: true },
  { key: 'STL', label: 'STL', numeric: true },
  { key: 'BLK', label: 'BLK', numeric: true },
  { key: 'TO', label: 'TO', numeric: true },
  { key: 'FG', label: 'FG' },
  { key: '3PT', label: '3PT' },
  { key: 'FT', label: 'FT' },
  { key: '+/-', label: '+/-', numeric: true },
]

interface MappedInsight {
  insight_id: string
  category: string
  headline: string
  detail: string
  importance: number
  proof?: unknown
}

interface BoxScoreTeam {
  players: Array<Record<string, unknown>>
  totals: Record<string, unknown>
}

interface HistoryGameDetailProps {
  boxScore: {
    available: boolean
    home?: BoxScoreTeam
    away?: BoxScoreTeam
  }
  homeAbbr: string
  awayAbbr: string
  insights: MappedInsight[]
}

export function HistoryGameDetail({
  boxScore,
  homeAbbr,
  awayAbbr,
  insights,
}: HistoryGameDetailProps) {
  return (
    <div className="grid grid-cols-12 gap-6">
      {/* Box score: 8 cols */}
      <div className="col-span-8 space-y-4">
        {boxScore.available ? (
          <div className="space-y-6">
            {/* Away team box score */}
            {boxScore.away && (
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
                  {awayAbbr}
                </h3>
                <div className="rounded-xl border border-white/[0.06] bg-surface overflow-hidden">
                  <BoxScoreTable
                    columns={HISTORY_COLUMNS}
                    rows={boxScore.away.players as BoxScoreRow[]}
                  />
                </div>
              </div>
            )}

            {/* Home team box score */}
            {boxScore.home && (
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
                  {homeAbbr}
                </h3>
                <div className="rounded-xl border border-white/[0.06] bg-surface overflow-hidden">
                  <BoxScoreTable
                    columns={HISTORY_COLUMNS}
                    rows={boxScore.home.players as BoxScoreRow[]}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-white/[0.06] bg-surface px-6 py-8">
            <p className="text-sm text-muted-foreground">
              Box score not available for this game. Data is collected going forward from the live pipeline.
            </p>
          </div>
        )}
      </div>

      {/* Insights sidebar: 4 cols */}
      <div className="col-span-4">
        {insights.length > 0 && (
          <InsightTileArea insights={insights} />
        )}
      </div>
    </div>
  )
}
