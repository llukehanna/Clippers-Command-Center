import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: string | number
  delta?: string | number
  context?: string
  positive?: boolean
  className?: string
}

export function StatCard({ label, value, delta, context, positive, className }: StatCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-white/[0.06] bg-surface px-4 py-3',
        className
      )}
    >
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground leading-none">
        {label}
      </p>
      <p className="mt-1.5 text-[1.75rem] font-bold tabular-nums leading-none tracking-[-0.03em] text-foreground">
        {value}
      </p>
      {(delta != null || context != null) && (
        <p className={cn(
          'mt-1 text-[0.75rem] leading-none',
          delta != null && positive !== undefined
            ? positive ? 'text-positive' : 'text-negative'
            : 'text-muted-foreground'
        )}>
          {delta}{delta != null && context ? ' ' : ''}{context}
        </p>
      )}
    </div>
  )
}
