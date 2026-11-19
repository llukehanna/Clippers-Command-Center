import type { Metadata } from 'next'
import { cn } from '@/lib/utils'
import { NextGamePanel } from '@/components/game/NextGamePanel'
import { UpNextList } from '@/components/game/UpNextList'
import { SeasonPanel } from '@/components/home/SeasonPanel'
import { LastTenPanel } from '@/components/home/LastTenPanel'
import { PlayerLeaders } from '@/components/home/PlayerLeaders'
import { BuzzPanel } from '@/components/home/BuzzPanel'
import { HomeLive } from '@/components/home/HomeLive'
import { InsightTile } from '@/components/insights/kit/InsightTile'
import { CompactInsightList } from '@/components/insights/kit/CompactInsightList'
import { Eyebrow } from '@/components/ui/eyebrow'
import { Chip } from '@/components/ui/chip'
import { EmptyState } from '@/components/ui/empty-state'
import { getJson } from '@/src/lib/ui/api'
import { annotateSchedule } from '@/src/lib/ui/schedule'
import { playedGames, regularSeason, seasonSummary, type HistoryGame } from '@/src/lib/ui/season'
import { ageLabel } from '@/src/lib/ui/time'
import { formatSeasonLabel, seasonStartYear } from '@/src/lib/home-utils'
import type { HomePayload, MediaPayload, PlayersPayload } from '@/src/lib/ui/types'

// Live data on every request (loaders read the database directly).
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Home' }

export default async function HomePage() {
  const [home, roster, media] = await Promise.all([
    getJson<HomePayload>('/api/home'),
    getJson<PlayersPayload>('/api/players?include_traded=true'),
    getJson<MediaPayload>('/api/media?limit=3'),
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
  const regular = regularSeason(played)
  const summary = regular.length ? seasonSummary(regular) : null
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
      return { ...p, position: r?.position ?? null, nba_person_id: p.nba_person_id ?? r?.nba_person_id ?? null }
    })

  const feeds = home.feeds
  const hero = feeds?.hero ?? null
  const recent = feeds?.recent ?? []
  const seasonCards = feeds?.season ?? []
  const gamesPlayed = snapshot ? snapshot.record.wins + snapshot.record.losses : null
  const last10 = (snapshot?.last10_games ?? []).map((g) => ({
    ...g,
    game_id: gameIdByDate.get(`${g.game_date}|${g.opponent_abbr}`),
  }))
  const last10Margin = last10.length ? last10.reduce((s, g) => s + g.margin, 0) / last10.length : null

  return (
    <div className="page">
      <section className="enter grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:gap-[18px]" style={{ ['--i' as string]: 0 }}>
        <HomeLive>
          <NextGamePanel
            game={next}
            context={nextContext}
            href={next ? `/schedule/${next.game_id}` : undefined}
            insights={feeds ? { scouting: feeds.scouting, notes: feeds.notes } : undefined}
          />
        </HomeLive>
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

      {(hero || recent.length > 0) && (
        <section className="enter" style={{ ['--i' as string]: 2 }}>
          <Eyebrow aside="ranked by how rare · all verified">Insights</Eyebrow>
          {/* Two columns only when both sides have something; otherwise one, with no blank column. */}
          <div
            className={cn(
              'grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:gap-[18px]',
              hero && recent.length > 0 && 'lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]',
            )}
          >
            {hero && (
              <div className="min-w-0">
                <InsightTile card={hero} size="hero" />
              </div>
            )}
            {recent.length > 0 && (
              <div className="min-w-0">
                <Eyebrow as="h3" aside="last 10">From recent games</Eyebrow>
                <CompactInsightList cards={recent} />
              </div>
            )}
          </div>
        </section>
      )}

      {seasonCards.length > 0 && (
        <section className="enter" style={{ ['--i' as string]: 3 }}>
          <Eyebrow aside={gamesPlayed != null ? `through ${gamesPlayed} games` : undefined}>This season</Eyebrow>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5 min-[760px]:grid-cols-2 min-[1100px]:grid-cols-3">
            {seasonCards.map((card) => (
              <InsightTile key={card.insight_id} card={card} size="standard" />
            ))}
          </div>
        </section>
      )}

      {leaders.length > 0 && (
        <section className="enter" style={{ ['--i' as string]: 4 }}>
          <Eyebrow aside={isPastSeason ? 'final 10 games' : 'last 10 games'}>Player trends</Eyebrow>
          <PlayerLeaders players={leaders} />
        </section>
      )}

      {media && (media.articles.length > 0 || media.social.length > 0) && (
        <section className="enter" style={{ ['--i' as string]: 5 }}>
          <BuzzPanel articles={media.articles.slice(0, 3)} social={media.social.slice(0, 2)} />
        </section>
      )}
      {upcoming.length > 1 && (
        <section className="enter" style={{ ['--i' as string]: 6 }}>
          <Eyebrow aside="all times PT">Up next</Eyebrow>
          <UpNextList games={upcoming.slice(1, 5)} />
        </section>
      )}
      {home.meta?.last_sync_at && (
        <p className="m-0 font-mono text-[11.5px] text-dim">Data synced {ageLabel(home.meta.last_sync_at)} ago</p>
      )}
    </div>
  )
}
