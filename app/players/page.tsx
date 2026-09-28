import { RosterViewToggle } from '@/components/players/RosterViewToggle'
import type { Player } from '@/components/players/RosterViewToggle'
import { formatSeasonLabel, seasonStartYear } from '@/src/lib/home-utils'
import { loadPlayers } from '@/src/lib/data/players'
import { okBody } from '@/src/lib/data/result'

// Rendered per request: data is read straight from the database.
export const dynamic = 'force-dynamic'

export default async function PlayersPage() {
  const data = okBody(await loadPlayers(new URL('http://internal/api/players')))
  const players: Player[] = data?.players ?? []
  const seasonId: number | null = typeof data?.season_id === 'number' ? data.season_id : null

  // Prefer the season the API actually scoped the roster to; fall back to the
  // calendar (rolls over July 1) if the API didn't say.
  const seasonLabel = formatSeasonLabel(seasonId ?? seasonStartYear()).replace('-', '–')

  return (
    <div className="px-6 py-6 max-w-[1440px] mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Players</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Clippers roster — {seasonLabel} season
        </p>
      </div>
      <RosterViewToggle players={players} />
    </div>
  )
}
