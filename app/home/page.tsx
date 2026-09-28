import type { Metadata } from 'next'
import { NextGamePanel } from '@/components/game/NextGamePanel'
import { UpNextList } from '@/components/game/UpNextList'
import { SeasonPanel } from '@/components/home/SeasonPanel'
import { LastTenPanel } from '@/components/home/LastTenPanel'
import { PlayerLeaders } from '@/components/home/PlayerLeaders'
import { InsightStack } from '@/components/insights/InsightStack'
import { Eyebrow } from '@/components/ui/eyebrow'
import { Chip } from '@/components/ui/chip'
import { EmptyState } from '@/components/ui/empty-state'
import { getJson } from '@/src/lib/ui/api'
import { annotateSchedule } from '@/src/lib/ui/schedule'
import { playedGames, seasonSummary, type HistoryGame } from '@/src/lib/ui/season'
import { formatSeasonLabel, seasonStartYear } from '@/src/lib/home-utils'
import type { HomePayload, Insight, PlayersPayload } from '@/src/lib/ui/types'

export const metadata: Metadata = { title: 'Home' }

export default async function HomePage() {
  const [home, insightsRes, roster] = await Promise.all([
    getJson<HomePayload>('/api/home'),
    getJson<{ insights: Insight[] }>('/api/insights?scope=between_games&limit=12'),
    getJson<PlayersPayload>('/api/players?include_traded=true'),
  ])

  if (!home) {
    return (
      <div className="page">
        <EmptyState title="The dashboard couldn't load" body="The data service didn't respond. Refresh in a moment." />
      </div>
    )
  }

  const snapshot = home.team_snapshot
  const seasonId = snapshot?.season_id ?? null
  const history = seasonId
    ? await getJson<{ games: HistoryGame[] }>(`/api/history/games?season_id=${seasonId}&limit=200`)
    : null
  const played = playedGames(history?.games ?? [])
  const summary = played.length ? seasonSummary(played) : null
  const gameIdByDate = new Map(played.map((g) => [`${g.game_date}|${g.opponent_abbr}`, g.game_id]))

  const next = home.next_game
  const isPastSeason = seasonId != null && seasonId < seasonStartYear()
  const nextIsOpener = next != null && seasonId != null && seasonStartYear(new Date(`${next.game_date}T12:00:00Z`)) > seasonId
  const upcoming = annotateSchedule(home.upcoming_schedule ?? [], null)
  const nextContext = next ? (
    nextIsOpener ? (
      <Chip tone="blue">Season opener</Chip>
    ) : upcoming[0]?.annotation.stand ? (
      <Chip tone="blue">{upcoming[0].annotation.stand.kind === 'home' ? 'Home stand' : 'Road trip'}</Chip>
    ) : null
  ) : null

  const rosterById = new Map((roster?.players ?? []).map((p) => [String(p.player_id), p]))
  const leaders = [...(home.player_trends ?? [])]
    .sort((a, b) => (b.pts_avg ?? 0) - (a.pts_avg ?? 0))
    .slice(0, 6)
    .map((p) => {
      const r = rosterById.get(String(p.player_id))
      return { ...p, position: r?.position ?? null, nba_player_id: r?.nba_player_id ?? null }
    })

  const insights = (insightsRes?.insights ?? []).slice().sort((a, b) => b.importance - a.importance)
  const last10 = (snapshot?.last10_games ?? []).map((g) => ({
    ...g,
    game_id: gameIdByDate.get(`${g.game_date}|${g.opponent_abbr}`),
  }))
  const last10Margin = last10.length ? last10.reduce((s, g) => s + g.margin, 0) / last10.length : null

  return (
    <div className="page">
      <section className="enter grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:gap-[18px]" style={{ ['--i' as string]: 0 }}>
        <NextGamePanel game={next} context={nextContext} />
        {snapshot && (
          <SeasonPanel
            title={isPastSeason ? 'Last season' : 'This season'}
            seasonLabel={formatSeasonLabel(snapshot.season_id).replace('-', '–')}
            record={snapshot.record}
            last10={snapshot.last_10}
            last10Margin={last10Margin}
            splits={summary ? { home: summary.home, away: summary.away } : null}
            ratings={{ net: snapshot.net_rating, off: snapshot.off_rating, def: snapshot.def_rating }}
          />
        )}
      </section>

      {last10.length > 0 && (
        <section className="enter" style={{ ['--i' as string]: 1 }}>
          <LastTenPanel games={last10} />
        </section>
      )}

      <section className="enter grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-[18px]" style={{ ['--i' as string]: 2 }}>
        {leaders.length > 0 && (
          <div>
            <Eyebrow aside={isPastSeason ? 'final 10 games' : 'last 10 games'}>Player trends</Eyebrow>
            <PlayerLeaders players={leaders} />
          </div>
        )}
        {insights.length > 0 && (
          <div>
            <Eyebrow aside={`${insights.length} verified`}>Insights</Eyebrow>
            <InsightStack insights={insights} />
          </div>
        )}
      </section>

      {upcoming.length > 1 && (
        <section className="enter" style={{ ['--i' as string]: 3 }}>
          <Eyebrow aside="all times PT">Up next</Eyebrow>
          <UpNextList games={upcoming.slice(1, 5)} />
        </section>
      )}
    </div>
  )
}
