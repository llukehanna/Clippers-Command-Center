import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface StatCardSkeletonProps {
  className?: string
}

export function StatCardSkeleton({ className }: StatCardSkeletonProps) {
  return (
    <Card className={cn('p-4', className)}>
      <CardContent className="p-0 space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-3 w-24" />
      </CardContent>
    </Card>
  )
}
