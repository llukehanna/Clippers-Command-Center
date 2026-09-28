import { cn } from '@/lib/utils'
import { Panel } from '@/components/ui/panel'
import { Stat, type Tone } from '@/components/ui/stat'
import { computeFtEdge } from '@/src/lib/live-utils'
import { formatSigned } from '@/src/lib/ui/odds'
import type { KeyMetric } from '@/src/lib/ui/types'

interface Cell {
  key: string
  label: string
  value: string
  sub: string
  tone: Tone
}

function describe(metric: KeyMetric, opp: string): Cell | null {
  const v = metric.value
  if (v == null) return null
  switch (metric.key) {
    case 'efg_pct': {
      const d = metric.delta_vs_opp
      return {
        key: metric.key,
        label: 'eFG%',
        value: `${(v * 100).toFixed(1)}`,
        sub: d == null ? 'effective FG%' : `${formatSigned(d * 100, 1)} vs ${opp}`,
        tone: d == null ? 'mute' : d >= 0 ? 'pos' : 'neg',
      }
    }
    case 'tov_margin': {
      // LAC turnovers minus opponent turnovers: negative is good.
      const n = Math.round(v)
      return {
        key: metric.key,
        label: 'Turnovers',
        value: formatSigned(n),
        sub: n === 0 ? `even with ${opp}` : `${Math.abs(n)} ${n < 0 ? 'fewer' : 'more'} than ${opp}`,
        tone: n === 0 ? 'mute' : n < 0 ? 'pos' : 'neg',
      }
    }
    case 'reb_margin': {
      const n = Math.round(v)
      return {
        key: metric.key,
        label: 'Rebounds',
        value: formatSigned(n),
        sub: n === 0 ? `even with ${opp}` : `${Math.abs(n)} ${n > 0 ? 'more' : 'fewer'} than ${opp}`,
        tone: n === 0 ? 'mute' : n > 0 ? 'pos' : 'neg',
      }
    }
    case 'pace':
      return { key: metric.key, label: 'Pace', value: v.toFixed(1), sub: 'possessions / 48', tone: 'mute' }
    default:
      return { key: metric.key, label: metric.label, value: String(v), sub: '', tone: 'mute' }
  }
}

/** Four API metrics plus free-throw edge from the box score totals. */
export function KeyMetrics({ metrics, lacFt, oppFt, oppAbbr }: { metrics: KeyMetric[]; lacFt?: string; oppFt?: string; oppAbbr: string }) {
  const cells = metrics.map((m) => describe(m, oppAbbr)).filter((c): c is Cell => c !== null)
  if (lacFt && oppFt) {
    const edge = computeFtEdge(lacFt, oppFt)
    cells.push({
      key: 'ft_edge',
      label: 'FT edge',
      value: formatSigned(edge),
      sub: `${lacFt.replace('-', '–')} vs ${oppFt.replace('-', '–')}`,
      tone: edge === 0 ? 'mute' : edge > 0 ? 'pos' : 'neg',
    })
  }
  if (cells.length === 0) return null
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      {cells.map((c, i) => (
        <Panel key={c.key} className={cn('p-4', cells.length % 2 === 1 && i === cells.length - 1 && 'col-span-2 sm:col-span-1')}>
          <Stat label={c.label} value={c.value} sub={c.sub} subTone={c.tone} />
        </Panel>
      ))}
    </div>
  )
}
