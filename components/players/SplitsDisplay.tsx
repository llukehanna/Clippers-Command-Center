import { StatCard } from '@/components/stat-card/StatCard'

interface SplitStat {
  pts_avg: number | null
  ts_pct: number | null
}

interface Splits {
  home: SplitStat
  away: SplitStat
  wins: SplitStat
  losses: SplitStat
}

interface SplitsDisplayProps {
  splits: Splits | null
}

function fmtPts(v: number | null | undefined): string {
  return v?.toFixed(1) ?? '—'
}

function fmtTs(v: number | null | undefined): string {
  return v ? (v * 100).toFixed(1) + '% TS' : ''
}

export function SplitsDisplay({ splits }: SplitsDisplayProps) {
  if (splits === null) return null

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Splits</h2>
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Home" value={fmtPts(splits.home.pts_avg)} context={fmtTs(splits.home.ts_pct)} />
        <StatCard label="Away" value={fmtPts(splits.away.pts_avg)} context={fmtTs(splits.away.ts_pct)} />
        <StatCard label="Wins" value={fmtPts(splits.wins.pts_avg)} context={fmtTs(splits.wins.ts_pct)} />
        <StatCard label="Losses" value={fmtPts(splits.losses.pts_avg)} context={fmtTs(splits.losses.ts_pct)} />
      </div>
    </div>
  )
}
