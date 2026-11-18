'use client'

import * as React from 'react'
import Link from 'next/link'
import { Scoreboard, type ScoreSide } from '@/components/game/Scoreboard'
import { LineScore } from '@/components/game/LineScore'
import { WinProbabilityBar } from '@/components/game/WinProbabilityBar'
import { useLiveStream } from '@/hooks/useLiveStream'
import { resolveLiveState } from '@/src/lib/ui/live'
import { BACKUP_STALE_REASON } from '@/src/lib/live/espn-backup'
import type { LivePayload } from '@/src/lib/ui/types'

/**
 * The home page's hero while a Clippers game is on (and for the half hour
 * /live keeps a finished game up): the live score, pushed like /live's,
 * linking to the full live view. Otherwise renders `children` (the next game).
 */
export function HomeLive({ children }: { children: React.ReactNode }) {
  const { data } = useLiveStream()
  return <HomeLiveCard data={data}>{children}</HomeLiveCard>
}

/** HomeLive's card for a given /api/live payload (the dev fixture renders it directly). */
export function HomeLiveCard({ data, children }: { data: LivePayload | undefined; children?: React.ReactNode }) {
  const state = resolveLiveState(data)
  const game = data?.game
  if (!data || !game || state === 'NO_ACTIVE_GAME') return <>{children}</>

  const lacHome = game.home.abbreviation === 'LAC'
  const lacSide = lacHome ? game.home : game.away
  const oppSide = lacHome ? game.away : game.home
  const lac: ScoreSide = { abbr: lacSide.abbreviation ?? 'LAC', name: lacSide.name, score: lacSide.score }
  const opp: ScoreSide = { abbr: oppSide.abbreviation, name: oppSide.name, score: oppSide.score }
  const oppAbbr = opp.abbr ?? 'OPP'
  const final = game.status === 'final'
  const delayed = !final && state === 'DATA_DELAYED'
  const onBackup = data.meta.stale_reason === BACKUP_STALE_REASON
  const top = [...(data.insights ?? [])].sort((a, b) => b.importance - a.importance)[0]

  return (
    <Scoreboard
      lac={lac}
      opp={opp}
      lacHome={lacHome}
      mode={final ? 'final' : delayed ? 'delayed' : 'live'}
      status={final ? game.status_text || 'Final' : null}
      period={game.period}
      clock={game.clock}
      tag={game.is_preseason ? 'Preseason' : null}
    >
      <LineScore periods={game.periods ?? []} lacHome={lacHome} oppAbbr={oppAbbr} />
      {data.wp && game.status !== 'scheduled' && !onBackup && <WinProbabilityBar lacProb={data.wp.lac} oppAbbr={oppAbbr} source="model" />}
      <Link
        href="/live"
        className="relative flex items-center justify-between gap-4 border-t border-line px-5 py-3.5 text-[14px] hover:bg-white/[0.03] sm:px-8"
      >
        <span className="min-w-0 truncate text-mute">{top ? top.headline : final ? 'Box score, game flow and play-by-play' : 'Box score, game flow, rotation and play-by-play'}</span>
        <span className="shrink-0 font-medium text-text">{final ? 'Recap' : 'Follow live'} →</span>
      </Link>
    </Scoreboard>
  )
}
