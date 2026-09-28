'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { insightCategoryLabel } from '@/src/lib/format'
import type { Insight } from '@/src/lib/ui/types'
import { InsightCard } from './InsightCard'

interface InsightStackProps {
  insights: Insight[]
  intervalMs?: number
  /** How many other insights to list under the featured one. */
  listCount?: number
  className?: string
}

/**
 * Featured insight that rotates on a timer (paused on hover/focus), with the
 * next few listed underneath — click one to feature it.
 */
export function InsightStack({ insights, intervalMs = 9000, listCount = 3, className }: InsightStackProps) {
  const [index, setIndex] = React.useState(0)
  const [paused, setPaused] = React.useState(false)
  const count = insights.length

  React.useEffect(() => {
    if (count <= 1 || paused) return
    const id = setInterval(() => setIndex((i) => (i + 1) % count), intervalMs)
    return () => clearInterval(id)
  }, [count, paused, intervalMs])

  if (count === 0) return null
  const featured = insights[Math.min(index, count - 1)]
  const others = Array.from({ length: Math.min(listCount, count - 1) }, (_, k) => (index + 1 + k) % count)

  return (
    <div
      className={cn('flex flex-col gap-2.5', className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div aria-live="polite">
        <InsightCard key={featured.insight_id} insight={featured} size="lg" className="enter">
          {count > 1 && (
            <span className="ml-auto font-mono text-[11px] text-dim tabular-nums">
              {index + 1}/{count}
            </span>
          )}
        </InsightCard>
      </div>
      {others.length > 0 && (
        <ul className="panel m-0 list-none p-1.5">
          {others.map((i) => {
            const ins = insights[i]
            return (
              <li key={ins.insight_id}>
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  className="row-hover flex w-full flex-col gap-0.5 rounded-[14px] px-3.5 py-2.5 text-left"
                >
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-dim">{insightCategoryLabel(ins.category)}</span>
                  <span className="text-[13.5px] leading-snug text-text">{ins.headline}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
