'use client'

import { useLiveData } from '@/hooks/useLiveData'
import { LiveScoreboard } from '@/components/live/LiveScoreboard'
import { KeyMetricsRow } from '@/components/live/KeyMetricsRow'
import { BoxScoreModule } from '@/components/live/BoxScoreModule'
import { InsightTileArea } from '@/components/live/InsightTileArea'
import { OtherGamesPanel } from '@/components/live/OtherGamesPanel'
import { NoGameIdleState } from '@/components/live/NoGameIdleState'
import { StaleBanner } from '@/components/stale-banner/StaleBanner'
import { BoxScoreSkeleton } from '@/components/skeletons/BoxScoreSkeleton'
import { StatCardSkeleton } from '@/components/skeletons/StatCardSkeleton'
import { cn } from '@/lib/utils'

export default function LivePage() {
  const { data, error, isLoading } = useLiveData()

  // Initial load skeleton — before first data arrives
  if (isLoading && !data) {
    return (
      <div className="px-6 py-6 max-w-[1440px] mx-auto space-y-4">
        <div className="h-[120px] rounded-xl border border-white/[0.06] bg-surface-alt animate-pulse" />
        <div className="flex gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <StatCardSkeleton key={i} className="flex-1" />
          ))}
        </div>
        <BoxScoreSkeleton />
      </div>
    )
  }

  // Error with no cached data
  if (error && !data) {
    return (
      <div className="px-6 py-6 max-w-[1440px] mx-auto">
        <p className="text-muted-foreground text-sm">Unable to load live data. Retrying...</p>
      </div>
    )
  }

  const state = data?.state ?? 'NO_ACTIVE_GAME'

  if (state === 'NO_ACTIVE_GAME') {
    return <NoGameIdleState />
  }

  // Extract LAC and opponent FT strings for FT edge computation
  const lacTeam = data?.box_score?.teams?.find((t: { team_abbr: string }) => t.team_abbr === 'LAC')
  const oppTeam = data?.box_score?.teams?.find((t: { team_abbr: string }) => t.team_abbr !== 'LAC')
  const lacFt = lacTeam?.totals?.FT as string | undefined
  const oppFt = oppTeam?.totals?.FT as string | undefined

  const hasOtherGames = (data?.other_games?.length ?? 0) > 0

  return (
    <div className="px-6 py-6 max-w-[1440px] mx-auto">
      {/* Scoreboard band */}
      {data?.game && (
        <LiveScoreboard game={data.game} />
      )}

      {/* Stale data banner — mounts below scoreboard, returns null when stale=false */}
      <StaleBanner
        stale={data?.meta?.stale ?? false}
        generatedAt={data?.meta?.generated_at}
      />

      {/* Key metrics row */}
      <KeyMetricsRow
        metrics={data?.key_metrics}
        lacFt={lacFt}
        oppFt={oppFt}
        className="mt-4"
      />

      {/* Main content + optional side rail */}
      <div className={cn(
        'mt-6',
        hasOtherGames ? 'grid grid-cols-12 gap-6' : ''
      )}>
        <div className={hasOtherGames ? 'col-span-8' : ''}>
          <BoxScoreModule boxScore={data?.box_score} />
          <InsightTileArea insights={data?.insights} className="mt-6" />
        </div>
        {hasOtherGames && (
          <div className="col-span-4">
            <OtherGamesPanel games={data?.other_games} />
          </div>
        )}
      </div>
    </div>
  )
}
