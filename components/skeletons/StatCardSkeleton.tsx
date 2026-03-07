import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export function StatCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-lg border border-white/[0.06] bg-surface px-4 py-3', className)}>
      <Skeleton className="h-[0.6875rem] w-20" />       {/* label: 11px */}
      <Skeleton className="mt-1.5 h-[1.75rem] w-16" />  {/* value: 28px */}
      <Skeleton className="mt-1 h-3 w-24" />             {/* context: 12px */}
    </div>
  )
}
