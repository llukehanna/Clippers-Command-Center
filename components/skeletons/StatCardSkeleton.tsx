import { Surface } from '@/components/ui/surface'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export function StatCardSkeleton({ className }: { className?: string }) {
  return (
    <Surface variant="card" className={cn('px-4 py-3', className)}>
      <Skeleton className="h-[0.6875rem] w-20" />       {/* label: 11px */}
      <Skeleton className="mt-1.5 h-[1.75rem] w-16" />  {/* value: 28px */}
      <Skeleton className="mt-1 h-3 w-24" />             {/* context: 12px */}
    </Surface>
  )
}
