import { cn } from '@/lib/utils'
import { TeamLogo } from '@/components/ui/team-mark'
import type { LinePeriod } from '@/src/lib/ui/types'

const label = (p: number) => (p <= 4 ? `Q${p}` : p === 5 ? 'OT' : `${p - 4}OT`)

/** Points by period, Clippers row first; the higher score in each period is emphasized. */
export function LineScore({ periods, lacHome, oppAbbr, className }: { periods: LinePeriod[]; lacHome: boolean; oppAbbr: string; className?: string }) {
  if (!periods.length) return null
  const rows = [
    { abbr: 'LAC', pts: periods.map((p) => (lacHome ? p.home : p.away)) },
    { abbr: oppAbbr, pts: periods.map((p) => (lacHome ? p.away : p.home)) },
  ]
  return (
    <div className={cn('relative overflow-x-auto border-t border-line px-5 py-3 sm:px-8', className)}>
      <table className="mx-auto w-full min-w-[320px] max-w-[640px] border-collapse font-mono text-[12px] tabular-nums">
        <thead>
          <tr className="text-dim">
            <th className="w-16 pb-1.5 text-left font-normal" />
            {periods.map((p) => (
              <th key={p.period} className="pb-1.5 text-right font-normal tracking-[0.1em]">
                {label(p.period)}
              </th>
            ))}
            <th className="pb-1.5 pl-3 text-right font-normal tracking-[0.1em]">T</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => {
            const other = rows[1 - r].pts
            const total = row.pts.reduce((a, b) => a + b, 0)
            const otherTotal = other.reduce((a, b) => a + b, 0)
            return (
              <tr key={row.abbr}>
                <td className="py-1">
                  <span className="flex items-center gap-2 text-mute">
                    <TeamLogo abbr={row.abbr} size="xs" />
                    {row.abbr}
                  </span>
                </td>
                {row.pts.map((v, i) => (
                  <td key={i} className={cn('py-1 text-right', v > other[i] ? 'text-text' : 'text-dim')}>
                    {v}
                  </td>
                ))}
                <td className={cn('py-1 pl-3 text-right font-semibold', total > otherTotal ? 'text-text' : 'text-mute')}>{total}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
