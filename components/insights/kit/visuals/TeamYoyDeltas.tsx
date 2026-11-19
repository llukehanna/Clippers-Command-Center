import { cn } from '@/lib/utils'
import { miniDeltas } from '@/src/lib/insights/kit-geometry'
import type { CardVisual } from '@/src/lib/insights/visual'

type TeamYoy = Extract<CardVisual, { kind: 'team_yoy' }>

const COLS = 'grid grid-cols-[92px_minmax(0,1fr)_82px] gap-2.5'

/** Offense / defense / net league ranks, last season → this season (insights.css:135-147). */
export function TeamYoyDeltas({ visual }: { visual: TeamYoy }) {
  const m = miniDeltas(visual.rows)
  if (!m) return null
  return (
    <div role="img" aria-label={visual.aria} className="grid gap-2">
      {m.rows.map((r) => (
        <div key={r.label} className={cn(COLS, 'items-center text-[12.5px]')}>
          <span className="text-mute">{r.label}</span>
          <span className="relative h-[18px] before:absolute before:inset-x-0 before:top-2 before:h-0.5 before:rounded-[1px] before:bg-[rgba(150,178,230,0.16)] before:content-['']">
            <i
              className={cn('absolute top-2 h-0.5', r.worse ? 'bg-[rgba(240,103,122,0.55)]' : 'bg-[rgba(76,195,138,0.55)]')}
              style={{ left: `${r.lineLeft}%`, width: `${r.lineWidth}%` }}
            />
            <i
              className="absolute top-1 -ml-[5px] size-2.5 rounded-full bg-ink-2 shadow-[inset_0_0_0_2px_rgba(150,178,230,0.5)]"
              style={{ left: `${r.from}%` }}
            />
            <i
              className={cn(
                'absolute top-1 -ml-[5px] size-2.5 rounded-full',
                r.worse ? 'bg-neg shadow-[0_0_10px_rgba(240,103,122,0.6)]' : 'bg-pos shadow-[0_0_10px_rgba(76,195,138,0.6)]',
              )}
              style={{ left: `${r.to}%` }}
            />
          </span>
          <span className="whitespace-nowrap text-right font-mono text-[11px] text-mute">
            {r.fromText} → <b className={cn('font-medium', r.worse ? 'text-neg' : 'text-pos')}>{r.toText}</b>
          </span>
        </div>
      ))}
      <div className={cn(COLS, 'font-mono text-[10px] text-dim')}>
        <span />
        <span className="flex justify-between">
          <span>1st</span>
          <span>{m.axisEnd}</span>
        </span>
        <span />
      </div>
    </div>
  )
}
