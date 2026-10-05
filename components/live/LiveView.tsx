'use client'

import * as React from 'react'
import { Scoreboard, type ScoreSide } from '@/components/game/Scoreboard'
import { WinProbabilityBar } from '@/components/game/WinProbabilityBar'
import { OddsStrip } from '@/components/game/OddsStrip'
import { BoxScore } from '@/components/game/BoxScore'
import { LineScore } from '@/components/game/LineScore'
import { InsightCard } from '@/components/insights/InsightCard'
import { Eyebrow } from '@/components/ui/eyebrow'
import { Panel } from '@/components/ui/panel'
import { Segmented } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { useNow } from '@/hooks/useNow'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { KeyMetrics } from './KeyMetrics'
import { StickyScore } from './StickyScore'
import { LiveTabTitle } from './LiveTabTitle'
import { IdleState } from './IdleState'
import { FeedSource } from './FeedSource'
import { GameFlow } from './GameFlow'
import { Clipboard } from './Clipboard'
import { SpoilerControl } from './SpoilerControl'
import { resolveLiveState } from '@/src/lib/ui/live'
import { BACKUP_STALE_REASON } from '@/src/lib/live/espn-backup'
import { RUNNER_NOT_STARTED_REASON } from '@/src/lib/live/payload'
import type { FeedSource as FeedSourceKind } from '@/src/lib/live/stream'
import { formatMoneyline, formatSpread, noVigProbabilities } from '@/src/lib/ui/odds'
import { ageLabel, parseTimestamp } from '@/src/lib/ui/time'
import type { LivePayload } from '@/src/lib/ui/types'
import type { SpoilerState } from '@/hooks/useLiveStream'

function LoadingState() {
  return (
    <>
      <Skeleton className="h-[220px] rounded-[22px]" />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[92px] rounded-[22px]" />
        ))}
      </div>
      <Skeleton className="h-[420px] rounded-[22px]" />
    </>
  )
}

