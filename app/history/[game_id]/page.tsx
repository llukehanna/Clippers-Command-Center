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
  const homeAbbr: string = game.home_team.abbreviation
  const awayAbbr: string = game.away_team.abbreviation
  const isHome = homeAbbr === 'LAC'

  // box_score.teams is an array [{team_abbr, players, totals}, ...].
  // HistoryGameDetail expects home? / away? named keys — derive them here.
  const homeTeamData = box_score.teams?.find(
    (t: { team_abbr: string }) => t.team_abbr === homeAbbr
  )
  const awayTeamData = box_score.teams?.find(
    (t: { team_abbr: string }) => t.team_abbr === awayAbbr
  )
  const boxScoreForDetail = {
    available: box_score.available,
    home: homeTeamData,
    away: awayTeamData,
  }

  return (
    <div className="px-6 py-6 max-w-[1440px] mx-auto space-y-6">
      <GameHeader
        homeAbbr={homeAbbr}
        awayAbbr={awayAbbr}
        homeScore={game.home_score}
        awayScore={game.away_score}
        gameDate={game.game_date}
        status={game.status}
        isHome={isHome}
      />
      <HistoryGameDetail
        boxScore={boxScoreForDetail}
        homeAbbr={homeAbbr}
        awayAbbr={awayAbbr}
        insights={mappedInsights}
      />
    </div>
  )
}
