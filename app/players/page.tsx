import { RosterViewToggle } from '@/components/players/RosterViewToggle'
import type { Player } from '@/components/players/RosterViewToggle'
import { formatSeasonLabel, seasonStartYear } from '@/src/lib/home-utils'

export default async function PlayersPage() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
  let players: Player[] = []
  let seasonId: number | null = null
  try {
    const res = await fetch(`${baseUrl}/api/players`, { cache: 'no-store' })
    if (res.ok) {
      const data = await res.json()
      players = data.players ?? []
      seasonId = typeof data.season_id === 'number' ? data.season_id : null
    }
  } catch {
    // Graceful degradation — render empty roster, don't throw
  }

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
