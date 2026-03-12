import { notFound } from 'next/navigation'
import { GameHeader } from '@/components/history/GameHeader'
import { HistoryGameDetail } from '@/components/history/HistoryGameDetail'

export default async function HistoryGamePage({
  params,
}: {
  params: Promise<{ game_id: string }>
}) {
  const { game_id } = await params
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'

  const res = await fetch(`${baseUrl}/api/history/games/${game_id}`, { cache: 'no-store' })
  if (!res.ok) notFound()

  const data = await res.json()
  const { game, box_score, insights: rawInsights } = data

  // CRITICAL: Map proof.summary → category (InsightTileArea expects category at top level)
  const mappedInsights = (rawInsights ?? []).map((ins: {
    insight_id: string
    headline: string
    detail: string
    importance: number
    proof?: { summary?: string; result?: unknown }
  }) => ({
    ...ins,
    category: ins.proof?.summary ?? '',
  }))

  // Determine if LAC is home team
  const isHome = game.home_abbr === 'LAC'

  return (
    <div className="px-6 py-6 max-w-[1440px] mx-auto space-y-6">
      <GameHeader
        homeAbbr={game.home_abbr}
        awayAbbr={game.away_abbr}
        homeScore={game.home_score}
        awayScore={game.away_score}
        gameDate={game.game_date}
        status={game.status}
        isHome={isHome}
      />
      <HistoryGameDetail
        boxScore={box_score}
        homeAbbr={game.home_abbr}
        awayAbbr={game.away_abbr}
        insights={mappedInsights}
      />
    </div>
  )
}
