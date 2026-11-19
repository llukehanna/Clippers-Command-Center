import { cn } from '@/lib/utils'
import { ordinal } from '@/src/lib/record-notes'
import { rankTicks, type RankTickKind } from '@/src/lib/insights/kit-geometry'
import type { Evidence } from '@/src/lib/insights/types'

type RankEvidence = Extract<Evidence, { type: 'rank_track' }>

// insights.css:150-158
const TICK: Record<RankTickKind, string> = {
  base: 'h-2 bg-[rgba(150,178,230,0.16)]',
  top5: 'h-2 bg-[rgba(76,195,138,0.22)]',
  bot5: 'h-2 bg-[rgba(240,103,122,0.2)]',
  tie: 'h-3 bg-[rgba(65,143,222,0.5)]',
  me: 'h-4 bg-pacific shadow-[0_0_12px_rgba(65,143,222,0.9)]',
  meBad: 'h-4 bg-neg shadow-[0_0_12px_rgba(240,103,122,0.8)]',
}

/** 1 … N with this rank lit (insights.js:99-124), tied ranks drawn beside it. */
export function RankTrack({ evidence, aria }: { evidence: RankEvidence; aria: string }) {
  const ticks = rankTicks(evidence.rank, evidence.total, evidence.tied ?? 0)
  if (!ticks) return null
  return (
    <div role="img" aria-label={aria} className="relative">
      <div
        className="grid h-4 items-end gap-0.5"
        style={{ gridTemplateColumns: `repeat(${ticks.length}, minmax(0, 1fr))` }}
      >
        {ticks.map((k, i) => (
          <i key={i} className={cn('block rounded-[2px]', TICK[k])} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-dim">
        <span>1st</span>
        <span>{ordinal(evidence.total)}</span>
      </div>
    </div>
  )
}
