import { Skeleton } from '@/components/ui/skeleton'

interface ChartSkeletonProps {
  height?: number
  title?: boolean
}

export function ChartSkeleton({ height = 240, title = false }: ChartSkeletonProps) {
  return (
    <div className="space-y-2">
      {title && <Skeleton className="h-4 w-32" />}
      <Skeleton className="w-full rounded-md" style={{ height }} />
    </div>
  )
}
