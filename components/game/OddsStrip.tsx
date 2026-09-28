import { cn } from '@/lib/utils'

interface OddsStripProps {
  items: Array<{ label: string; value: string }>
  className?: string
  compact?: boolean
}

/** Row of label/value cells separated by hairlines (spread · moneyline · total). */
export function OddsStrip({ items, className, compact }: OddsStripProps) {
  return (
    <div
      className={cn('grid gap-px overflow-hidden rounded-[14px] bg-line tabular-nums', className)}
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((it) => (
        <div key={it.label} className={cn('min-w-0 bg-ink-1', compact ? 'px-3 py-2' : 'px-3.5 py-2.5')}>
          <div className="label-mono truncate">{it.label}</div>
          <div className={cn('mt-0.5 truncate font-semibold tracking-[-0.01em]', compact ? 'text-[13.5px]' : 'text-[16px]')}>{it.value}</div>
        </div>
      ))}
    </div>
  )
}
