import { notFound } from 'next/navigation'
import { PlayerHeader } from '@/components/players/PlayerHeader'
import { RollingAveragesTable } from '@/components/players/RollingAveragesTable'
import { TrendChartSection } from '@/components/players/TrendChartSection'
import { SplitsDisplay } from '@/components/players/SplitsDisplay'
import { GameLogSection } from '@/components/players/GameLogSection'
import { loadPlayer } from '@/src/lib/data/player'
import { okBody } from '@/src/lib/data/result'

// Rendered per request: data is read straight from the database.
export const dynamic = 'force-dynamic'

export default async function PlayerDetailPage({
  params,
}: {
  params: Promise<{ player_id: string }>
}) {
  const { player_id } = await params
  const data = okBody(await loadPlayer(player_id, new URL(`http://internal/api/players/${player_id}`)))
  if (!data) notFound()

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
