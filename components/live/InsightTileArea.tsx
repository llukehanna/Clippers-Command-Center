'use client'

import { Surface } from '@/components/ui/surface'
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
        <Surface variant="card" hover className="h-full flex flex-col justify-between px-5 py-4">
          <div>
            <span className="ccc-section-title block text-primary">
              {current.category}
            </span>
            <p className="mt-1 text-[0.9375rem] font-semibold leading-snug text-foreground">
              {current.headline}
            </p>
            <p className="ccc-body mt-1 text-muted-foreground">
              {current.detail}
            </p>
          </div>

          {/* Dot indicators — only shown when multiple insights */}
          {insights.length > 1 && (
            <div className="mt-2 flex justify-end gap-1">
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
        </Surface>
      </div>
    </div>
  )
}
