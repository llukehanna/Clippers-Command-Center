import { SeasonControls } from '@/components/history/SeasonControls'
import { SeasonSummaryBar } from '@/components/history/SeasonSummaryBar'
import { GameListTable } from '@/components/history/GameListTable'
import type { GameItem } from '@/src/lib/history-utils'
import { loadHistorySeasons } from '@/src/lib/data/history-seasons'
import { loadHistoryGames } from '@/src/lib/data/history-games'
import { okBody } from '@/src/lib/data/result'

// Rendered per request: data is read straight from the database.
export const dynamic = 'force-dynamic'

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ season_id?: string; home_away?: string; result?: string }>
}) {
  const params = await searchParams
  // 1. Available seasons
  const seasonsData = okBody(await loadHistorySeasons())
  const seasons: Array<{ season_id: number; label: string }> = seasonsData?.seasons ?? []

  // 2. Default to most recent season (seasons are ordered ascending — last is newest)
  const seasonId = params.season_id ?? String(seasons.at(-1)?.season_id ?? '')

  // 3. Fetch ALL games for the season (unfiltered, limit=200) — used for W-L summary AND filtered list
  let allGames: GameItem[] = []
  if (seasonId) {
    const url = new URL('http://internal/api/history/games')
    url.searchParams.set('season_id', seasonId)
    url.searchParams.set('limit', '200')
    const gamesData = okBody(await loadHistoryGames(url))
    allGames = gamesData?.games ?? []
  }

  // 4. Apply display filters in RSC (W-L summary always uses allGames)
  const homeAway = params.home_away ?? null
  const resultFilter = params.result ?? null
  const filteredGames = allGames.filter((g) => {
    if (homeAway && g.home_away !== homeAway) return false
    if (resultFilter && g.result !== resultFilter) return false
    return true
  })

  // Show a data gap notice when fewer than 30 games are in the DB for a season
  // (an NBA regular season has 82 games — low count indicates missing historical data)
  const showDataGapNotice = allGames.length > 0 && allGames.length < 30

  return (
    <div className="px-6 py-6 max-w-[1440px] mx-auto space-y-4">
      <h1 className="text-xl font-semibold text-foreground">Historical Games</h1>
      <SeasonControls seasons={seasons} currentSeasonId={seasonId} />
      <SeasonSummaryBar games={allGames} />
      {showDataGapNotice && (
        <p className="text-[0.8125rem] text-muted-foreground">
          Showing {allGames.length} of ~82 season games — historical game data not yet fully ingested.
        </p>
      )}
      <GameListTable games={filteredGames} />
    </div>
  )
}
