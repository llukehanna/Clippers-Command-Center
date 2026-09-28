import type { Metadata } from 'next'
import { PageHeader } from '@/components/shell/PageHeader'
import { SeasonSelect } from '@/components/history/SeasonSelect'
import { SeasonStrip } from '@/components/history/SeasonStrip'
import { GameList } from '@/components/history/GameList'
import { SegmentedLinks } from '@/components/ui/segmented-links'
import { Panel } from '@/components/ui/panel'
import { Stat } from '@/components/ui/stat'
import { Chip } from '@/components/ui/chip'
import { EmptyState } from '@/components/ui/empty-state'
import { getJson } from '@/src/lib/ui/api'
import { formatSigned } from '@/src/lib/ui/odds'
import { playedGames, seasonSummary, streaks, upcomingGames, type HistoryGame } from '@/src/lib/ui/season'

export const metadata: Metadata = { title: 'History' }

type SP = { season_id?: string; home_away?: string; result?: string }

export default async function HistoryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const params = await searchParams
  const seasonsRes = await getJson<{ seasons: Array<{ season_id: number; label: string }> }>('/api/history/seasons')
  const seasons = seasonsRes?.seasons ?? []
  const seasonId = params.season_id ?? String(seasons.at(-1)?.season_id ?? '')
  const gamesRes = seasonId ? await getJson<{ games: HistoryGame[] }>(`/api/history/games?season_id=${seasonId}&limit=200`) : null
  const all = gamesRes?.games ?? []

  const homeAway = params.home_away === 'home' || params.home_away === 'away' ? params.home_away : 'all'
  const result = params.result === 'W' || params.result === 'L' ? params.result : 'all'
  const played = playedGames(all)
  const summary = seasonSummary(played)
  const filtered = played.filter((g) => (homeAway === 'all' || g.home_away === homeAway) && (result === 'all' || g.result === result))
  const upcoming = homeAway === 'all' && result === 'all' ? upcomingGames(all) : []
  const label = seasons.find((s) => String(s.season_id) === seasonId)?.label.replace('-', '–') ?? ''

  const href = (next: Partial<SP>) => {
    const q = new URLSearchParams()
    if (seasonId) q.set('season_id', seasonId)
    const ha = next.home_away ?? homeAway
    const r = next.result ?? result
    if (ha !== 'all') q.set('home_away', ha)
    if (r !== 'all') q.set('result', r)
    return `/history?${q.toString()}`
  }

  if (!seasonsRes) {
    return (
      <div className="page">
        <PageHeader title="History" />
        <EmptyState title="History couldn't load" body="The data service didn't respond. Refresh in a moment." />
      </div>
    )
  }

  const pct = (w: number, l: number) => (w + l ? `${((w / (w + l)) * 100).toFixed(0)}%` : '—')

  return (
    <div className="page">
      <PageHeader
        title="History"
        subtitle={label ? `${label} season · ${played.length} games played` : 'Past seasons'}
        actions={seasons.length > 0 && <SeasonSelect seasons={seasons} value={seasonId} />}
      />

      {played.length > 0 && (
        <section className="enter grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-3">
          <Panel className="p-4 sm:p-5">
            <Stat label="Record" size="lg" value={`${summary.wins}–${summary.losses}`} sub={`${pct(summary.wins, summary.losses)} wins`} />
          </Panel>
          <Panel className="p-4 sm:p-5">
            <Stat label="Home" size="lg" value={`${summary.home.w}–${summary.home.l}`} sub={pct(summary.home.w, summary.home.l)} />
          </Panel>
          <Panel className="p-4 sm:p-5">
            <Stat label="Away" size="lg" value={`${summary.away.w}–${summary.away.l}`} sub={pct(summary.away.w, summary.away.l)} />
          </Panel>
          <Panel className="p-4 sm:p-5">
            <Stat
              label="Avg margin"
              size="lg"
              value={formatSigned(summary.avgMargin, 1)}
              valueTone={summary.avgMargin == null ? 'default' : summary.avgMargin >= 0 ? 'pos' : 'neg'}
              sub="points per game"
            />
          </Panel>
        </section>
      )}

      {played.length > 0 && (
        <section className="enter" style={{ ['--i' as string]: 1 }}>
          <SeasonStrip games={played} streaks={streaks(played)} />
        </section>
      )}

      {all.length > 0 && all.length < 30 && (
        <p className="m-0 flex items-center gap-2 text-[13px] text-mute">
          <Chip tone="warn">Partial</Chip>
          {all.length} of ~82 games are in the database for this season.
        </p>
      )}

      <section className="enter grid gap-4" style={{ ['--i' as string]: 2 }}>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedLinks
            ariaLabel="Venue"
            size="sm"
            value={homeAway}
            options={[
              { value: 'all', label: 'All games', href: href({ home_away: 'all' }) },
              { value: 'home', label: 'Home', href: href({ home_away: 'home' }) },
              { value: 'away', label: 'Away', href: href({ home_away: 'away' }) },
            ]}
          />
          <SegmentedLinks
            ariaLabel="Result"
            size="sm"
            value={result}
            options={[
              { value: 'all', label: 'All results', href: href({ result: 'all' }) },
              { value: 'W', label: 'Wins', href: href({ result: 'W' }) },
              { value: 'L', label: 'Losses', href: href({ result: 'L' }) },
            ]}
          />
          {(homeAway !== 'all' || result !== 'all') && (
            <span className="font-mono text-[11.5px] text-dim">
              {filtered.length} of {played.length}
            </span>
          )}
        </div>
        {filtered.length === 0 && upcoming.length === 0 ? (
          <EmptyState title={played.length ? 'No games match these filters' : 'No games played yet this season'} />
        ) : (
          <GameList played={filtered} upcoming={upcoming} />
        )}
      </section>
    </div>
  )
}
