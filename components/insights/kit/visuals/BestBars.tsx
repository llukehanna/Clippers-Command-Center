import * as React from 'react'
import { cn } from '@/lib/utils'
import { bestBars, fmtNum } from '@/src/lib/insights/kit-geometry'
import type { CardVisual } from '@/src/lib/insights/visual'

type Best = Extract<CardVisual, { kind: 'best' }>

/**
 * Previous best → this game (insights.css:110-116; insights.js:90-98). One grid
 * for both rows so the bars line up; the label column is at least the mockup's
 * 74px and grows to fit "Previous best".
 */
export function BestBars({ visual }: { visual: Best }) {
  const g = bestBars(visual.prev, visual.value)
  if (!g) return null
  const rows = [
    { label: 'Previous best', value: visual.prev, pct: g.prevPct, now: false },
    { label: 'This game', value: visual.value, pct: g.valuePct, now: true },
  ]
  return (
    <div
      role="img"
      aria-label={visual.aria}
      className="grid grid-cols-[auto_minmax(0,1fr)_34px] items-center gap-x-2.5 gap-y-1.5 font-mono text-[10.5px]"
    >
      {rows.map((r) => (
        <React.Fragment key={r.label}>
          <span className="min-w-[74px] whitespace-nowrap text-dim">{r.label}</span>
          <i
            className={cn(
              'block h-2 rounded-[4px]',
              r.now
                ? 'bg-[linear-gradient(90deg,rgba(76,195,138,0.6),var(--pos))] shadow-[0_0_12px_-2px_rgba(76,195,138,0.7)]'
                : 'bg-[rgba(150,178,230,0.26)]',
            )}
            style={{ width: `${r.pct}%` }}
          />
          <span className={cn('text-right', r.now ? 'font-semibold text-text' : 'text-mute')}>{fmtNum(r.value)}</span>
        </React.Fragment>
      ))}
    </div>
  )
}
