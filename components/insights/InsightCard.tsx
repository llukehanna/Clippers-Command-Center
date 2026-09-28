import * as React from 'react'
import { cn } from '@/lib/utils'
import { insightCategoryLabel } from '@/src/lib/format'
import type { Insight } from '@/src/lib/ui/types'

/** One-line summary of what an insight was verified against, from its stored proof rows. */
export function proofLabel(insight: Pick<Insight, 'proof'>): string | null {
  const rows = insight.proof?.result
  const first = Array.isArray(rows) ? rows[0] : rows
  if (!first || typeof first !== 'object') return null
  const r = first as Record<string, unknown>
  const parts: string[] = []
  if (typeof r.games === 'number') parts.push(`${r.games} games`)
  if (typeof r.total_players === 'number') parts.push(`${r.total_players} players ranked`)
  if (typeof r.period === 'number') parts.push(`Q${r.period}${typeof r.clock === 'string' ? ` ${r.clock}` : ''}`)
  if (parts.length === 0 && Array.isArray(rows)) parts.push(`${rows.length} source row${rows.length === 1 ? '' : 's'}`)
  return parts.join(' · ') || null
}

interface InsightCardProps {
  insight: Insight
  size?: 'md' | 'lg'
  fresh?: boolean
  className?: string
  children?: React.ReactNode
}

/** Insight with its category and a "Verified" proof footer. */
export function InsightCard({ insight, size = 'md', fresh, className, children }: InsightCardProps) {
  const proof = proofLabel(insight)
  return (
    <article
      className={cn(
        'panel flex flex-col gap-2.5',
        size === 'lg' ? 'p-6' : 'p-4 sm:p-5',
        fresh && 'border-pacific/35 shadow-[0_0_0_1px_rgba(65,143,222,0.15)_inset,var(--panel-shadow)]',
        className,
      )}
    >
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[#9cc7f2]">
        <span aria-hidden className="h-1.5 w-1.5 rounded-[2px] bg-pacific" />
        {insightCategoryLabel(insight.category)}
      </div>
      <h3
        className={cn(
          'm-0 font-semibold leading-snug tracking-[-0.02em] text-text',
          size === 'lg' ? 'text-[19px] sm:text-[21px]' : 'text-[15px] font-medium',
        )}
      >
        {insight.headline}
      </h3>
      {insight.detail && <p className={cn('m-0 text-mute', size === 'lg' ? 'text-[14px]' : 'text-[13px]')}>{insight.detail}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-dashed border-line-2 pt-3 font-mono text-[11px] text-dim">
        <span className="text-pos">✓ Verified</span>
        {proof && <span>{proof}</span>}
        {children}
      </div>
    </article>
  )
}
