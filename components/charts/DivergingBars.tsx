import Link from 'next/link'
import { cn } from '@/lib/utils'

export interface DivergingDatum {
  key: string
  label: string
  value: number
  title: string
  href?: string
}

/**
 * Win/loss margins as bars growing up (positive) or down (negative) from a
 * zero line. Plain HTML so it is crisp at any width and needs no JS.
 */
export function DivergingBars({ data, height = 150, className }: { data: DivergingDatum[]; height?: number; className?: string }) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)))
  return (
    <div className={cn('relative', className)} style={{ height }}>
      <div aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-line-2" />
      <ol className="relative m-0 grid h-full list-none gap-1.5 p-0" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
        {data.map((d) => {
          const pct = (Math.abs(d.value) / max) * 100
          const up = d.value >= 0
          const bar = (
            <>
              <span className="flex items-end justify-center">
                {up && (
                  <i
                    className="block w-full max-w-[34px] rounded-t-[6px] rounded-b-[2px] bg-gradient-to-b from-pos/90 to-pos/25 transition-[filter] duration-300 group-hover:brightness-125"
                    style={{ height: `${Math.max(4, pct)}%` }}
                  />
                )}
              </span>
              <span className="flex items-start justify-center">
                {!up && (
                  <i
                    className="block w-full max-w-[34px] rounded-b-[6px] rounded-t-[2px] bg-gradient-to-b from-neg/25 to-neg/90 transition-[filter] duration-300 group-hover:brightness-125"
                    style={{ height: `${Math.max(4, pct)}%` }}
                  />
                )}
              </span>
              <span
                className={cn(
                  'absolute left-1/2 -translate-x-1/2 font-mono text-[10px] text-dim transition-colors group-hover:text-text sm:text-[10.5px]',
                  up ? 'top-[calc(50%+6px)]' : 'bottom-[calc(50%+6px)]',
                )}
              >
                {d.label}
              </span>
            </>
          )
          const cls = 'group relative grid h-full grid-rows-2 outline-none'
          return (
            <li key={d.key} className="h-full">
              {d.href ? (
                <Link href={d.href} prefetch={false} title={d.title} aria-label={d.title} className={cls}>
                  {bar}
                </Link>
              ) : (
                <div title={d.title} aria-label={d.title} className={cls}>
                  {bar}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
