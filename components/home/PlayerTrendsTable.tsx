'use client'
import Link from 'next/link'

interface PlayerTrendRow {
  player_id: number
  name: string
  pts_avg: number
  reb_avg: number
  ast_avg: number
  ts_pct: null
}

export function PlayerTrendsTable({ players }: { players: PlayerTrendRow[] }) {
  if (!players?.length) return null

  return (
    <div className="overflow-x-auto rounded-lg border border-white/[0.06] bg-surface">
      <table className="w-full">
        <thead className="border-b border-white/[0.04]">
          <tr>
            <th className="px-3 py-2 text-left text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-[0.06em]">Player</th>
            <th className="px-3 py-2 text-right text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-[0.06em]">PPG</th>
            <th className="px-3 py-2 text-right text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-[0.06em]">RPG</th>
            <th className="px-3 py-2 text-right text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-[0.06em]">APG</th>
            <th className="px-3 py-2 text-right text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-[0.06em]">TS%</th>
            <th className="px-3 py-2 text-right text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-[0.06em]">L5 Δ</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.player_id} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors h-9">
              <td className="px-3 py-2 text-[0.8125rem] font-medium text-left">
                <Link
                  href={`/players/${p.player_id}`}
                  className="text-foreground hover:text-foreground/80 transition-colors cursor-pointer"
                >
                  {p.name}
                </Link>
              </td>
              <td className="px-3 py-2 text-[0.8125rem] text-foreground text-right tabular-nums">{p.pts_avg.toFixed(1)}</td>
              <td className="px-3 py-2 text-[0.8125rem] text-foreground text-right tabular-nums">{p.reb_avg.toFixed(1)}</td>
              <td className="px-3 py-2 text-[0.8125rem] text-foreground text-right tabular-nums">{p.ast_avg.toFixed(1)}</td>
              <td className="px-3 py-2 text-[0.8125rem] text-muted-foreground text-right tabular-nums">—</td>
              <td className="px-3 py-2 text-[0.8125rem] text-muted-foreground text-right tabular-nums">—</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
