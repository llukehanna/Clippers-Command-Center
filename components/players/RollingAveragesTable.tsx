import { cn } from '@/lib/utils'
import {
  deriveAverages,
  l5ColorClass,
  GameLogRow,
  SeasonAverages,
} from '@/src/lib/player-utils'

interface TrendSummary {
  window_games: number
  pts_avg: number | null
  reb_avg: number | null
  ast_avg: number | null
  ts_pct: number | null
  efg_pct: number | null
  minutes_avg: number | null
}

interface RollingAveragesTableProps {
  trend_summary: TrendSummary | null
  season_averages: SeasonAverages | null
  game_log: GameLogRow[]
}

function fmt(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : v.toFixed(1)
}

function fmtTs(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : (v * 100).toFixed(1) + '%'
}

export function RollingAveragesTable({
  trend_summary,
  season_averages,
  game_log,
}: RollingAveragesTableProps) {
  const derived = deriveAverages(game_log)

  const rows = [
    {
      label: 'PTS',
      l5: fmt(derived.l5.pts),
      l10: fmt(trend_summary?.pts_avg ?? null),
      season: fmt(season_averages?.pts_avg ?? null),
      l5ColorClass: l5ColorClass(derived.l5.pts, trend_summary?.pts_avg ?? null),
    },
    {
      label: 'REB',
      l5: fmt(derived.l5.reb),
      l10: fmt(trend_summary?.reb_avg ?? null),
      season: fmt(season_averages?.reb_avg ?? null),
      l5ColorClass: l5ColorClass(derived.l5.reb, trend_summary?.reb_avg ?? null),
    },
    {
      label: 'AST',
      l5: fmt(derived.l5.ast),
      l10: fmt(trend_summary?.ast_avg ?? null),
      season: fmt(season_averages?.ast_avg ?? null),
      l5ColorClass: l5ColorClass(derived.l5.ast, trend_summary?.ast_avg ?? null),
    },
    {
      label: 'TS%',
      l5: fmtTs(derived.l5.ts),
      l10: fmtTs(trend_summary?.ts_pct ?? null),
      season: fmtTs(season_averages?.ts_pct ?? null),
      l5ColorClass: l5ColorClass(derived.l5.ts, trend_summary?.ts_pct ?? null),
    },
  ]

  return (
    <div className="bg-surface border border-white/[0.06] rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">
          Rolling Averages
        </h2>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-left py-2 px-4 text-xs text-muted-foreground font-medium">
              Stat
            </th>
            <th className="text-right py-2 px-4 text-xs text-muted-foreground font-medium">
              L5
            </th>
            <th className="text-right py-2 px-4 text-xs text-muted-foreground font-medium">
              L10
            </th>
            <th className="text-right py-2 px-4 text-xs text-muted-foreground font-medium">
              Season
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-white/[0.04]">
              <td className="py-2.5 px-4 text-muted-foreground">{row.label}</td>
              <td
                className={cn(
                  'py-2.5 px-4 text-right tabular-nums font-medium',
                  row.l5ColorClass
                )}
              >
                {row.l5}
              </td>
              <td className="py-2.5 px-4 text-right tabular-nums text-foreground">
                {row.l10}
              </td>
              <td className="py-2.5 px-4 text-right tabular-nums text-foreground">
                {row.season}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
