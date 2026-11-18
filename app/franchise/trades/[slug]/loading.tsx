import { Skeleton } from '@/components/ui/skeleton'

/** Trade page loading: the Franchise title and tabs stay; the hero, sides and outline are stood in for. */
export default function Loading() {
  return (
    <div className="grid gap-5 sm:gap-6 [&>*]:min-w-0" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-3.5 w-28 rounded-full" />
      <Skeleton className="h-[248px] rounded-[22px] sm:h-[268px]" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] lg:gap-[18px]">
        <Skeleton className="h-[132px] rounded-[22px]" />
        <Skeleton className="h-[240px] rounded-[22px]" />
      </div>
      <div className="panel grid gap-1 p-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[42px] rounded-[12px]" style={{ opacity: 1 - i * 0.1 }} />
        ))}
      </div>
    </div>
  )
}
