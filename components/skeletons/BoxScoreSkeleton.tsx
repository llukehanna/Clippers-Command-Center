import { Skeleton } from '@/components/ui/skeleton'

export function BoxScoreSkeleton() {
  return (
    <div className="rounded-md border border-border overflow-hidden">
      {/* Header row */}
      <div className="flex gap-4 px-4 py-2 bg-surface border-b border-border">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-3 w-8 ml-auto" />
        <Skeleton className="h-3 w-8" />
        <Skeleton className="h-3 w-8" />
        <Skeleton className="h-3 w-8" />
      </div>
      {/* Player rows */}
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex gap-4 px-4 py-2.5 border-b border-border last:border-0"
        >
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-6 ml-auto" />
          <Skeleton className="h-3 w-6" />
          <Skeleton className="h-3 w-6" />
          <Skeleton className="h-3 w-6" />
        </div>
      ))}
    </div>
  )
}
