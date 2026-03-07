import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: string | number
  delta?: string        // e.g. "+2.3" or "-1.5"
  context?: string      // e.g. "last 5 games"
  positive?: boolean    // true → green delta, false → red delta
  className?: string
}

export function StatCard({
  label,
  value,
  delta,
  context,
  positive,
  className,
}: StatCardProps) {
  return (
    <Card className={cn('p-4', className)}>
      <CardContent className="p-0 space-y-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </p>
        <p className="text-2xl font-semibold tabular-nums leading-none text-foreground">
          {value}
        </p>
        {(delta != null || context != null) && (
          <p
            className={cn(
              'text-xs',
              delta != null && positive !== undefined
                ? positive
                  ? 'text-[var(--positive)]'
                  : 'text-[var(--negative)]'
                : 'text-muted-foreground'
            )}
          >
            {delta}{delta && context ? ' ' : ''}{context}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
