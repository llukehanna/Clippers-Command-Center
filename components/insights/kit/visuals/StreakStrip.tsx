import { cn } from '@/lib/utils'
import { fmtNum, streakBars } from '@/src/lib/insights/kit-geometry'
import type { Evidence } from '@/src/lib/insights/types'

type StreakEvidence = Extract<Evidence, { type: 'streak_strip' }>

/** One bar per game, lit when it cleared the threshold (insights.css:161-165; insights.js:125-140). */
export function StreakStrip({ evidence, aria }: { evidence: StreakEvidence; aria: string }) {
  const bars = streakBars(evidence.games, evidence.threshold)
  if (!bars) return null
  return (
    <div role="img" aria-label={aria} className="flex h-[46px] items-end gap-1">
      {bars.map((b, i) => (
        <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
          <i
            className={cn(
              'block w-full max-w-[30px] rounded-[4px_4px_2px_2px]',
              b.hit
                ? 'bg-[linear-gradient(180deg,var(--pacific),rgba(65,143,222,0.55))]'
                : 'bg-[rgba(150,178,230,0.22)]',
            )}
            style={{ height: `${b.pct}%` }}
          />
          <span className="font-mono text-[9.5px] text-dim">{fmtNum(b.value)}</span>
        </div>
      ))}
    </div>
  )
}
