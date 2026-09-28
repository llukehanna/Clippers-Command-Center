'use client'

import * as React from 'react'
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Panel } from '@/components/ui/panel'
import { Segmented } from '@/components/ui/segmented'
import { Eyebrow } from '@/components/ui/eyebrow'
import { ChartTooltip, axisTick, gridProps } from '@/components/charts/chart-theme'
import { mergeChartSeries } from '@/src/lib/player-utils'
import { formatDayShort } from '@/src/lib/ui/time'
import type { ChartPoint, PlayerDetailPayload } from '@/src/lib/ui/types'

type Metric = 'pts' | 'reb' | 'ast' | 'ts'
const LABEL: Record<Metric, string> = { pts: 'Points', reb: 'Rebounds', ast: 'Assists', ts: 'True shooting' }
const SHORT: Record<Metric, string> = { pts: 'PTS', reb: 'REB', ast: 'AST', ts: 'TS%' }

/** Rolling L5 (area) and L10 (dashed line) averages across the season. */
export function TrendChart({ charts }: { charts: PlayerDetailPayload['charts'] }) {
  const [metric, setMetric] = React.useState<Metric>('pts')
  const l5 = charts[`rolling_${metric}_l5`] as ChartPoint[]
  const l10 = charts[`rolling_${metric}_l10`] as ChartPoint[]
  const pct = metric === 'ts'
  const data = mergeChartSeries(l5 ?? [], l10 ?? []).map((d) => ({
    date: d.date,
    l5: d.l5 == null ? null : pct ? d.l5 * 100 : d.l5,
    l10: d.l10 == null ? null : pct ? d.l10 * 100 : d.l10,
  }))
  const last = [...data].reverse().find((d) => d.l5 != null)
  const unit = pct ? '%' : ''

  return (
    <Panel className="p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[180px] flex-1">
          <Eyebrow as="h2" className="mb-2">
            Rolling average · {LABEL[metric]}
          </Eyebrow>
          {last?.l5 != null && (
            <p className="m-0 text-[14px] text-mute">
              Last 5:{' '}
              <span className="font-semibold text-text tabular-nums">
                {last.l5.toFixed(1)}
                {unit}
              </span>
              {last.l10 != null && (
                <>
                  {' '}
                  · Last 10:{' '}
                  <span className="text-text tabular-nums">
                    {last.l10.toFixed(1)}
                    {unit}
                  </span>
                </>
              )}
            </p>
          )}
        </div>
        <Segmented
          ariaLabel="Metric"
          size="sm"
          value={metric}
          onChange={setMetric}
          options={(Object.keys(LABEL) as Metric[]).map((m) => ({ value: m, label: SHORT[m] }))}
        />
      </div>
      {data.length === 0 ? (
        <p className="m-0 py-16 text-center text-[14px] text-mute">Not enough games yet for a rolling average.</p>
      ) : (
        <div className="mt-5 h-[240px] sm:h-[280px]" role="img" aria-label={`${LABEL[metric]} rolling averages`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#418fde" stopOpacity={0.32} />
                  <stop offset="100%" stopColor="#418fde" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...gridProps} />
              <XAxis
                dataKey="date"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                minTickGap={40}
                tickFormatter={(d: string) => formatDayShort(d)}
              />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={48} domain={['auto', 'auto']} tickFormatter={(v: number) => v.toFixed(0)} />
              <Tooltip
                cursor={{ stroke: 'rgba(150,178,230,0.25)' }}
                content={<ChartTooltip format={(v) => `${Number(v).toFixed(1)}${unit}`} labelFormat={(l) => formatDayShort(String(l))} />}
              />
              <Area
                type="monotone"
                dataKey="l5"
                name="Last 5"
                stroke="#418fde"
                strokeWidth={2}
                fill="url(#trend-fill)"
                connectNulls
                dot={false}
                activeDot={{ r: 4, fill: '#418fde', stroke: '#0b1220', strokeWidth: 2 }}
              />
              <Line
                type="monotone"
                dataKey="l10"
                name="Last 10"
                stroke="#e8edf6"
                strokeOpacity={0.55}
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                connectNulls
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="mt-3 flex gap-5 font-mono text-[11px] text-dim">
        <span className="flex items-center gap-2">
          <span className="h-[2px] w-4 rounded bg-pacific" /> Last 5
        </span>
        <span className="flex items-center gap-2">
          <span className="h-0 w-4 border-t border-dashed border-text/60" /> Last 10
        </span>
      </div>
    </Panel>
  )
}
