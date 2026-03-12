'use client'

import { usePathname } from 'next/navigation'
import { Surface } from '@/components/ui/surface'
import { NavLinkCapsule } from '@/components/ui/nav-link-capsule'
import { useLiveData } from '@/hooks/useLiveData'
import { LiveScoreboard } from '@/components/live/LiveScoreboard'
import { KeyMetricsRow } from '@/components/live/KeyMetricsRow'
import { BoxScoreModule } from '@/components/live/BoxScoreModule'
import { OtherGamesPanel } from '@/components/live/OtherGamesPanel'
import { NoGameIdleState } from '@/components/live/NoGameIdleState'
import { StaleBanner } from '@/components/stale-banner/StaleBanner'
import { BoxScoreSkeleton } from '@/components/skeletons/BoxScoreSkeleton'
import { StatCardSkeleton } from '@/components/skeletons/StatCardSkeleton'

function LiveFloatingNav() {
  const pathname = usePathname()
  const isLive = pathname === '/live' || pathname.startsWith('/live/')

  return (
    <header className="pt-8 pb-4">
      <Surface variant="nav" className="relative mx-auto flex max-w-max items-center gap-6 px-6 py-2.5">
        <span className="text-[0.875rem] font-bold tracking-widest text-foreground">
          CCC
        </span>
        <nav className="flex items-center gap-0.5" aria-label="Main">
          <NavLinkCapsule href="/home" active={pathname === '/home'}>
            Home
          </NavLinkCapsule>
          <NavLinkCapsule href="/live" active={isLive}>
            Live
          </NavLinkCapsule>
          <NavLinkCapsule href="/players" active={pathname.startsWith('/players')}>
            Players
          </NavLinkCapsule>
          <NavLinkCapsule href="/schedule" active={pathname.startsWith('/schedule')}>
            Schedule
          </NavLinkCapsule>
          <NavLinkCapsule href="/history" active={pathname.startsWith('/history')}>
            History
          </NavLinkCapsule>
        </nav>
      </Surface>
    </header>
  )
}

export default function LivePage() {
  const { data, error, isLoading } = useLiveData()

  // Initial load skeleton — before first data arrives
  if (isLoading && !data) {
    return (
      <div className="-mt-14 min-h-screen bg-background text-foreground">
        <LiveFloatingNav />
        <main className="mx-auto max-w-[1440px] px-6 pb-12">
          <section className="mt-6">
            <Surface variant="scoreboard" className="h-[120px] animate-pulse" />
          </section>
          <section className="mt-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <StatCardSkeleton key={i} />
              ))}
            </div>
          </section>
          <div className="mt-8">
            <BoxScoreSkeleton />
          </div>
        </main>
      </div>
    )
  }

  // Error with no cached data
  if (error && !data) {
    return (
      <div className="-mt-14 min-h-screen bg-background text-foreground">
        <LiveFloatingNav />
        <main className="mx-auto max-w-[1440px] px-6 pb-12">
          <p className="ccc-body mt-6 text-muted-foreground">
            Unable to load live data. Retrying…
          </p>
        </main>
      </div>
    )
  }

  const state = data?.state ?? 'NO_ACTIVE_GAME'

  if (state === 'NO_ACTIVE_GAME') {
    return (
      <div className="-mt-14 min-h-screen bg-background text-foreground">
        <LiveFloatingNav />
        <main className="mx-auto max-w-[1440px] px-6 pb-12">
          <NoGameIdleState className="mt-6" />
        </main>
      </div>
    )
  }

  // Extract LAC and opponent FT strings for FT edge computation
  const lacTeam = data?.box_score?.teams?.find((t: { team_abbr: string }) => t.team_abbr === 'LAC')
  const oppTeam = data?.box_score?.teams?.find((t: { team_abbr: string }) => t.team_abbr !== 'LAC')
  const lacFt = lacTeam?.totals?.FT as string | undefined
  const oppFt = oppTeam?.totals?.FT as string | undefined
  const hasOtherGames = (data?.other_games?.length ?? 0) > 0
  const insights = data?.insights ?? []

  return (
    <div className="-mt-14 min-h-screen bg-background text-foreground">
      <LiveFloatingNav />
      <main className="mx-auto max-w-[1440px] px-6 pb-12">
        {/* Scoreboard hero */}
        {data?.game && (
          <section className="mt-6" aria-label="Scoreboard">
            <LiveScoreboard game={data.game} />
          </section>
        )}

        <StaleBanner
          stale={data?.meta?.stale ?? false}
          generatedAt={data?.meta?.generated_at}
          capturedAt={data?.snapshot_captured_at}
        />

        {/* Analytics metrics row */}
        <section className="mt-6">
          <KeyMetricsRow
            metrics={data?.key_metrics}
            lacFt={lacFt}
            oppFt={oppFt}
            useGridLayout
          />
        </section>

        {/* Main content: box score (8) + insights sidebar (4) */}
        <div className="mt-8 grid grid-cols-12 gap-6">
          {/* Box score */}
          <div className="col-span-12 lg:col-span-8">
            <h2 className="ccc-section-title mb-3">
              Box score
            </h2>
            <BoxScoreModule boxScore={data?.box_score} />
          </div>

          {/* Insights feed */}
          <div className="col-span-12 lg:col-span-4">
            <h2 className="ccc-section-title mb-3">
              Insights
            </h2>
            <Surface variant="card" className="p-5">
              <div className="flex flex-col gap-6">
                {insights.length === 0 ? (
                  <p className="ccc-body text-muted-foreground">No insights yet.</p>
                ) : (
                  insights.map((insight: { insight_id: string; category: string; headline: string; detail: string }) => (
                    <div
                      key={insight.insight_id}
                      className="ccc-hover-card min-h-[4rem] -mx-1 rounded-lg border border-transparent border-b border-border-subtle px-3 py-2 pb-6 first:pt-0 last:border-0 last:pb-0 last:pt-0"
                    >
                      <p className="ccc-section-title text-primary">
                        {insight.category}
                      </p>
                      <p className="mt-1 text-[0.875rem] font-medium leading-snug text-foreground">
                        {insight.headline}
                      </p>
                      <p className="mt-0.5 text-[0.75rem] leading-snug text-muted-foreground">
                        {insight.detail}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </Surface>
            {hasOtherGames && (
              <div className="mt-6">
                <OtherGamesPanel games={data?.other_games} />
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
