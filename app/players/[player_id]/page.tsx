import { notFound } from 'next/navigation'
import { PlayerHeader } from '@/components/players/PlayerHeader'
import { RollingAveragesTable } from '@/components/players/RollingAveragesTable'
import { TrendChartSection } from '@/components/players/TrendChartSection'
import { SplitsDisplay } from '@/components/players/SplitsDisplay'
import { GameLogSection } from '@/components/players/GameLogSection'

export default async function PlayerDetailPage({
  params,
}: {
  params: Promise<{ player_id: string }>
}) {
  const { player_id } = await params
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'

  const res = await fetch(`${baseUrl}/api/players/${player_id}`, { cache: 'no-store' })
  if (!res.ok) notFound()

  const data = await res.json()

  return (
    <div className="px-6 py-6 max-w-[1440px] mx-auto space-y-6">
      <PlayerHeader player={data.player} season_averages={data.season_averages} />
      <RollingAveragesTable
        trend_summary={data.trend_summary}
        season_averages={data.season_averages}
        game_log={data.game_log}
      />
      <TrendChartSection charts={data.charts} />
      <SplitsDisplay splits={data.splits} />
      <GameLogSection gameLog={data.game_log} />
    </div>
  )
}
