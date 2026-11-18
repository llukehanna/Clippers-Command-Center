import Link from 'next/link'
import { cn } from '@/lib/utils'
import { ERAS, seasonLabel } from '@/src/lib/franchise/display'

interface EraRibbonProps {
  /** Moves per season for the current type/player filter. */
  counts: Array<{ season_id: number; count: number }>
  /** Latest season start year to draw (the current season). */
  lastSeason: number
  selected: number | null
  /** Player filter on: bars mark the seasons that player moved, not volume. */
  playerMode: boolean
  /** What the bars count, for their labels: "trade", "move"… */
  noun: string
  hrefFor: (season: number) => string
}

const FIRST = 1970
const TICKS = [1970, 1980, 1990, 2000, 2010, 2020]

/**
 * The franchise's three eras on one axis, with a bar per season for the moves in the
 * current filter. Each bar jumps to that season. Moves only (Luke's default).
 */
export function EraRibbon({ counts, lastSeason, selected, playerMode, noun, hrefFor }: EraRibbonProps) {
  const total = lastSeason - FIRST + 1
  const bySeason = new Map(counts.map((c) => [c.season_id, c.count]))
  const max = Math.max(1, ...counts.map((c) => c.count))
  const pos = (y: number) => ((y - FIRST + 0.5) / total) * 100
  const plural = (n: number) => `${n} ${noun}${n === 1 ? '' : 's'}`

  return (
    <section aria-label={`Franchise eras, ${FIRST} to today`} className="relative pt-1">
      <div className="mb-1.5 flex h-6 items-end gap-px sm:h-[30px] sm:gap-0.5">
        {Array.from({ length: total }, (_, i) => {
          const y = FIRST + i
          const n = bySeason.get(y) ?? 0
          const h = playerMode ? 55 : Math.max(10, (n / max) * 100)
          const label = `${seasonLabel(y)} · ${plural(n)}`
          return (
            <Link
              key={y}
              href={hrefFor(y)}
              scroll={false}
              prefetch={false}
              // A pointer shortcut: keyboard users pick the season from the select below, not 57 tab stops.
              tabIndex={-1}
              title={label}
              aria-label={label}
              aria-current={y === selected ? 'true' : undefined}
              className="group flex h-full flex-1 items-end"
            >
              <i
                className={cn(
                  'block w-full rounded-t-[2px] rounded-b-[1px] transition-colors duration-200 ease-premium',
                  n === 0
                    ? 'bg-[rgba(150,178,230,0.1)]'
                    : y === selected
                      ? 'bg-pacific shadow-[0_0_12px_-2px_rgba(65,143,222,0.8)]'
                      : playerMode
                        ? 'bg-pacific/75 group-hover:bg-pacific'
                        : 'bg-[rgba(150,178,230,0.26)] group-hover:bg-[rgba(150,178,230,0.55)]',
                )}
                style={{ height: n === 0 ? 2 : `${h}%` }}
              />
            </Link>
          )
        })}
      </div>

      <div className="glass-track relative flex h-[34px] overflow-hidden rounded-full">
        {ERAS.map((era, i) => {
          const last = era.last ?? lastSeason
          const span = last - era.first + 1
          const current = era.last == null
          return (
            <div
              key={era.key}
              className={cn(
                'relative flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap px-2 sm:px-3',
                i > 0 && 'shadow-[inset_1px_0_0_rgba(150,178,230,0.16)]',
                i === 0 && 'bg-white/[0.025]',
                i === 1 && 'bg-white/[0.045]',
                current && 'bg-[linear-gradient(90deg,rgba(12,35,64,0.85),rgba(65,143,222,0.16)_70%,rgba(65,143,222,0.24))]',
              )}
              style={{ flex: span }}
            >
              {current ? (
                <span className="text-[12.5px] font-medium tracking-[-0.01em] text-text">{era.name}</span>
              ) : (
                <>
                  <span className="hidden text-[12.5px] font-medium tracking-[-0.01em] text-text sm:inline">{era.name}</span>
                  <span className="font-mono text-[10.5px] text-mute sm:hidden" aria-label={era.name}>
                    {era.short}
                  </span>
                </>
              )}
              {current && <span className="hidden font-mono text-[10.5px] text-dim min-[480px]:inline">{era.first}–today</span>}
            </div>
          )
        })}
        {selected != null && selected >= FIRST && selected <= lastSeason && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 -ml-px w-0.5 bg-pacific shadow-[0_0_10px_rgba(65,143,222,0.9)]"
            style={{ left: `${pos(selected)}%` }}
          />
        )}
      </div>

      <div aria-hidden className="relative mt-[7px] h-4">
        {TICKS.map((y, i) => (
          <span
            key={y}
            className={cn(
              'absolute font-mono text-[10.5px] tracking-[0.04em] text-dim',
              i === 0 ? '' : '-translate-x-1/2',
              i % 2 === 1 && 'max-sm:hidden',
              selected != null && Math.abs(y - selected) < 4 && 'invisible',
            )}
            style={{ left: `${((y - FIRST) / total) * 100}%` }}
          >
            {y}
          </span>
        ))}
        {selected != null && selected >= FIRST && selected <= lastSeason && (
          <span
            className="absolute -translate-x-1/2 whitespace-nowrap font-mono text-[10.5px] tracking-[0.04em] text-[#9cc7f2]"
            style={{ left: `${Math.min(94, Math.max(6, pos(selected)))}%` }}
          >
            {seasonLabel(selected)}
          </span>
        )}
      </div>
    </section>
  )
}
