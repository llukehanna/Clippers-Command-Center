import { TeamSnapshot } from '@/components/home/TeamSnapshot'
import { NextGameHero } from '@/components/home/NextGameHero'
import { ScheduleTable } from '@/components/home/ScheduleTable'
import { PlayerTrendsTable } from '@/components/home/PlayerTrendsTable'
import { InsightTileArea } from '@/components/live/InsightTileArea'
import { PointDiffChart } from '@/components/home/PointDiffChart'
import { formatSeasonLabel } from '@/src/lib/home-utils'

async function getHomeData() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
  const res = await fetch(`${baseUrl}/api/home`, { cache: 'no-store' })
  if (!res.ok) return null
  return res.json()
}

async function getTeamInsights() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
  const res = await fetch(`${baseUrl}/api/insights?scope=between_games`, { cache: 'no-store' })
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

  const snapshot = data.team_snapshot
  const upcoming = Array.isArray(data.upcoming_schedule) ? data.upcoming_schedule : []
  const last10Games = Array.isArray(snapshot?.last10_games) ? snapshot.last10_games : []
  // Offseason: no games played and none scheduled — label the season so a
  // 0–0 record isn't read as a bad start.
  const isOffseason =
    upcoming.length === 0 &&
    snapshot?.record?.wins === 0 &&
    snapshot?.record?.losses === 0 &&
    typeof snapshot?.season_id === 'number'

  return (
    <div className="px-6 py-6 max-w-[1440px] mx-auto space-y-6">
      {isOffseason && (
        <p className="text-sm text-muted-foreground">
          {formatSeasonLabel(snapshot.season_id).replace('-', '–')} season — no games played yet.
        </p>
      )}
      {snapshot && <TeamSnapshot snapshot={snapshot} />}
      <div className="space-y-4">
        <NextGameHero game={data.next_game ?? null} />
        {upcoming.length > 1 && (
          <ScheduleTable games={upcoming.slice(1, 5)} />
        )}
      </div>
      <PlayerTrendsTable players={data.player_trends} />
      {teamInsights.length > 0 && (
        <InsightTileArea insights={teamInsights} className="h-[200px]" />
      )}
      <PointDiffChart games={last10Games} />
    </div>
  )
}
