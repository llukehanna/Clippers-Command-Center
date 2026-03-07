'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { cn } from '@/lib/utils'

export interface ChartSeries {
  key: string
  color?: string
  label: string
}

interface LineChartWrapperProps {
  data: Record<string, unknown>[]
  series: ChartSeries[]
  xKey?: string
  title?: string
  height?: number
  className?: string
}

function formatStat(v: unknown): string {
  if (v == null) return '—'
  const n = Number(v)
  if (isNaN(n)) return String(v)
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  if (Math.abs(n) < 10) return n.toFixed(1)
  return String(Math.round(n))
}

interface TooltipPayloadItem {
  dataKey: string
  name: string
  value: unknown
  color: string
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded border border-white/[0.06] bg-[var(--surface-alt)] px-3 py-2 text-[0.8125rem] shadow-lg">
      {label && <p className="mb-1 text-muted-foreground">{label}</p>}
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {formatStat(p.value)}
        </p>
      ))}
    </div>
  )
}

const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)']

export function LineChartWrapper({
  data,
  series,
  xKey = 'date',
  title,
  height = 240,
  className,
}: LineChartWrapperProps) {
  return (
    <div className={cn('space-y-1', className)}>
      {title && (
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart
          data={data}
          margin={{ top: 4, right: 8, bottom: 4, left: 0 }}
        >
          <CartesianGrid
            strokeDasharray=""
            stroke="var(--border)"
            strokeOpacity={0.08}
            vertical={false}
          />
          <XAxis
            dataKey={xKey}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            tickFormatter={formatStat}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: '11px', color: 'var(--muted-foreground)' }}
          />
          {series.map((s, index) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={s.color ?? CHART_COLORS[index % CHART_COLORS.length]}
              name={s.label}
              dot={false}
              strokeWidth={2}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
