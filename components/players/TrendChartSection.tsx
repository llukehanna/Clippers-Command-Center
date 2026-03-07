'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { LineChartWrapper } from '@/components/charts/LineChartWrapper'
import { mergeChartSeries } from '@/src/lib/player-utils'

type Metric = 'PTS' | 'REB' | 'AST' | 'TS%'

type ChartPoint = { game_date: string; value: number | null }

interface TrendChartSectionProps {
  charts: {
    rolling_pts_l5: ChartPoint[]
    rolling_pts_l10: ChartPoint[]
    rolling_ts_l5: ChartPoint[]
    rolling_ts_l10: ChartPoint[]
    rolling_reb_l5: ChartPoint[]
    rolling_reb_l10: ChartPoint[]
    rolling_ast_l5: ChartPoint[]
    rolling_ast_l10: ChartPoint[]
  }
}

const METRICS: Metric[] = ['PTS', 'REB', 'AST', 'TS%']

export function TrendChartSection({ charts }: TrendChartSectionProps) {
  const [activeMetric, setActiveMetric] = useState<Metric>('PTS')

  const metricKeys: Record<Metric, { l5: ChartPoint[]; l10: ChartPoint[] }> = {
    PTS: { l5: charts.rolling_pts_l5, l10: charts.rolling_pts_l10 },
    REB: { l5: charts.rolling_reb_l5, l10: charts.rolling_reb_l10 },
    AST: { l5: charts.rolling_ast_l5, l10: charts.rolling_ast_l10 },
    'TS%': { l5: charts.rolling_ts_l5, l10: charts.rolling_ts_l10 },
  }

  const { l5, l10 } = metricKeys[activeMetric]
  const chartData = mergeChartSeries(l5, l10)

  return (
    <div className="bg-surface border border-white/[0.06] rounded-xl p-4 space-y-3">
      <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Trends</h2>
      <div className="flex gap-1 p-1 bg-surface rounded-lg border border-white/[0.06] w-fit">
        {METRICS.map((m) => (
          <button
            key={m}
            onClick={() => setActiveMetric(m)}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              activeMetric === m
                ? 'bg-surface-alt text-foreground'
                : 'text-muted-foreground hover:text-foreground cursor-pointer'
            )}
          >
            {m}
          </button>
        ))}
      </div>
      {chartData.length === 0 ? (
        <p className="text-muted-foreground text-sm py-8 text-center">No chart data available</p>
      ) : (
        <LineChartWrapper
          data={chartData}
          xKey="date"
          series={[
            { key: 'l5', color: 'var(--chart-1)', label: 'L5' },
            { key: 'l10', color: 'var(--chart-2)', label: 'L10' },
          ]}
          height={220}
        />
      )}
    </div>
  )
}
