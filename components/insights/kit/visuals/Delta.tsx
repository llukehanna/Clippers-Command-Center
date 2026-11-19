import { cn } from '@/lib/utils'
import { deltaView } from '@/src/lib/insights/kit-geometry'
import type { Evidence } from '@/src/lib/insights/types'

type DeltaEvidence = Extract<Evidence, { type: 'delta' }>

/** Before → after (insights.css:126-134). The change is green when it is better, red when worse. */
export function Delta({ evidence, aria }: { evidence: DeltaEvidence; aria: string }) {
  const d = deltaView(evidence.before.value, evidence.after.value, evidence.betterIsHigher)
  if (!d) return null
  return (
    <div
      role="img"
      aria-label={aria}
      className="grid grid-cols-[auto_auto_auto_minmax(0,1fr)] items-end gap-x-3.5 gap-y-2.5"
    >
      <Side label={evidence.before.label} value={d.before} />
      <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden className="mb-1 text-dim">
        <path
          d="M2.5 6h7M6.5 3l3 3-3 3"
          stroke="currentColor"
          strokeWidth="1.4"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <Side label={evidence.after.label} value={d.after} after />
      {d.change ? (
        <span className={cn('justify-self-end pb-0.5 font-mono text-[11.5px]', d.better ? 'text-pos' : 'text-neg')}>
          {d.change}
        </span>
      ) : (
        <span />
      )}
    </div>
  )
}

function Side({ label, value, after }: { label: string; value: string; after?: boolean }) {
  return (
    <div className="flex flex-col gap-[3px]">
      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-dim">{label}</span>
      <span className={cn('text-[22px] font-semibold leading-none tracking-[-0.03em]', after ? 'text-text' : 'text-mute')}>
        {value}
      </span>
    </div>
  )
}
