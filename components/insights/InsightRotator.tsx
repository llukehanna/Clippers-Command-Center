'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import type { Insight } from '@/src/lib/ui/types'
import { InsightCard } from './InsightCard'

interface InsightRotatorProps {
  insights: Insight[]
  intervalMs?: number
  className?: string
}

/** Rotates through insights; pauses while hovered or focused. Dots jump directly. */
export function InsightRotator({ insights, intervalMs = 9000, className }: InsightRotatorProps) {
  const [index, setIndex] = React.useState(0)
  const [paused, setPaused] = React.useState(false)
  const count = insights.length

  React.useEffect(() => {
    if (count <= 1 || paused) return
    const id = setInterval(() => setIndex((i) => (i + 1) % count), intervalMs)
    return () => clearInterval(id)
  }, [count, paused, intervalMs])

  if (count === 0) return null
  const current = insights[Math.min(index, count - 1)]

  return (
    <div
      className={cn('grid', className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      aria-live="polite"
    >
      <InsightCard key={current.insight_id} insight={current} size="lg" className="enter h-full min-h-[220px]">
        {count > 1 && (
          <span className="ml-auto flex gap-1.5" role="tablist" aria-label="Insights">
            {insights.map((ins, i) => (
              <button
                key={ins.insight_id}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Insight ${i + 1} of ${count}`}
                onClick={() => setIndex(i)}
                className={cn(
                  'h-[3px] w-3.5 rounded-full transition-colors duration-300',
                  i === index ? 'bg-text' : 'bg-line-2 hover:bg-mute',
                )}
              />
            ))}
          </span>
        )}
      </InsightCard>
    </div>
  )
}
