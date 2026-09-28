'use client'

import * as React from 'react'

/** Shared Recharts styling so every chart reads as one system. */
export const axisTick = {
  fill: 'var(--dim)',
  fontSize: 10.5,
  fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
} as const

export const gridProps = {
  stroke: 'rgba(150,178,230,0.08)',
  strokeDasharray: '0',
  vertical: false,
} as const

interface TooltipRow {
  name?: string | number
  value?: number | string | null
  color?: string
  dataKey?: string | number
}

export function ChartTooltip({
  active,
  payload,
  label,
  format = (v) => String(v),
  labelFormat = (l) => String(l),
}: {
  active?: boolean
  payload?: TooltipRow[]
  label?: string | number
  format?: (v: number | string) => string
  labelFormat?: (l: string | number) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-[12px] border border-line-2 bg-ink-2/95 px-3 py-2 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.7)] backdrop-blur">
      {label != null && <div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-dim">{labelFormat(label)}</div>}
      {payload
        .filter((p) => p.value != null)
        .map((p) => (
          <div key={String(p.dataKey)} className="flex items-center gap-2 text-[12.5px] tabular-nums">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            <span className="text-mute">{p.name}</span>
            <span className="ml-auto font-semibold text-text">{format(p.value as number)}</span>
          </div>
        ))}
    </div>
  )
}
