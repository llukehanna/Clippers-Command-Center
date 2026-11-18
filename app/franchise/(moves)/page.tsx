import type { Metadata } from 'next'
import Link from 'next/link'
import { Eyebrow } from '@/components/ui/eyebrow'
import { Panel } from '@/components/ui/panel'
import { EmptyState } from '@/components/ui/empty-state'
import { SegmentedLinks } from '@/components/ui/segmented-links'
import { EraRibbon } from '@/components/franchise/EraRibbon'
import { MoveRow } from '@/components/franchise/MoveRow'
import { MoveSeasonSelect } from '@/components/franchise/MoveSeasonSelect'
import { PlayerFilter } from '@/components/franchise/PlayerFilter'
import { getJson } from '@/src/lib/ui/api'
import { calendarSeasonId } from '@/src/lib/season'
import { adjacentSeasons, allowsAllSeasons, groupBySeason, movesHref, parseMovesSeason, seasonLabel, type MovesFilters } from '@/src/lib/franchise/display'
import type { MovesPayload, MoveTypeFilter } from '@/src/lib/ui/types'

// Live data on every request (loaders read the database directly).
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Franchise' }

type SP = { season?: string; type?: string; player?: string }

const TYPES: Array<{ value: MoveTypeFilter; label: string; noun: string }> = [
  { value: 'trade', label: 'Trades', noun: 'trade' },
  { value: 'signing', label: 'Signings', noun: 'signing' },
  { value: 'release', label: 'Releases', noun: 'release' },
  { value: 'draft', label: 'Draft', noun: 'draft move' },
  { value: 'other', label: 'Other', noun: 'move' },
  { value: 'all', label: 'All', noun: 'move' },
]

/**
 * Moves: Clippers transactions, newest first, one season at a time (a hard filter with
 * previous/next links). It opens on the latest season with moves of the selected type;
 * "All seasons" exists only where the list stays bounded (Trades, or one player's moves).
 */
export default async function MovesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const params = await searchParams
  const type = TYPES.find((t) => t.value === params.type) ?? TYPES[0]
  const player = params.player?.trim() || null
  const asked = parseMovesSeason(params.season, { type: type.value, player })
  const q = new URLSearchParams({ type: type.value })
  if (asked !== 'all') q.set('season', asked == null ? 'latest' : String(asked))
  if (player) q.set('player', player)
  const data = await getJson<MovesPayload>(`/api/franchise/moves?${q.toString()}`)

  if (!data) {
    return <EmptyState title="Moves couldn't load" body="The data service didn't respond. Refresh in a moment." />
  }
  if (data.seasons.length === 0) {
    return (
      <EmptyState
        title="No moves recorded yet"
        body="The franchise history import hasn't run. Trades, signings and releases since 1970 will show here once it does."
      />
    )
  }

  // The season on screen: the one asked for, or the latest the loader resolved.
  const filters: MovesFilters = { season: asked === 'all' ? 'all' : data.filters.season, type: type.value, player }
  const season = typeof filters.season === 'number' ? filters.season : null
  const counts = data.season_counts
  const lastSeason = Math.max(calendarSeasonId(), ...data.seasons)
  const selectSeasons = season != null && !data.seasons.includes(season) ? [...data.seasons, season].sort((a, b) => b - a) : data.seasons
  const groups = groupBySeason(data.moves)
  const plural = (n: number, noun = type.noun) => `${n} ${noun}${n === 1 ? '' : 's'}`
  const near = season != null ? adjacentSeasons(counts.map((c) => c.season_id), season) : null
  const scope = season != null ? seasonLabel(season) : null
  // One step wider when a filter combination is empty: all types (same season), then any player.
  const widen =
    type.value !== 'all'
      ? { label: 'Show all types', href: movesHref({ ...filters, type: 'all' }) }
      : filters.player
        ? { label: 'Clear the player filter', href: movesHref({ ...filters, player: null }) }
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
        />
      </div>

      <section aria-label="Filters" className="enter relative z-20 flex flex-wrap items-center gap-2" style={{ ['--i' as string]: 3 }}>
        <MoveSeasonSelect seasons={selectSeasons} filters={filters} allowAll={allowsAllSeasons(filters)} />
        <SegmentedLinks
          ariaLabel="Move type"
          size="sm"
          value={filters.type}
          options={TYPES.map((t) => ({ value: t.value, label: t.label, href: movesHref({ ...filters, type: t.value }) }))}
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
                <Link href={widen.href} scroll={false} className="glass-track press inline-flex rounded-full px-4 py-2 text-[13.5px] text-text">
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
              <Link href={movesHref({ ...filters, season: near.newer })} scroll={false} className="py-2 hover:text-text">
                ← {seasonLabel(near.newer)}
              </Link>
            ) : (
              <span />
            )}
            {type.value !== 'all' ? (
              <Link href={movesHref({ ...filters, type: 'all' })} scroll={false} className="py-2 text-center hover:text-text">
                All {scope} moves
              </Link>
            ) : (
              <span />
            )}
            {near.older != null ? (
              <Link href={movesHref({ ...filters, season: near.older })} scroll={false} className="py-2 text-right hover:text-text">
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
