import { RosterViewToggle } from '@/components/players/RosterViewToggle'
import type { Player } from '@/components/players/RosterViewToggle'

export default async function PlayersPage() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
  let players: Player[] = []
  try {
    const res = await fetch(`${baseUrl}/api/players?include_traded=true`, { cache: 'no-store' })
    if (res.ok) {
      const data = await res.json()
      players = data.players ?? []
    }
  } catch {
    // Graceful degradation — render empty roster, don't throw
  }

  const currentYear = new Date().getFullYear()
  const nextYear = (currentYear + 1).toString().slice(2)

  return (
    <div className="px-6 py-6 max-w-[1440px] mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Players</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Clippers roster — {currentYear}–{nextYear} season
        </p>
      </div>
      <RosterViewToggle players={players} />
    </div>
  )
}
