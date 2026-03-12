import { NextGameHero } from '@/components/home/NextGameHero'
import { ScheduleTable } from '@/components/home/ScheduleTable'

async function getSchedule() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
  const res = await fetch(`${baseUrl}/api/schedule`, { cache: 'no-store' })
  if (!res.ok) return null
  return res.json()
}

export default async function SchedulePage() {
  const data = await getSchedule()

  const nextGame = data?.next_game ?? null
  // ScheduleTable shows the remaining games after the hero (or all if no next game)
  const remainingGames = (data?.games ?? []).slice(nextGame ? 1 : 0)

  return (
    <div className="px-6 py-6 max-w-[1440px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Schedule</h1>
        <p className="text-sm text-muted-foreground mt-1">Upcoming Clippers games</p>
      </div>

      <NextGameHero game={nextGame} />

      {remainingGames.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Remaining Schedule
          </h2>
          <ScheduleTable games={remainingGames} />
        </div>
      )}
    </div>
  )
}
