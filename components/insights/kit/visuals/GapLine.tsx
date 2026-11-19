import { cn } from '@/lib/utils'
import type { CardVisual } from '@/src/lib/insights/visual'
import { EvCap } from './EvCap'

type Gap = Extract<CardVisual, { kind: 'gap' }>

/** Last time → this time (insights.css:96-107, :296; insights.js:68-89). */
export function GapLine({ visual, size }: { visual: Gap; size: 'hero' | 'standard' }) {
  const hero = size === 'hero'
  return (
    <div role="img" aria-label={visual.aria}>
      <div className={cn('relative', hero ? 'h-[44px]' : 'h-[34px]')}>
        <span
          className={cn(
            'absolute left-[6px] right-[6px] h-[2px] bg-[repeating-linear-gradient(90deg,rgba(150,178,230,0.32)_0_4px,transparent_4px_8px)]',
            hero ? 'top-[22px]' : 'top-4',
          )}
        />
        <span
          className={cn(
            'absolute left-[6px] -ml-1.5 size-3 rounded-full bg-ink-2 shadow-[inset_0_0_0_2px_rgba(150,178,230,0.55)]',
            hero ? 'top-[17px]' : 'top-[11px]',
          )}
        />
        <span
          className={cn(
            'absolute right-[6px] size-3 translate-x-1/2 rounded-full bg-pacific shadow-[0_0_0_4px_rgba(65,143,222,0.18),0_0_16px_rgba(65,143,222,0.8)]',
            hero ? 'top-[17px]' : 'top-[11px]',
          )}
        />
        {!hero && (
          <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink-1 px-2 py-px font-mono text-[10.5px] text-[#9cc7f2] shadow-[inset_0_0_0_1px_rgba(65,143,222,0.3)]">
            {visual.span}
          </span>
        )}
        {visual.ticks.map((t) => (
          <i
            key={t}
            className={cn('absolute h-[10px] w-px bg-[rgba(150,178,230,0.22)]', hero ? 'top-[18px]' : 'top-3')}
            style={{ left: `calc(6px + (100% - 12px) * ${t})` }}
          />
        ))}
      </div>
      <EvCap
        left={
          <>
            Last time · <b>{visual.then}</b>
          </>
        }
        right={visual.now}
      />
    </div>
  )
}
