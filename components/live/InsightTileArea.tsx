'use client'

import { cn } from '@/lib/utils'
import { useInsightRotation } from '@/hooks/useInsightRotation'

interface Insight {
  insight_id: string
  category: string
  headline: string
  detail: string
  importance: number
  proof?: unknown
}

interface InsightTileAreaProps {
  insights: Insight[] | null | undefined
  className?: string
}

export function InsightTileArea({ insights, className }: InsightTileAreaProps) {
  const { activeIndex, visible } = useInsightRotation(insights ?? [], 8000)

  if (!insights || insights.length === 0) return null

  const current = insights[activeIndex]

  return (
    <div className={cn('relative h-[144px]', className)}>
      <div
        className={cn(
          'absolute inset-0 transition-opacity duration-200',
          visible ? 'opacity-100' : 'opacity-0'
        )}
      >
        <div className="h-full rounded-xl border border-white/[0.06] bg-surface-alt px-5 py-4 flex flex-col justify-between">
          <div>
            <span className="block text-[0.6875rem] uppercase tracking-widest text-muted-foreground">
              {current.category}
            </span>
            <p className="mt-1 text-[0.9375rem] font-semibold text-foreground leading-snug">
              {current.headline}
            </p>
            <p className="mt-1 text-[0.8125rem] text-muted-foreground">
              {current.detail}
            </p>
          </div>

          {/* Dot indicators — only shown when multiple insights */}
          {insights.length > 1 && (
            <div className="flex justify-end gap-1 mt-2">
              {insights.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    i === activeIndex
                      ? 'bg-foreground'
                      : 'bg-muted-foreground/30'
                  )}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
