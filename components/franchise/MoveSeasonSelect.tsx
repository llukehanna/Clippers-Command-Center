'use client'

import { useRouter } from 'next/navigation'
import { ERAS, eraOf, movesHref, seasonLabel, type MovesFilters } from '@/src/lib/franchise/display'

/**
 * Season picker for Moves (a hard filter); keeps the type and player filters.
 * "All seasons" appears only where the list stays bounded (allowAll). With
 * onSelect (a person page) the season is in-page state, not a navigation.
 */
export function MoveSeasonSelect({
  seasons,
  filters,
  allowAll,
  onSelect,
}: {
  seasons: number[]
  filters: MovesFilters
  allowAll: boolean
  onSelect?: (season: MovesFilters['season']) => void
}) {
  const router = useRouter()
  const groups = ERAS.map((era) => ({ era, seasons: seasons.filter((s) => eraOf(s).key === era.key) }))
    .filter((g) => g.seasons.length > 0)
    .reverse()
  const value = filters.season == null ? '' : String(filters.season)
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Season</span>
      <select
        value={value}
        onChange={(e) => {
          const v = e.target.value
          const season = v === 'all' ? 'all' : v ? Number(v) : null
          if (onSelect) onSelect(season)
          else router.push(movesHref({ ...filters, season }), { scroll: false })
        }}
        className="glass-track press cursor-pointer appearance-none rounded-full py-2 pl-4 pr-9 text-[16px] text-text outline-none transition-colors hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-pacific md:py-1.5 md:pl-3.5 md:pr-8 md:text-[13.5px]"
      >
        {allowAll && (
          <option value="all" className="bg-ink-2">
            All seasons
          </option>
        )}
        {filters.season == null && (
          <option value="" className="bg-ink-2">
            —
          </option>
        )}
        {groups.map((g) => (
          <optgroup key={g.era.key} label={g.era.name} className="bg-ink-2">
            {g.seasons.map((s) => (
              <option key={s} value={String(s)} className="bg-ink-2">
                {seasonLabel(s)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" className="pointer-events-none absolute right-3 text-mute">
        <path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </svg>
    </label>
  )
}
