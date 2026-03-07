import { TeamSnapshot } from '@/components/home/TeamSnapshot'
import { NextGameHero } from '@/components/home/NextGameHero'
import { ScheduleTable } from '@/components/home/ScheduleTable'
// Plan 02 will add: PlayerTrendsTable, PointDiffChart
// InsightTileArea import added in Plan 02

async function getHomeData() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
  const res = await fetch(`${baseUrl}/api/home`, { cache: 'no-store' })
  if (!res.ok) return null
  return res.json()
}

async function getTeamInsights() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
  const res = await fetch(`${baseUrl}/api/insights?scope=team&is_active=true`, { cache: 'no-store' })
  if (!res.ok) return []
  const body = await res.json()
  return body.insights ?? []
}

export default async function HomePage() {
  const [data, teamInsights] = await Promise.all([getHomeData(), getTeamInsights()])

  if (!data) {
    return (
      <div className="px-6 py-6 max-w-[1440px] mx-auto">
        <p className="text-sm text-muted-foreground">Unable to load dashboard data.</p>
      </div>
    )
  }

  return (
    <div className="px-6 py-6 max-w-[1440px] mx-auto space-y-6">
      <TeamSnapshot snapshot={data.team_snapshot} />
      <div className="space-y-4">
        <NextGameHero game={data.next_game ?? null} />
        {data.upcoming_schedule?.length > 1 && (
          <ScheduleTable games={data.upcoming_schedule.slice(1, 5)} />
        )}
      </div>
      {/* Plan 02 will add PlayerTrendsTable, InsightTileArea, PointDiffChart here */}
    </div>
  )
}
