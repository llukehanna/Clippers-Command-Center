import { Surface } from '@/components/ui/surface'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export function BoxScoreSkeleton({ className }: { className?: string }) {
  return (
    <Surface variant="card" className={cn('overflow-hidden p-0', className)}>
      <div className="overflow-y-auto rounded-md">
        {/* header row */}
        <div className="flex gap-4 border-b border-border-subtle px-3 py-2">
          <Skeleton className="h-[0.6875rem] w-24" />
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-[0.6875rem] w-8 ml-auto" />
          ))}
        </div>
        {/* data rows */}
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border-subtle px-3 h-9">
            <Skeleton className="h-3 w-28" />
            {[...Array(6)].map((_, j) => (
              <Skeleton key={j} className="h-3 w-8 ml-auto" />
            ))}
          </div>
        ))}
      </div>
    </Surface>
  )
}
