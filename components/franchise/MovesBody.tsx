import type * as React from 'react'
import Link from 'next/link'
import { Eyebrow } from '@/components/ui/eyebrow'
import { Panel } from '@/components/ui/panel'
import { EmptyState } from '@/components/ui/empty-state'
import { SegmentedLinks } from '@/components/ui/segmented-links'
import { isPlainClick } from '@/components/ui/plain-click'
import { EraRibbon } from '@/components/franchise/EraRibbon'
import { MoveRow } from '@/components/franchise/MoveRow'
import { MoveSeasonSelect } from '@/components/franchise/MoveSeasonSelect'
import { PlayerFilter } from '@/components/franchise/PlayerFilter'
import { adjacentSeasons, allowsAllSeasons, groupBySeason, movesHref, seasonLabel, type MovesFilters } from '@/src/lib/franchise/display'
import type { MovesPayload, MoveTypeFilter } from '@/src/lib/ui/types'

const TYPES: Array<{ value: MoveTypeFilter; label: string; noun: string }> = [
  { value: 'trade', label: 'Trades', noun: 'trade' },
  { value: 'signing', label: 'Signings', noun: 'signing' },
  { value: 'release', label: 'Releases', noun: 'release' },
  { value: 'draft', label: 'Draft', noun: 'draft move' },
  { value: 'other', label: 'Other', noun: 'move' },
  { value: 'all', label: 'All', noun: 'move' },
]

interface MovesBodyProps {
  /** As shown: season is 'all', the season on screen, or null (none matches). */
  filters: MovesFilters
  data: MovesPayload
  /** Latest season start year the era ribbon draws (computed on the server: no hydration drift). */
  lastSeason: number
  /**
   * In-page filters (a person page): links to a view of the same person call
   * this on a plain click instead of navigating. Without it every link navigates.
   */
  onFilters?: (f: MovesFilters) => void
}

/**
 * Moves: Clippers transactions, newest first, one season at a time (a hard filter with
 * previous/next links). "All seasons" exists only where the list stays bounded
 * (Trades, or one player's moves). Renders on the server (the prerendered type and
 * season pages) and in the browser (a person page, with in-page filters).
 */
export function MovesBody({ filters, data, lastSeason, onFilters }: MovesBodyProps) {
  const type = TYPES.find((t) => t.value === filters.type) ?? TYPES[0]
  const season = typeof filters.season === 'number' ? filters.season : null
  const counts = data.season_counts
  const selectSeasons = season != null && !data.seasons.includes(season) ? [...data.seasons, season].sort((a, b) => b - a) : data.seasons
  const groups = groupBySeason(data.moves)
  const plural = (n: number, noun = type.noun) => `${n} ${noun}${n === 1 ? '' : 's'}`
  const near = season != null ? adjacentSeasons(counts.map((c) => c.season_id), season) : null
  const scope = season != null ? seasonLabel(season) : null
  // A view of the same person stays in-page; anything else (no player) is a page.
  const inPage = (f: MovesFilters) => (onFilters && f.player != null ? onFilters : undefined)
  const linkProps = (f: MovesFilters) => {
    const toggle = inPage(f)
    return {
      href: movesHref(f),
      onClick: toggle
        ? (e: React.MouseEvent) => {
            if (!isPlainClick(e)) return
            e.preventDefault()
            toggle(f)
          }
        : undefined,
    }
  }
  // One step wider when a filter combination is empty: all types (same season), then any player.
  const widen =
    type.value !== 'all'
      ? { label: 'Show all types', to: { ...filters, type: 'all' as const } }
      : filters.player
        ? { label: 'Clear the player filter', to: { ...filters, player: null } }
        : null

  return (
    <div className="grid gap-6 sm:gap-7 [&>*]:min-w-0">
      <div className="enter" style={{ ['--i' as string]: 2 }}>
        <EraRibbon
          counts={counts}
          lastSeason={lastSeason}
          selected={season}
          playerMode={filters.player != null}
          noun={type.noun}
          hrefFor={(season) => movesHref({ ...filters, season })}
          onPick={onFilters ? (season) => onFilters({ ...filters, season }) : undefined}
        />
      </div>

      <section aria-label="Filters" className="enter relative z-20 flex flex-wrap items-center gap-2" style={{ ['--i' as string]: 3 }}>
        <MoveSeasonSelect
          seasons={selectSeasons}
          filters={filters}
          allowAll={allowsAllSeasons(filters)}
          onSelect={onFilters ? (season) => onFilters({ ...filters, season }) : undefined}
        />
        <SegmentedLinks
          ariaLabel="Move type"
          size="sm"
          value={filters.type}
          options={TYPES.map((t) => ({ value: t.value, label: t.label, href: movesHref({ ...filters, type: t.value }) }))}
          onSelect={onFilters ? (value) => onFilters({ ...filters, type: value as MoveTypeFilter }) : undefined}
        />
        <PlayerFilter filters={filters} player={data.player} />
        {filters.player && <span className="ml-1 font-mono text-[11.5px] text-dim">{plural(data.moves.length)}</span>}
      </section>

      <section className="enter grid gap-7 [&>*]:min-w-0" style={{ ['--i' as string]: 4 }}>
        {data.moves.length === 0 ? (
          <EmptyState
            title={`No ${type.value === 'all' ? 'moves' : `${type.noun}s`}${scope ? ` in ${scope}` : ''}${data.player ? ` for ${data.player.name}` : ''}`}
            body={widen ? 'Widen the filters to see more.' : 'Nothing matches these filters yet.'}
            action={
              widen && (
                <Link {...linkProps(widen.to)} scroll={false} className="glass-track press inline-flex rounded-full px-4 py-2 text-[13.5px] text-text">
                  {widen.label}
                </Link>
              )
            }
          />
        ) : (
          groups.map((g) => (
            <div key={g.season_id ?? 'unknown'}>
              <Eyebrow aside={plural(g.rows.length)}>{g.season_id == null ? 'Season not recorded' : seasonLabel(g.season_id)}</Eyebrow>
              <Panel className="p-1.5">
                <ol className="m-0 grid list-none gap-px p-0">
                  {g.rows.map((m) => (
                    <MoveRow key={m.slug} move={m} />
                  ))}
                </ol>
              </Panel>
            </div>
          ))
        )}

        {near && (
          <nav aria-label="Season" className="flex items-center justify-between gap-3 px-1 font-mono text-[11.5px] text-mute">
            {near.newer != null ? (
              <Link {...linkProps({ ...filters, season: near.newer })} scroll={false} className="py-2 hover:text-text">
                ← {seasonLabel(near.newer)}
              </Link>
            ) : (
              <span />
            )}
            {type.value !== 'all' ? (
              <Link {...linkProps({ ...filters, type: 'all' })} scroll={false} className="py-2 text-center hover:text-text">
                All {scope} moves
              </Link>
            ) : (
              <span />
            )}
            {near.older != null ? (
              <Link {...linkProps({ ...filters, season: near.older })} scroll={false} className="py-2 text-right hover:text-text">
                {seasonLabel(near.older)} →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </section>
    </div>
  )
}
