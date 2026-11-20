import type { Metadata } from 'next'
import { cn } from '@/lib/utils'
import { NextGamePanel } from '@/components/game/NextGamePanel'
import { UpNextList } from '@/components/game/UpNextList'
import { SeasonPanel } from '@/components/home/SeasonPanel'
import { LastTenPanel } from '@/components/home/LastTenPanel'
import { PlayerLeaders } from '@/components/home/PlayerLeaders'
import { HomeBuzz } from '@/components/home/HomeBuzz'
import { HomeLive } from '@/components/home/HomeLive'
import { InsightTile } from '@/components/insights/kit/InsightTile'
import { CompactInsightList } from '@/components/insights/kit/CompactInsightList'
import { Eyebrow } from '@/components/ui/eyebrow'
import { Chip } from '@/components/ui/chip'
import { EmptyState } from '@/components/ui/empty-state'
import { ClockWindow, TimeAgo } from '@/components/ui/clock'
import { getJson } from '@/src/lib/ui/api'
import { annotateSchedule } from '@/src/lib/ui/schedule'
import { playedGames, regularSeason, seasonSummary, type HistoryGame } from '@/src/lib/ui/season'
import { gamesOverAt, heroCandidates, seasonRolloverAt, slotWindow } from '@/src/lib/ui/clock'
import { formatSeasonLabel, seasonStartYear } from '@/src/lib/home-utils'
import type { HomePayload, PlayersPayload, ScheduleGame } from '@/src/lib/ui/types'

export const metadata: Metadata = { title: 'Home' }

// The page is prerendered: the hero carries the next few games and the browser
// shows the first not yet over (a late or failed post-final rebuild never
// leaves a finished game as "next"). Up next slides along with it.
const HERO_SLOTS = 3
const UP_NEXT = 4

export default async function HomePage() {
  const [home, roster] = await Promise.all([
    getJson<HomePayload>('/api/home'),
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
  const regular = regularSeason(played)
  const summary = regular.length ? seasonSummary(regular) : null
  const gameIdByDate = new Map(played.map((g) => [`${g.game_date}|${g.opponent_abbr}`, g.game_id]))

  // "This season" turns into "Last season" on July 1; the browser flips it if
  // that passes between rebuilds.
  const isPastSeason = seasonId != null && seasonId < seasonStartYear()
  const seasonWord = (current: string, past: string) =>
    seasonId == null ? (
      current
    ) : (
      <>
        <ClockWindow until={seasonRolloverAt(seasonId)} initial={!isPastSeason}>
          {current}
        </ClockWindow>
        <ClockWindow from={seasonRolloverAt(seasonId)} initial={isPastSeason}>
          {past}
        </ClockWindow>
      </>
    )

  const upcoming = annotateSchedule(home.upcoming_schedule ?? [], null)
  const standById = new Map(upcoming.map((g) => [String(g.game_id), g.annotation.stand]))
  const contextFor = (g: ScheduleGame) => {
    const isOpener = seasonId != null && seasonStartYear(new Date(`${g.game_date}T12:00:00Z`)) > seasonId
    const stand = standById.get(String(g.game_id))
    return isOpener ? (
      <Chip tone="blue">Season opener</Chip>
    ) : stand ? (
      <Chip tone="blue">{stand.kind === 'home' ? 'Home stand' : 'Road trip'}</Chip>
    ) : null
  }
  const heroGames = heroCandidates(home.next_game, home.upcoming_schedule ?? [])
  const heroOverAt = gamesOverAt(heroGames)
  const upcomingOverAt = gamesOverAt(upcoming)

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
          {heroGames.slice(0, HERO_SLOTS).map((g, i) => (
            <ClockWindow key={g.game_id} {...slotWindow(heroOverAt, i, 0, 1)}>
              <NextGamePanel
                game={g}
                context={contextFor(g)}
                href={`/schedule/${g.game_id}`}
                // The pregame feeds are about the build's next game only.
                insights={i === 0 && feeds ? { scouting: feeds.scouting, notes: feeds.notes } : undefined}
              />
            </ClockWindow>
          ))}
          {heroGames.length <= HERO_SLOTS && (
            <ClockWindow from={heroOverAt.at(-1)} initial={heroGames.length === 0}>
              <NextGamePanel game={null} />
            </ClockWindow>
          )}
        </HomeLive>
        {snapshot && (
          <SeasonPanel
            title={seasonWord('This season', 'Last season')}
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
          <Eyebrow aside={seasonWord('last 10 games', 'final 10 games')}>Player trends</Eyebrow>
          <PlayerLeaders players={leaders} />
        </section>
      )}

      {/* News loads live in the browser, so this prerendered page needn't rebuild for it. */}
      <HomeBuzz index={5} />
      {upcoming.length > 1 && (
        <section className="enter" style={{ ['--i' as string]: 6 }}>
          <Eyebrow aside="all times PT">Up next</Eyebrow>
          <UpNextList
            games={upcoming
              .slice(1, 1 + UP_NEXT + HERO_SLOTS - 1)
              .map((g, k) => ({ ...g, window: slotWindow(upcomingOverAt, k + 1, 1, UP_NEXT) }))}
          />
        </section>
      )}
      {home.meta?.last_sync_at && (
        <p className="m-0 font-mono text-[11.5px] text-dim">
          <TimeAgo at={home.meta.last_sync_at} prefix="Data synced " suffix=" ago" />
        </p>
      )}
    </div>
  )
}
