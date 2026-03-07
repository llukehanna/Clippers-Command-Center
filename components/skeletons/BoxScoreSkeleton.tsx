import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export function BoxScoreSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('overflow-y-auto rounded-md', className)}>
      {/* header row */}
      <div className="flex gap-4 border-b border-white/[0.04] px-3 py-2">
        <Skeleton className="h-[0.6875rem] w-24" />
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-[0.6875rem] w-8 ml-auto" />
        ))}
      </div>
      {/* data rows */}
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-white/[0.04] px-3 h-9">
          <Skeleton className="h-3 w-28" />
          {[...Array(6)].map((_, j) => (
            <Skeleton key={j} className="h-3 w-8 ml-auto" />
          ))}
        </div>
      ))}
    </div>
  )
}
