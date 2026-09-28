'use client'

import { useNow } from '@/hooks/useNow'
import { countdownParts } from '@/src/lib/ui/live'

/** Days / hours / minutes to tip-off. Renders nothing once the game has started. */
export function Countdown({ tipoff }: { tipoff: string | null }) {
  const now = useNow(30_000)
  if (!tipoff) return null
  const parts = now ? countdownParts(tipoff, now) : null
  if (now && !parts) return null
  const cells: Array<[string, number | null]> = [
    ['Days', parts?.days ?? null],
    ['Hrs', parts?.hours ?? null],
    ['Min', parts?.minutes ?? null],
  ]
  return (
    <div className="flex gap-1.5 tabular-nums" role="timer" aria-label="Time until tip-off">
      {cells.map(([label, value]) => (
        <div key={label} className="min-w-[56px] rounded-[12px] border border-line bg-white/[0.03] px-2.5 pb-1.5 pt-2 text-center">
          <div className="text-[22px] font-semibold leading-none tracking-[-0.02em]">
            {value == null ? <span className="text-dim">··</span> : String(value).padStart(2, '0')}
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-dim">{label}</div>
        </div>
      ))}
    </div>
  )
}
