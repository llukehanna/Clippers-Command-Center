'use client'

import { cn } from '@/lib/utils'
import { StatCard } from '@/components/stat-card/StatCard'
import { StatCardSkeleton } from '@/components/skeletons/StatCardSkeleton'
import { computeFtEdge } from '@/src/lib/live-utils'

interface KeyMetric {
  key: string
  label: string
  value: number
  team: string
  delta_vs_opp: number | null
}

interface KeyMetricsRowProps {
  // When null/undefined: render 5 StatCardSkeleton placeholders
  metrics: KeyMetric[] | null | undefined
  // Needed for FT edge — these are totals.FT strings "made-attempted"
  lacFt?: string  // e.g., "18-24"
  oppFt?: string  // e.g., "12-20"
  className?: string
  /** When true, use prototype grid layout (grid-cols-2 sm:grid-cols-3 lg:grid-cols-6) */
  useGridLayout?: boolean
}

function formatMetricValue(key: string, value: number): string {
  switch (key) {
    case 'efg_pct':
      return `${(value * 100).toFixed(1)}%`
    case 'tov_margin':
    case 'reb_margin': {
      const int = Math.round(value)
      return int > 0 ? `+${int}` : `${int}`
    }
    case 'pace':
      return value.toFixed(1)
    default:
      return `${value}`
  }
}

function formatDelta(key: string, delta: number | null): string | undefined {
  if (delta == null) return undefined
  switch (key) {
    case 'efg_pct': {
      const pct = (delta * 100).toFixed(1)
      return delta > 0 ? `+${pct}%` : `${pct}%`
    }
    case 'tov_margin':
    case 'reb_margin': {
      const int = Math.round(delta)
      return int > 0 ? `+${int}` : `${int}`
    }
    case 'pace': {
      const val = delta.toFixed(1)
      return delta > 0 ? `+${val}` : `${val}`
    }
    default: {
      return delta > 0 ? `+${delta}` : `${delta}`
    }
  }
}

const gridLayoutClass = 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6'
const flexLayoutClass = 'flex flex-wrap gap-3'

export function KeyMetricsRow({ metrics, lacFt, oppFt, className, useGridLayout = false }: KeyMetricsRowProps) {
  const containerClass = useGridLayout ? gridLayoutClass : flexLayoutClass
  const cardClass = useGridLayout ? '' : 'flex-1 min-w-[100px]'

  if (!metrics) {
    return (
      <div className={cn(containerClass, className)}>
        {[...Array(5)].map((_, i) => (
          <StatCardSkeleton key={i} className={cardClass} />
        ))}
      </div>
    )
  }

  const ftEdge = computeFtEdge(lacFt ?? '0-0', oppFt ?? '0-0')
  const ftValue = ftEdge > 0 ? `+${ftEdge}` : ftEdge < 0 ? `${ftEdge}` : '0'
  const ftDelta = ftEdge !== 0 ? ftValue : undefined

  return (
    <div className={cn(containerClass, className)}>
      {/* First 4 cards from API metrics (efg_pct, tov_margin, reb_margin, pace) */}
      {metrics.map((metric) => (
        <StatCard
          key={metric.key}
          className={cardClass}
          label={metric.label}
          value={formatMetricValue(metric.key, metric.value)}
          delta={formatDelta(metric.key, metric.delta_vs_opp)}
          positive={metric.delta_vs_opp != null ? metric.delta_vs_opp > 0 : undefined}
        />
      ))}

      {/* 5th card: FT Edge — computed client-side from box score totals */}
      <StatCard
        className={cardClass}
        label="FT Edge"
        value={ftValue}
        delta={ftDelta}
        positive={ftEdge > 0}
      />
    </div>
  )
}
