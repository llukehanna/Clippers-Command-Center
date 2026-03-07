import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export function ChartSkeleton({ height = 200, className }: { height?: number; className?: string }) {
  return (
    <Skeleton
      className={cn('w-full rounded-md', className)}
      style={{ height: `${height}px` }}
    />
  )
}
