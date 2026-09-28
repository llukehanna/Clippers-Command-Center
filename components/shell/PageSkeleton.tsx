import { Skeleton } from '@/components/ui/skeleton'

/**
 * Route loading states (app/**\/loading.tsx). Shaped like each page so the
 * switch is instant and content streams in without layout jumps.
 */

function Header({ actions = false }: { actions?: boolean }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="grid gap-2.5">
        <Skeleton className="h-9 w-44 rounded-[12px]" />
        <Skeleton className="h-4 w-64 rounded-full" />
      </div>
      {actions && <Skeleton className="h-9 w-48 rounded-full" />}
    </div>
  )
}

function Rows({ count = 6, height = 56 }: { count?: number; height?: number }) {
  return (
    <div className="panel grid gap-1 p-2">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="rounded-[14px]" style={{ height, opacity: 1 - i * 0.08 }} />
      ))}
    </div>
  )
}

export function HomeSkeleton() {
  return (
    <div className="page" aria-busy="true" aria-label="Loading">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:gap-[18px]">
        <Skeleton className="h-[330px] rounded-[22px]" />
        <Skeleton className="h-[330px] rounded-[22px]" />
      </div>
      <Skeleton className="h-[250px] rounded-[22px]" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-[18px]">
        <Rows count={6} />
        <Skeleton className="h-[260px] rounded-[22px]" />
      </div>
    </div>
  )
}

export function ListPageSkeleton({ actions = true, tiles = false, rows = 8 }: { actions?: boolean; tiles?: boolean; rows?: number }) {
  return (
    <div className="page" aria-busy="true" aria-label="Loading">
      <Header actions={actions} />
      {tiles && (
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[112px] rounded-[22px]" />
          ))}
        </div>
      )}
      <Rows count={rows} />
    </div>
  )
}

export function CardGridSkeleton() {
  return (
    <div className="page" aria-busy="true" aria-label="Loading">
      <Header actions />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 lg:gap-3 xl:grid-cols-5">
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} className="aspect-[4/5] rounded-[22px]" />
        ))}
      </div>
    </div>
  )
}

export function DetailSkeleton() {
  return (
    <div className="page" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-4 w-24 rounded-full" />
      <Skeleton className="h-[280px] rounded-[22px]" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-[18px]">
        <Skeleton className="h-[360px] rounded-[22px]" />
        <Skeleton className="h-[260px] rounded-[22px]" />
      </div>
    </div>
  )
}