/** Everything under /live, driven by one /api/live payload. */
export function LiveView({
  data,
  error,
  source,
  spoiler,
}: {
  data: LivePayload | undefined
  error?: unknown
  source?: FeedSourceKind
  spoiler?: SpoilerState
}) {
  const scoreRef = React.useRef<HTMLDivElement>(null)
  const now = useNow(5_000)
  const wide = useMediaQuery('(min-width: 640px)')
  const [flowOpen, setFlowOpen] = React.useState(false)
  const [panel, setPanel] = React.useState<'box' | 'rotation'>('box')

  if (error && !data) {
    return (
      <div className="page">
        <EmptyState title="Live data isn't responding" body="Retrying automatically. The page will update as soon as the feed is back." />
      </div>
    )
  }
  if (spoiler?.holding) {
    return (
      <div className="page">
        <Panel className="grid justify-items-start gap-3 p-6">
          <p className="m-0 text-[14px] text-mute">
            Holding the game {Math.round(spoiler.delayMs / 1000)} s behind live to match your screen…
          </p>
          <SpoilerControl spoiler={spoiler} />
        </Panel>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="page" aria-busy="true">
        <LoadingState />
      </div>
    )
  }

  const state = resolveLiveState(data)
  if (state === 'NO_ACTIVE_GAME' || !data.game) {
    return (
      <div className="page">
        <IdleState />
      </div>
    )
  }

  const game = data.game
  const lacHome = game.home.abbreviation === 'LAC'
  const lacSide = lacHome ? game.home : game.away
  const oppSide = lacHome ? game.away : game.home
  const lac: ScoreSide = { abbr: lacSide.abbreviation ?? 'LAC', name: lacSide.name, score: lacSide.score }
  const opp: ScoreSide = { abbr: oppSide.abbreviation, name: oppSide.name, score: oppSide.score }
  const oppAbbr = opp.abbr ?? 'OPP'
  const delayed = state === 'DATA_DELAYED'

  const odds = data.odds
  const probs = odds ? noVigProbabilities(lacHome ? odds.moneyline_home : odds.moneyline_away, lacHome ? odds.moneyline_away : odds.moneyline_home) : null
  const lacSpread = odds ? (lacHome ? odds.spread_home : odds.spread_away) : null
  const oddsAsOf = odds ? parseTimestamp(odds.captured_at) : null

  const lacBox = data.box_score?.teams.find((t) => t.team_abbr === lac.abbr)
  const oppBox = data.box_score?.teams.find((t) => t.team_abbr !== lac.abbr)
  const insights = [...(data.insights ?? [])].sort((a, b) => b.importance - a.importance)
  const delayAge = delayed && now ? ageLabel(data.snapshot_captured_at, now) : null
  const onBackup = data.meta.stale_reason === BACKUP_STALE_REASON
  const notStarted = data.meta.stale_reason === RUNNER_NOT_STARTED_REASON
  // The ESPN backup refreshes only the score and clock; stats stay as last seen.
  const pausedNote = onBackup ? 'Paused — backup feed' : undefined

  return (
    <div className="page">
      <LiveTabTitle game={game} />
      <StickyScore sentinel={scoreRef} lac={lac} opp={opp} period={game.period} clock={game.clock} delayed={delayed} />

      {/* z-10: .enter's animation gives every section its own stacking context; the
          spoiler control's popover has to paint over the sections below. */}
      <section aria-label="Scoreboard" ref={scoreRef} className="enter relative z-10">
        <Scoreboard
          lac={lac}
          opp={opp}
          lacHome={lacHome}
          mode={delayed ? 'delayed' : 'live'}
          period={game.period}
          clock={game.clock}
          tag={game.is_preseason ? 'Preseason' : null}
        >
          <LineScore periods={game.periods ?? []} lacHome={lacHome} oppAbbr={oppAbbr} />
          {odds && (
            <div className="relative border-t border-line px-3 py-3 sm:px-6">
              <OddsStrip
                compact
                items={[
                  { label: 'Spread', value: lacSpread == null ? '—' : `LAC ${formatSpread(lacSpread)}` },
                  {
                    label: 'Moneyline',
                    value: `${formatMoneyline(lacHome ? odds.moneyline_home : odds.moneyline_away)} / ${formatMoneyline(lacHome ? odds.moneyline_away : odds.moneyline_home)}`,
                  },
                  { label: 'Total', value: odds.total_points == null ? '—' : String(odds.total_points) },
                  {
                    label: 'Line as of',
                    value: oddsAsOf
                      ? oddsAsOf.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })
                      : '—',
                  },
                ]}
              />
            </div>
          )}
          {/* On the ESPN backup the score is fresher than the runner's model value,
              so the bar falls back to the moneyline (or hides) rather than pair them. */}
          {data.wp && game.status !== 'scheduled' && !onBackup ? (
            <WinProbabilityBar lacProb={data.wp.lac} oppAbbr={oppAbbr} source="model" />
          ) : (
            probs && <WinProbabilityBar lacProb={probs.a} oppAbbr={oppAbbr} />
          )}
        </Scoreboard>
        {(source || spoiler) && (
          <div className="mt-3 flex items-center justify-between gap-3">
            {spoiler ? <SpoilerControl spoiler={spoiler} /> : <span />}
            {source && <FeedSource source={source} />}
          </div>
        )}
        {delayed && (
          <p className="m-0 mt-3 flex items-center gap-2 font-mono text-[12px] text-warn" role="status">
            {onBackup
              ? "Our live feed is delayed. Score and clock are from ESPN's backup feed."
              : notStarted
                ? "Our live feed hasn't started. Checking ESPN's scoreboard for the score…"
                : `Feed delayed${delayAge ? ` · last update ${delayAge} ago` : ''}. Showing the most recent snapshot.`}
          </p>
        )}
      </section>

      {data.flow && data.flow.points.length > 1 && (
        <section className="enter" style={{ ['--i' as string]: 1 }} aria-label="Game flow">
          <Eyebrow aside={pausedNote}>Game flow</Eyebrow>
          {wide ? (
            <Panel className="p-4 sm:p-5">
              <GameFlow flow={data.flow} wp={data.wp ?? null} oppAbbr={oppAbbr} />
            </Panel>
          ) : (
            <>
              <Panel as="button" type="button" onClick={() => setFlowOpen((o) => !o)} aria-expanded={flowOpen} className="block w-full px-3 py-2 text-left">
                <GameFlow flow={data.flow} wp={data.wp ?? null} oppAbbr={oppAbbr} compact />
                <span className="font-mono text-[11px] text-dim">{flowOpen ? 'Hide the chart' : 'Tap for the full chart'}</span>
              </Panel>
              {flowOpen && (
                <Panel className="mt-2 p-3">
                  <GameFlow flow={data.flow} wp={data.wp ?? null} oppAbbr={oppAbbr} />
                </Panel>
              )}
            </>
          )}
        </section>
      )}

      {data.key_metrics?.length > 0 && (
        <section className="enter" style={{ ['--i' as string]: 2 }} aria-label="Key metrics">
          {pausedNote && <p className="m-0 mb-2 text-right font-mono text-[11.5px] leading-none text-dim">{pausedNote}</p>}
          <KeyMetrics metrics={data.key_metrics} lacFt={lacBox?.totals.FT as string | undefined} oppFt={oppBox?.totals.FT as string | undefined} oppAbbr={oppAbbr} />
        </section>
      )}

      <section className="enter grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-[18px]" style={{ ['--i' as string]: 3 }}>
        <div className="min-w-0">
          <Eyebrow aside={pausedNote}>{panel === 'rotation' && data.lineups ? 'Rotation' : 'Box score'}</Eyebrow>
          {data.lineups && (
            <Segmented
              className="mb-3"
              size="sm"
              ariaLabel="Box score or rotation"
              value={panel}
              onChange={setPanel}
              options={[
                { value: 'box', label: 'Box score' },
                { value: 'rotation', label: 'Rotation' },
              ]}
            />
          )}
          {panel === 'rotation' && data.lineups ? (
            <Panel className="p-4 sm:p-5">
              <Clipboard lineups={data.lineups} lacAbbr={lac.abbr ?? 'LAC'} oppAbbr={oppAbbr} />
            </Panel>
          ) : data.box_score ? (
            <BoxScore teams={data.box_score.teams} playerIdsAreNba />
          ) : (
            <Panel className="p-6 text-[14px] text-mute">The box score appears after the first stats come in.</Panel>
          )}
        </div>
        <div className="min-w-0">
          <Eyebrow aside={insights.length ? 'newest first' : undefined}>Insights</Eyebrow>
          {insights.length ? (
            <div className="grid gap-2.5">
              {insights.map((ins, i) => (
                <InsightCard key={ins.insight_id} insight={ins} fresh={i === 0} />
              ))}
            </div>
          ) : (
            <Panel className="p-5 text-[14px] text-mute">
              {delayed ? 'Insights pause while the feed is delayed.' : 'Scoring runs and clutch moments show up here as they happen.'}
            </Panel>
          )}
        </div>
      </section>
    </div>
  )
}
