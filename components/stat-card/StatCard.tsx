import { Surface } from '@/components/ui/surface'
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
    <Surface variant="card" hover className={cn('px-4 py-3', className)}>
      <p className="ccc-card-label text-muted-foreground/90">
        {label}
      </p>
      <p className="mt-1.5 text-[1.75rem] font-bold tabular-nums leading-none tracking-[-0.03em] text-foreground">
        {value}
      </p>
      {(delta != null || context != null) && (
        <p className={cn(
          'ccc-body mt-1 leading-none text-[0.75rem]',
          delta != null && positive !== undefined
            ? positive ? 'text-positive' : 'text-negative'
            : 'text-muted-foreground'
        )}>
          {delta}{delta != null && context ? ' ' : ''}{context}
        </p>
      )}
    </Surface>
  )
}
