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
      className={cn(
        'panel-inset grid overflow-hidden tabular-nums [&>*+*]:border-l [&>*+*]:border-line max-sm:[&>*:nth-child(3)]:border-l-0 max-sm:[&>*:nth-child(n+3)]:border-t',
        items.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : items.length === 3 ? 'grid-cols-3' : 'grid-cols-2',
        className,
      )}
    >
      {items.map((it) => (
        <div key={it.label} className={cn('min-w-0', compact ? 'px-3 py-2' : 'px-3.5 py-2.5')}>
          <div className="label-mono truncate">{it.label}</div>
          <div className={cn('mt-0.5 truncate font-semibold tracking-[-0.01em]', compact ? 'text-[13.5px]' : 'text-[16px]')}>{it.value}</div>
        </div>
      ))}
    </div>
  )
}
