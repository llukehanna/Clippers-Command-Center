import { EmptyState } from '@/components/ui/empty-state'
import { MovesBody } from '@/components/franchise/MovesBody'
import { PersonMoves } from '@/components/franchise/PersonMoves'
import { getJson } from '@/src/lib/ui/api'
import { calendarSeasonId } from '@/src/lib/season'
import type { MovesFilters } from '@/src/lib/franchise/display'
import type { MovesPayload } from '@/src/lib/ui/types'

/**
 * One Moves page, prerendered: a type in a season (or its latest season, or all
 * seasons for Trades), or one person's whole Clippers history, whose type and
 * season filters are in-page toggles starting from all types, all seasons.
 */
export async function MovesView({ filters }: { filters: MovesFilters }) {
  const q = new URLSearchParams({ type: filters.type })
  if (filters.season !== 'all') q.set('season', filters.season == null ? 'latest' : String(filters.season))
  if (filters.player) q.set('player', filters.player)
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

  const lastSeason = Math.max(calendarSeasonId(), ...data.seasons)
  if (filters.player) return <PersonMoves all={data} initial={filters} lastSeason={lastSeason} />
  // The season on screen: the one asked for, or the latest the loader resolved.
  const shown: MovesFilters = { ...filters, season: filters.season === 'all' ? 'all' : data.filters.season }
  return <MovesBody filters={shown} data={data} lastSeason={lastSeason} />
}
