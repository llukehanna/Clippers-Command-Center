import { Skeleton } from '@/components/ui/skeleton'

type Shape = 'moves' | 'draft' | 'contracts' | 'picks' | 'front-office' | 'honors'

function Rows({ count, height }: { count: number; height: number }) {
  return (
    <div className="panel grid gap-1 p-2">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="rounded-[14px]" style={{ height, opacity: 1 - i * 0.08 }} />
      ))}
    </div>
  )
}

/**
 * Loading state for one Franchise tab. The layout (title and tabs) stays on screen;
 * only the tab's content is stood in for, shaped like it so nothing jumps.
 */
export function TabSkeleton({ shape }: { shape: Shape }) {
  return (
    <div className="grid gap-6 sm:gap-7 [&>*]:min-w-0" aria-busy="true" aria-label="Loading">
      {shape === 'moves' && (
        <>
          <Skeleton className="h-[86px] rounded-[16px]" />
          <Skeleton className="h-9 w-full max-w-[560px] rounded-full" />
          <Rows count={6} height={52} />
        </>
      )}
      {shape === 'draft' && <Rows count={6} height={88} />}
      {shape === 'contracts' && (
        <>
          <Rows count={7} height={44} />
          <Skeleton className="h-[320px] rounded-[22px]" />
        </>
      )}
      {(shape === 'picks' || shape === 'front-office' || shape === 'honors') && (
        <div className="grid gap-6 lg:grid-cols-2 lg:gap-[18px]">
          <Rows count={5} height={shape === 'front-office' ? 72 : 60} />
          <Rows count={4} height={60} />
        </div>
      )}
    </div>
  )
}
