'use client'

import { Surface } from '@/components/ui/surface'
import { useLiveData, type LiveDashboardPayload } from '@/hooks/useLiveData'
import { LiveScoreboard } from '@/components/live/LiveScoreboard'
import { KeyMetricsRow } from '@/components/live/KeyMetricsRow'
import { BoxScoreModule } from '@/components/live/BoxScoreModule'
import { OtherGamesPanel } from '@/components/live/OtherGamesPanel'
import { NoGameIdleState } from '@/components/live/NoGameIdleState'
import { StaleBanner } from '@/components/stale-banner/StaleBanner'
import { BoxScoreSkeleton } from '@/components/skeletons/BoxScoreSkeleton'
import { StatCardSkeleton } from '@/components/skeletons/StatCardSkeleton'

// A DATA_DELAYED snapshot older than this (vs. server time) is a leftover from a
// finished game, not a delayed live one — show the idle state instead.
const STALE_SNAPSHOT_IDLE_MS = 6 * 60 * 60 * 1000

function resolveState(data: LiveDashboardPayload | undefined): 'LIVE' | 'DATA_DELAYED' | 'NO_ACTIVE_GAME' {
  const state = data?.state
  if ((state !== 'LIVE' && state !== 'DATA_DELAYED') || !data?.game) return 'NO_ACTIVE_GAME'
  if (state === 'DATA_DELAYED' && data.snapshot_captured_at && data.meta?.generated_at) {
    const age = new Date(data.meta.generated_at).getTime() - new Date(data.snapshot_captured_at).getTime()
    if (age > STALE_SNAPSHOT_IDLE_MS) return 'NO_ACTIVE_GAME'
  }
  return state
}

export default function LivePage() {
  const { data, error } = useLiveData()

  // Error with no cached data. Checked before the loading state: SWR reports
  // isLoading=true during every error retry, which would otherwise flip the
  // page back to the skeleton indefinitely while the API is failing.
  if (error && !data) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto max-w-[1440px] px-6 pb-12">
          <p className="ccc-body mt-6 text-muted-foreground">
            Unable to load live data. Retrying…
          </p>
        </div>
      </div>
    )
  }

  // Initial load skeleton — before first data arrives
  if (!data) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto max-w-[1440px] px-6 pb-12">
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
        </div>
      </div>
    )
  }

  const state = resolveState(data)

  if (state === 'NO_ACTIVE_GAME') {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto max-w-[1440px] px-6 pb-12">
          <NoGameIdleState className="mt-6" />
        </div>
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
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1440px] px-6 pb-12">
        {/* Scoreboard hero */}
        {data?.game && (
          <section className="mt-6" aria-label="Scoreboard">
            <LiveScoreboard game={data.game} />
          </section>
        )}

        <StaleBanner
          stale={Boolean(data?.meta?.stale) || !!error}
          generatedAt={data?.meta?.generated_at}
          capturedAt={data?.snapshot_captured_at}
        />

        {/* Analytics metrics row */}
        <section className="mt-6">
          <KeyMetricsRow
            metrics={data?.key_metrics ?? []}
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
            {data?.box_score ? (
              <BoxScoreModule boxScore={data.box_score} />
            ) : (
              <Surface variant="card" className="p-5">
                <p className="ccc-body text-muted-foreground">Box score not available yet.</p>
              </Surface>
            )}
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
      </div>
    </div>
  )
}
